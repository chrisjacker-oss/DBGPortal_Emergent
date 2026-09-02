import { useEffect, useMemo, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatCard, StatusBadge } from "@/components/kit";
import { downloadFile } from "@/lib/download";
import { CheckCircle, FilePdf } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export default function Commissions() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [data, setData] = useState({ rows: [], by_salesman: [], total_earned: 0, total_pending: 0, total_paid: 0 });
  const [tab, setTab] = useState("unpaid"); // unpaid | paid
  const [sel, setSel] = useState({}); // id -> bool (unpaid tab only)
  const [payOpen, setPayOpen] = useState(false);
  const [poMap, setPoMap] = useState({}); // id -> PO number
  const [busy, setBusy] = useState(false);
  const [pFrom, setPFrom] = useState("");
  const [pTo, setPTo] = useState("");

  const load = () => api.get("/commissions").then((r) => setData(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => { setSel({}); }, [tab]);

  const isPaidTab = tab === "paid";
  const showChecks = isAdmin && !isPaidTab;
  const unpaidRows = useMemo(() => data.rows.filter((r) => !r.paid), [data.rows]);
  const paidRows = useMemo(() => data.rows.filter((r) => r.paid).filter((r) => {
    const d = (r.paid_at || "").slice(0, 10);
    if (pFrom && d && d < pFrom) return false;
    if (pTo && d && d > pTo) return false;
    return true;
  }), [data.rows, pFrom, pTo]);
  const rows = isPaidTab ? paidRows : unpaidRows;

  const selectedIds = Object.keys(sel).filter((k) => sel[k]);
  const selectedRows = data.rows.filter((r) => sel[r.id]);
  const allChecked = rows.length > 0 && rows.every((r) => sel[r.id]);
  const toggleAll = () => { const next = {}; if (!allChecked) rows.forEach((r) => (next[r.id] = true)); setSel(next); };
  const toggle = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const colCount = 3 + (isPaidTab ? 2 : 1) + 3 + (showChecks ? 1 : 0);

  const openPay = () => { setPoMap({}); setPayOpen(true); };
  const markPaid = async () => {
    const items = selectedIds.map((id) => ({ estimate_id: id, po_number: (poMap[id] || "").trim() }));
    if (items.some((it) => !it.po_number)) { toast.error("Enter a PO number for every commission"); return; }
    setBusy(true);
    try {
      const { data: res } = await api.post("/commissions/pay", { items });
      toast.success(`Marked ${res.updated} commission(s) paid`);
      setPayOpen(false); setPoMap({}); setSel({}); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const rangeQuery = () => {
    const q = new URLSearchParams();
    if (pFrom) q.set("date_from", pFrom);
    if (pTo) q.set("date_to", pTo);
    return q;
  };
  const exportPdf = async () => {
    const q = rangeQuery();
    try { await downloadFile(`/commissions/paid/pdf?${q.toString()}`, "paid-commissions.pdf", "application/pdf"); }
    catch { toast.error("Export failed"); }
  };
  const exportSalesmanPdf = async (name) => {
    const q = rangeQuery(); q.set("salesman_name", name);
    const safe = (name || "salesman").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    try { await downloadFile(`/commissions/paid/pdf?${q.toString()}`, `paid-commissions-${safe}.pdf`, "application/pdf"); }
    catch { toast.error("Export failed"); }
  };

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} data-testid={`comm-tab-${id}`}
      className={`px-4 py-2 text-sm font-mono uppercase tracking-wider border-b-2 transition-colors duration-150 ${tab === id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
      {label}
    </button>
  );

  return (
    <div>
      <PageHeader overline={user?.role === "salesman" ? "Your earnings" : "Sales team"} title="Commissions" />
      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-border border border-border">
          <StatCard testid="comm-earned" label="Earned (unpaid)" value={currency(data.total_earned)} accent="#16A34A" />
          <StatCard testid="comm-pending" label="Pending (open)" value={currency(data.total_pending)} accent="#F59E0B" />
          <StatCard testid="comm-paid" label="Paid out" value={currency(data.total_paid)} accent="#0E7490" />
          <StatCard testid="comm-total" label="Total Pipeline" value={currency(data.total_earned + data.total_pending + data.total_paid)} accent="#A21CAF" />
        </div>

        {!isAdmin || data.by_salesman.length === 0 ? null : (
          <div>
            <div className="overline text-muted-foreground mb-3">By salesman</div>
            <div className="border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left overline text-muted-foreground">
                    <th className="px-6 py-3 font-mono">Salesman</th>
                    <th className="px-6 py-3 font-mono text-right">Estimates</th>
                    <th className="px-6 py-3 font-mono text-right">Earned</th>
                    <th className="px-6 py-3 font-mono text-right">Pending</th>
                    <th className="px-6 py-3 font-mono text-right">Paid</th>
                    <th className="px-6 py-3 font-mono text-right">Total</th>
                    <th className="px-6 py-3 font-mono text-right">Statement</th>
                  </tr>
                </thead>
                <tbody data-testid="commission-by-salesman">
                  {data.by_salesman.map((s) => (
                    <tr key={s.salesman_name} className="border-b border-border last:border-0 hover:bg-secondary/50">
                      <td className="px-6 py-3 font-medium">{s.salesman_name}</td>
                      <td className="px-6 py-3 text-right font-mono">{s.count}</td>
                      <td className="px-6 py-3 text-right font-mono text-[#16A34A]">{currency(s.earned)}</td>
                      <td className="px-6 py-3 text-right font-mono text-[#B45309]">{currency(s.pending)}</td>
                      <td className="px-6 py-3 text-right font-mono text-[#0E7490]">{currency(s.paid)}</td>
                      <td className="px-6 py-3 text-right font-mono font-semibold">{currency(s.earned + s.pending + s.paid)}</td>
                      <td className="px-6 py-3 text-right">
                        <Btn variant="ghost" onClick={() => exportSalesmanPdf(s.salesman_name)} data-testid={`export-salesman-${s.salesman_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} title={`Export ${s.salesman_name} paid commissions`}>
                          <FilePdf size={16} />
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between border-b border-border mb-3 flex-wrap gap-2">
            <div className="flex gap-1">
              <TabBtn id="unpaid" label="Unpaid" />
              <TabBtn id="paid" label="Paid" />
            </div>
            <div className="pb-2 flex items-end gap-2 flex-wrap">
              {showChecks && selectedIds.length > 0 && (
                <Btn onClick={openPay} data-testid="mark-paid-btn"><CheckCircle size={16} weight="bold" /> Mark {selectedIds.length} Paid</Btn>
              )}
              {isPaidTab && (
                <>
                  <label className="block"><span className="overline text-muted-foreground">From</span>
                    <input type="date" value={pFrom} onChange={(e) => setPFrom(e.target.value)} data-testid="comm-paid-from" className="mt-1 block border border-input bg-card px-3 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
                  <label className="block"><span className="overline text-muted-foreground">To</span>
                    <input type="date" value={pTo} onChange={(e) => setPTo(e.target.value)} data-testid="comm-paid-to" className="mt-1 block border border-input bg-card px-3 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
                  {(pFrom || pTo) && <Btn variant="outline" onClick={() => { setPFrom(""); setPTo(""); }} data-testid="comm-paid-clear">Clear</Btn>}
                  <Btn variant="outline" onClick={exportPdf} data-testid="export-commissions-pdf-btn"><FilePdf size={16} weight="bold" /> Export PDF</Btn>
                </>
              )}
            </div>
          </div>

          <div className="border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left overline text-muted-foreground">
                  {showChecks && <th className="px-4 py-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} data-testid="comm-select-all" className="h-4 w-4 accent-[#0A0A0A]" /></th>}
                  <th className="px-6 py-3 font-mono">Estimate</th>
                  <th className="px-6 py-3 font-mono">Customer</th>
                  <th className="px-6 py-3 font-mono">Salesman</th>
                  {isPaidTab ? <th className="px-6 py-3 font-mono">PO #</th> : <th className="px-6 py-3 font-mono">Status</th>}
                  {isPaidTab && <th className="px-6 py-3 font-mono">Paid Date</th>}
                  <th className="px-6 py-3 font-mono text-right">Sale Base</th>
                  <th className="px-6 py-3 font-mono text-right">Rate</th>
                  <th className="px-6 py-3 font-mono text-right">Commission</th>
                </tr>
              </thead>
              <tbody data-testid="commission-rows">
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                    {showChecks && <td className="px-4 py-3"><input type="checkbox" checked={!!sel[r.id]} onChange={() => toggle(r.id)} data-testid={`comm-select-${r.id}`} className="h-4 w-4 accent-[#0A0A0A]" /></td>}
                    <td className="px-6 py-3 font-mono">{r.number}<div className="text-xs text-muted-foreground font-sans">{r.title}</div></td>
                    <td className="px-6 py-3">{r.customer_name}</td>
                    <td className="px-6 py-3">{r.salesman_name}</td>
                    {isPaidTab
                      ? <td className="px-6 py-3"><span className="font-mono text-xs border border-[#0E7490]/30 bg-[#06B6D4]/10 text-[#0E7490] px-2 py-0.5" data-testid={`comm-po-${r.id}`}>PO {r.po_number || "—"}</span></td>
                      : <td className="px-6 py-3"><StatusBadge status={r.earned ? "approved" : r.status} /></td>}
                    {isPaidTab && <td className="px-6 py-3 font-mono text-muted-foreground" data-testid={`comm-paid-date-${r.id}`}>{(r.paid_at || "").slice(0, 10) || "—"}</td>}
                    <td className="px-6 py-3 text-right font-mono">{currency(r.base)}</td>
                    <td className="px-6 py-3 text-right font-mono">{r.commission_rate}%</td>
                    <td className="px-6 py-3 text-right font-mono font-semibold text-[#A21CAF]">{currency(r.commission_amount)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={colCount} className="px-6 py-10 text-center text-muted-foreground">{isPaidTab ? "No paid commissions in this range." : "No unpaid commissions."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={payOpen} onOpenChange={(o) => !o && !busy && setPayOpen(false)}>
        <DialogContent className="rounded-none max-w-lg max-h-[85vh] overflow-y-auto" data-testid="pay-commission-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Mark commissions paid</DialogTitle>
            <DialogDescription className="font-mono text-xs">Enter a PO number for each commission. They'll move to the Paid tab.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {selectedRows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border border-border px-3 py-2" data-testid={`pay-row-${r.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm">{r.number} <span className="text-[#A21CAF] font-semibold">{currency(r.commission_amount)}</span></div>
                  <div className="text-xs text-muted-foreground truncate">{r.customer_name} · {r.salesman_name}</div>
                </div>
                <input value={poMap[r.id] || ""} onChange={(e) => setPoMap((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="PO #" data-testid={`pay-po-${r.id}`}
                  className="w-32 border border-input bg-card px-2 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setPayOpen(false)} disabled={busy}>Cancel</Btn>
            <Btn onClick={markPaid} disabled={busy} data-testid="pay-confirm-btn">{busy ? "Saving…" : "Mark Paid"}</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
