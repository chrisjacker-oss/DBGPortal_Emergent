import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { downloadFile } from "@/lib/download";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import { Eye, DownloadSimple, Trash, Receipt } from "@phosphor-icons/react";

export default function PurchaseOrders() {
  const [rows, setRows] = useState([]);
  const [del, setDel] = useState(null);

  const load = () => api.get("/purchase-orders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const viewPdf = (id) => window.open(`${process.env.REACT_APP_BACKEND_URL}/api/purchase-orders/${id}/pdf?inline=1`, "_blank");
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
    </div>
  );
}
