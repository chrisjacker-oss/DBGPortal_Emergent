import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { downloadFile } from "@/lib/download";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import { Eye, DownloadSimple, Trash, Receipt, EnvelopeSimple, PencilSimple } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export default function PurchaseOrders() {
  const [rows, setRows] = useState([]);
  const [del, setDel] = useState(null);
  const [edit, setEdit] = useState(null); // PO being edited
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/purchase-orders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const viewPdf = (id) => window.open(`${process.env.REACT_APP_BACKEND_URL}/api/purchase-orders/${id}/pdf?inline=1`, "_blank");
  const emailPo = async (r) => {
    try { const { data } = await api.post(`/purchase-orders/${r.id}/email`); toast.success(`PO emailed to ${data.to}`); }
    catch (e) { toast.error(e.response?.data?.detail || "Email failed"); }
  };
  const openEdit = (r) => {
    setForm({ number: r.number || "", salesman_name: r.salesman_name || "", customer_name: r.customer_name || "",
      invoice_number: r.invoice_number || "", commission_amount: r.commission_amount ?? "", notes: r.notes || "",
      date: (r.date || r.created_at || "").slice(0, 10) });
    setEdit(r);
  };
  const saveEdit = async () => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/purchase-orders/${edit.id}`, {
        ...form, commission_amount: form.commission_amount === "" ? undefined : Number(form.commission_amount),
      });
      setRows((rs) => rs.map((x) => (x.id === data.id ? data : x)));
      toast.success("Purchase order updated"); setEdit(null);
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };
  const confirmDelete = async (password) => {
    try {
      await api.delete(`/purchase-orders/${del.id}`, { data: { password } });
      toast.success("PO deleted"); setDel(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  return (
    <div>
      <PageHeader overline="Commission payouts" title="Purchase Orders" />
      <div className="p-8">
        <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
          Purchase orders are generated from an invoice's sales commission (numbering starts at PO-1600). Open an invoice and use <b>Generate Commission PO</b> to create one.
        </p>
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">PO #</th>
                <th className="px-6 py-3 font-mono">Pay To</th>
                <th className="px-6 py-3 font-mono">Invoice</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Date</th>
                <th className="px-6 py-3 font-mono text-right">Amount</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="purchase-orders-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50" data-testid={`po-row-${r.id}`}>
                  <td className="px-6 py-3 font-mono font-semibold text-[#A21CAF]">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.salesman_name}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.invoice_number}</td>
                  <td className="px-6 py-3">{r.customer_name}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{(r.created_at || "").slice(0, 10)}</td>
                  <td className="px-6 py-3 text-right font-mono font-semibold">{currency(r.commission_amount)}</td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => viewPdf(r.id)} data-testid={`view-po-${r.id}`} title="View PDF"><Eye size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => openEdit(r)} data-testid={`edit-po-${r.id}`} title="Edit"><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => emailPo(r)} data-testid={`email-po-${r.id}`} title="Email to salesman"><EnvelopeSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => downloadFile(`/purchase-orders/${r.id}/pdf`, `${r.number}.pdf`, "application/pdf")} data-testid={`download-po-${r.id}`} title="Download PDF"><DownloadSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => setDel(r)} data-testid={`delete-po-${r.id}`} title="Delete"><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-muted-foreground"><Receipt size={26} className="mx-auto mb-2 opacity-50" />No purchase orders yet — generate one from an invoice's commission.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <AdminDeleteDialog open={!!del} label={`purchase order ${del?.number || ""}`} onClose={() => setDel(null)} onConfirm={confirmDelete} />

      <Dialog open={!!edit} onOpenChange={(o) => !o && !busy && setEdit(null)}>
        <DialogContent className="rounded-none max-w-lg" data-testid="edit-po-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Edit Purchase Order</DialogTitle>
            <DialogDescription className="font-mono text-xs">All fields are editable. Changes appear on the PO PDF.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="PO #" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} testid="po-number" />
            <Inp label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} testid="po-date" />
            <Inp label="Pay To (salesman)" value={form.salesman_name} onChange={(e) => setForm({ ...form, salesman_name: e.target.value })} testid="po-salesman" />
            <Inp label="Amount (USD)" type="number" value={form.commission_amount} onChange={(e) => setForm({ ...form, commission_amount: e.target.value })} testid="po-amount" />
            <Inp label="Invoice #" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} testid="po-invoice" />
            <Inp label="Customer" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} testid="po-customer" />
          </div>
          <label className="block">
            <span className="overline text-muted-foreground">Notes</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="po-notes" rows={2}
              className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
          </label>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setEdit(null)} disabled={busy}>Cancel</Btn>
            <Btn onClick={saveEdit} disabled={busy} data-testid="po-save-btn">{busy ? "Saving…" : "Save changes"}</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
