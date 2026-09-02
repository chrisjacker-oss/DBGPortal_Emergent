import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatCard, StatusBadge } from "@/components/kit";
import PayNowDialog from "@/components/PayNowDialog";
import { Inp } from "@/pages/Customers";
import { ArrowsClockwise, Receipt, CreditCard, Warning } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function Portal() {
  const [data, setData] = useState({ invoices: [], reorders: [], customer: null });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", notes: "", source_invoice_id: "" });
  const [payInv, setPayInv] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get("/portal/orders")
    .then((r) => { setData(r.data); setError(null); })
    .catch((e) => setError(e.response?.data?.detail || "We couldn't load your orders. Please contact DBG Signs."));
  useEffect(() => { load(); }, []);

  const reorderFrom = (inv) => { setForm({ title: inv.title, notes: "", source_invoice_id: inv.id }); setOpen(true); };
  const openBlank = () => { setForm({ title: "", notes: "", source_invoice_id: "" }); setOpen(true); };

  const submit = async () => {
    try {
      await api.post("/portal/reorder", form);
      toast.success("Reorder request sent");
      setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const outstanding = data.invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.total, 0);

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
        <Btn onClick={openBlank} data-testid="new-reorder-btn"><ArrowsClockwise size={16} weight="bold" /> Request Reorder</Btn>
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
                    <td className="px-6 py-3 font-mono">{r.number}</td>
                    <td className="px-6 py-3 font-medium">{r.title}</td>
                    <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                    <td className="px-6 py-3 text-right">
                      {r.status !== "paid" && (
                        <Btn variant="ghost" onClick={() => setPayInv(r)} data-testid={`portal-pay-${r.id}`}><CreditCard size={16} /> Pay</Btn>
                      )}
                      <Btn variant="ghost" onClick={() => reorderFrom(r)} data-testid={`reorder-${r.id}`}><ArrowsClockwise size={16} /> Reorder</Btn>
                    </td>
                  </tr>
                ))}
                {data.invoices.length === 0 && <tr><td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">No orders yet. Once we invoice a job it will appear here.</td></tr>}
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
    </div>
  );
}
