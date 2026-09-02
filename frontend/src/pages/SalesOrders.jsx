import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge, ReceiptBadge } from "@/components/kit";
import { Receipt, Trash, EnvelopeSimple } from "@phosphor-icons/react";

const NEXT = { open: "in_production", in_production: "fulfilled" };

export default function SalesOrders() {
  const [rows, setRows] = useState([]);
  const load = () => api.get("/sales-orders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const advance = async (r) => {
    const status = NEXT[r.status];
    if (!status) return;
    try {
      await api.patch(`/sales-orders/${r.id}/status`, null, { params: { status } });
      toast.success(`Marked ${status.replace("_", " ")}`); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
  };
  const sendEmail = async (id) => {
    try { const { data } = await api.post(`/sales-orders/${id}/send`); toast.success(`Emailed to ${data.to}`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Email failed"); }
  };
  const convert = async (id) => {
    try {
      const { data } = await api.post(`/sales-orders/${id}/convert`);
      toast.success(`Invoice ${data.number} created`); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Convert failed"); }
  };
  const remove = async (id) => { if (!window.confirm("Delete sales order?")) return; await api.delete(`/sales-orders/${id}`); toast.success("Deleted"); load(); };

  return (
    <div>
      <PageHeader overline="Production" title="Sales Orders" />
      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Job</th>
                <th className="px-6 py-3 font-mono">From</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Total</th>
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="sales-orders-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-mono">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.from_estimate || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  <td className="px-6 py-3"><ReceiptBadge doc={r} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => sendEmail(r.id)} data-testid={`send-so-${r.id}`} title="Email to customer"><EnvelopeSimple size={16} /></Btn>
                      {NEXT[r.status] && <Btn variant="ghost" onClick={() => advance(r)} data-testid={`advance-so-${r.id}`}>{NEXT[r.status].replace("_", " ")}</Btn>}
                      {!r.invoice_id && <Btn variant="ghost" onClick={() => convert(r.id)} data-testid={`invoice-so-${r.id}`} title="Convert to invoice"><Receipt size={16} /> Invoice</Btn>}
                      <Btn variant="ghost" onClick={() => remove(r.id)} data-testid={`delete-so-${r.id}`}><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-6 py-10 text-center text-muted-foreground">No sales orders yet. Approve an estimate to create one.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
