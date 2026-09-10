import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatCard, StatusBadge } from "@/components/kit";
import PayNowDialog from "@/components/PayNowDialog";
import { Inp } from "@/pages/Customers";
import { downloadFile } from "@/lib/download";
import { ArrowsClockwise, Receipt, CreditCard, Warning, FilePdf } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function Portal() {
  const [data, setData] = useState({ invoices: [], reorders: [], customer: null });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", notes: "", source_invoice_id: "" });
  const [reorderItems, setReorderItems] = useState([]);
  const [reorderNum, setReorderNum] = useState(null);
  const [payInv, setPayInv] = useState(null);
  const [payAll, setPayAll] = useState(null);
  const [paySelected, setPaySelected] = useState(null);
  const [sel, setSel] = useState({});
  const [error, setError] = useState(null);

  const load = () => api.get("/portal/orders")
    .then((r) => { setData(r.data); setError(null); })
    .catch((e) => setError(e.response?.data?.detail || "We couldn't load your orders. Please contact DBG Signs."));
  useEffect(() => { load(); }, []);

  const reorderFrom = (inv) => { setForm({ title: inv.title, notes: "", source_invoice_id: inv.id }); setReorderItems(inv.line_items || []); setReorderNum(inv.number); setOpen(true); };
  const openBlank = () => { setForm({ title: "", notes: "", source_invoice_id: "" }); setReorderItems([]); setReorderNum(null); setOpen(true); };

  const submit = async () => {
    try {
      await api.post("/portal/reorder", form);
      toast.success("Reorder request sent");
      setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const outstanding = data.invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + (Number(i.total || 0) - Number(i.amount_paid || 0)), 0);
  const payableInvoices = data.invoices.filter((i) => i.status !== "paid" && (Number(i.total || 0) - Number(i.amount_paid || 0)) > 0.005);
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const selTotal = payableInvoices.filter((i) => sel[i.id]).reduce((s, i) => s + (Number(i.total || 0) - Number(i.amount_paid || 0)), 0);
  const toggleSel = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const allPayableChecked = payableInvoices.length > 0 && payableInvoices.every((i) => sel[i.id]);
  const toggleAllPayable = () => { const n = {}; if (!allPayableChecked) payableInvoices.forEach((i) => (n[i.id] = true)); setSel(n); };

  if (error) {
    return (
      <div>
        <PageHeader overline="Welcome" title="My Orders" />
        <div className="p-8">
          <div className="border border-border bg-card p-10 max-w-lg flex items-start gap-4" data-testid="portal-error">
            <Warning size={28} weight="bold" className="text-[#F59E0B] shrink-0" />
            <div>
              <div className="font-display font-semibold text-lg">Access unavailable</div>
              <p className="text-sm text-muted-foreground mt-2">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader overline={data.customer?.company || data.customer?.name || "Welcome"} title="My Orders">
        {selTotal > 0.005 && (
          <Btn onClick={() => setPaySelected({ total: selTotal, count: selIds.length, invoice_ids: selIds })} data-testid="pay-selected-btn"><CreditCard size={16} weight="bold" /> Pay selected ({currency(selTotal)})</Btn>
        )}
        {outstanding > 0.005 && (
          <Btn onClick={() => setPayAll({ total: outstanding, count: data.invoices.filter((i) => i.status !== "paid").length })} data-testid="pay-all-btn"><CreditCard size={16} weight="bold" /> Pay all ({currency(outstanding)})</Btn>
        )}
        {outstanding > 0.005 && (
          <Btn variant="outline" onClick={() => downloadFile("/portal/statement/pdf", "statement.pdf", "application/pdf")} data-testid="statement-btn"><FilePdf size={16} weight="bold" /> Statement</Btn>
        )}
        <Btn variant="outline" onClick={openBlank} data-testid="new-reorder-btn"><ArrowsClockwise size={16} weight="bold" /> Request Reorder</Btn>
      </PageHeader>

      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
          <StatCard testid="portal-orders" label="Total Orders" value={data.invoices.length} accent="#06B6D4" />
          <StatCard testid="portal-balance" label="Balance Due" value={currency(outstanding)} accent="#F59E0B" />
          <StatCard testid="portal-reorders" label="Reorder Requests" value={data.reorders.length} accent="#D946EF" />
        </div>

        <div>
          <div className="overline text-muted-foreground mb-3 flex items-center gap-2"><Receipt size={14} weight="bold" /> Order history</div>
          <div className="border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left overline text-muted-foreground">
                  <th className="px-4 py-3 w-10">{payableInvoices.length > 0 && <input type="checkbox" checked={allPayableChecked} onChange={toggleAllPayable} data-testid="portal-select-all" className="h-4 w-4 accent-[#0A0A0A]" title="Select all unpaid" />}</th>
                  <th className="px-6 py-3 font-mono">#</th>
                  <th className="px-6 py-3 font-mono">Job</th>
                  <th className="px-6 py-3 font-mono">Status</th>
                  <th className="px-6 py-3 font-mono text-right">Total</th>
                  <th className="px-6 py-3 font-mono text-right">Actions</th>
                </tr>
              </thead>
              <tbody data-testid="portal-invoices-table">
                {data.invoices.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                    <td className="px-4 py-3">
                      {r.status !== "paid" && (Number(r.total || 0) - Number(r.amount_paid || 0)) > 0.005 && (
                        <input type="checkbox" checked={!!sel[r.id]} onChange={() => toggleSel(r.id)} data-testid={`portal-select-${r.id}`} className="h-4 w-4 accent-[#0A0A0A]" />
                      )}
                    </td>
                    <td className="px-6 py-3 font-mono">{r.number}</td>
                    <td className="px-6 py-3 font-medium">{r.title}</td>
                    <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-6 py-3 text-right font-mono">
                      {currency(r.total)}
                      {Number(r.amount_paid || 0) > 0 && r.status !== "paid" && (
                        <div className="text-[11px] text-[#F59E0B]" data-testid={`portal-balance-${r.id}`}>Bal {currency(Number(r.total || 0) - Number(r.amount_paid || 0))}</div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {r.status !== "paid" && (
                        <Btn variant="ghost" onClick={() => setPayInv(r)} data-testid={`portal-pay-${r.id}`}><CreditCard size={16} /> Pay</Btn>
                      )}
                      <Btn variant="ghost" onClick={() => reorderFrom(r)} data-testid={`reorder-${r.id}`}><ArrowsClockwise size={16} /> Reorder</Btn>
                    </td>
                  </tr>
                ))}
                {data.invoices.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">No orders yet. Once we invoice a job it will appear here.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {data.reorders.length > 0 && (
          <div>
            <div className="overline text-muted-foreground mb-3">My reorder requests</div>
            <div className="border border-border bg-card divide-y divide-border">
              {data.reorders.map((r) => (
                <div key={r.id} className="px-6 py-3 flex items-center justify-between">
                  <div><div className="font-medium">{r.title}</div><div className="text-xs text-muted-foreground">{r.notes}</div></div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader><DialogTitle className="font-display">Request a Reorder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {reorderItems.length > 0 && (
              <div className="border border-border bg-secondary/30" data-testid="reorder-source-items">
                <div className="px-3 py-2 overline text-muted-foreground border-b border-border">Previously ordered{reorderNum ? ` · ${reorderNum}` : ""}</div>
                <div className="divide-y divide-border">
                  {reorderItems.map((li, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3 py-2 text-sm" data-testid={`reorder-item-${idx}`}>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{li.description || "Item"}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {(Number(li.width_in) > 0 && Number(li.height_in) > 0) ? `${li.width_in}" × ${li.height_in}" · ` : ""}Qty {li.quantity ?? 1}
                          {li.details ? ` · ${li.details}` : ""}
                        </div>
                      </div>
                      <div className="font-mono text-sm shrink-0 ml-3">{currency(li.line_total || 0)}</div>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">These are the items from your previous order. Add any changes in the notes below.</div>
              </div>
            )}
            <Inp label="What do you need?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} testid="reorder-title" />
            <label className="block">
              <span className="overline text-muted-foreground">Notes / changes</span>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="reorder-notes" rows={3}
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={submit} data-testid="submit-reorder-btn">Send request</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PayNowDialog open={!!payInv} invoice={payInv} onClose={() => setPayInv(null)} onPaid={() => { setPayInv(null); load(); }} />
      <PayNowDialog open={!!payAll} payAll={payAll} onClose={() => setPayAll(null)} onPaid={() => { setPayAll(null); load(); }} />
      <PayNowDialog open={!!paySelected} paySelected={paySelected} onClose={() => setPaySelected(null)} onPaid={() => { setPaySelected(null); setSel({}); load(); }} />
    </div>
  );
}
