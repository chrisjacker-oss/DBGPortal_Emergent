import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge } from "@/components/kit";
import { useAuth } from "@/context/AuthContext";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import ActionsMenu from "@/components/ActionsMenu";
import { Trash, ClipboardText, Receipt, CheckCircle } from "@phosphor-icons/react";

const viewInvoice = (id) => window.open(`${process.env.REACT_APP_BACKEND_URL}/api/invoices/${id}/pdf?inline=1`, "_blank");

export default function Reorders() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const load = () => api.get("/reorders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const toggle = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const allChecked = rows.length > 0 && rows.every((r) => sel[r.id]);
  const toggleAll = () => { const n = {}; if (!allChecked) rows.forEach((r) => (n[r.id] = true)); setSel(n); };

  const bulkDelete = async (password) => {
    try {
      const { data } = await api.post("/reorders/bulk-delete", { ids: selIds, password });
      toast.success(`Deleted ${data.deleted} reorder(s)`);
      setSel({}); setBulkOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };

  const convert = async (r, target) => {
    try {
      const { data } = await api.post(`/reorders/${r.id}/convert`, null, { params: { target } });
      toast.success(`Created ${data.converted_number} · customer emailed`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Convert failed"); }
  };

  const markCompleted = async (r) => {
    try {
      await api.patch(`/reorders/${r.id}/status`, null, { params: { status: "completed" } });
      toast.success("Marked completed"); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update"); }
  };

  return (
    <div>
      <PageHeader overline="Customer Portal" title="Reorder Requests">
        {isAdmin && selIds.length > 0 && (
          <Btn variant="destructive" onClick={() => setBulkOpen(true)} data-testid="bulk-delete-reorders-btn"><Trash size={16} weight="bold" /> Delete ({selIds.length})</Btn>
        )}
      </PageHeader>
      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                {isAdmin && <th className="px-4 py-3 w-10">{rows.length > 0 && <input type="checkbox" checked={allChecked} onChange={toggleAll} data-testid="reorders-select-all" className="h-4 w-4 accent-[#0A0A0A]" />}</th>}
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Item</th>
                <th className="px-6 py-3 font-mono">Invoice</th>
                <th className="px-6 py-3 font-mono">Notes</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono">Converted</th>
                <th className="px-6 py-3 font-mono text-right">Action</th>
              </tr>
            </thead>
            <tbody data-testid="reorders-table">
              {rows.map((r) => {
                const convertedNum = r.converted_number || r.sales_order_number;
                const convertedType = r.converted_type === "invoice" ? "Invoice" : (convertedNum ? "Sales Order" : "");
                return (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  {isAdmin && <td className="px-4 py-3"><input type="checkbox" checked={!!sel[r.id]} onChange={() => toggle(r.id)} data-testid={`reorder-select-${r.id}`} className="h-4 w-4 accent-[#0A0A0A]" /></td>}
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3">{r.title}</td>
                  <td className="px-6 py-3 font-mono">
                    {r.source_invoice_number
                      ? <button onClick={() => viewInvoice(r.source_invoice_id)} data-testid={`reorder-invoice-${r.id}`} className="text-[#0E7490] hover:underline font-semibold" title="View the original invoice">{r.source_invoice_number}</button>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">{r.notes || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 font-mono text-muted-foreground" data-testid={`reorder-so-${r.id}`}>{convertedNum ? `${convertedType} ${convertedNum}` : "—"}</td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end">
                      <ActionsMenu testid={`reorder-actions-${r.id}`} items={[
                        { label: "Convert to Sales Order", icon: <ClipboardText size={16} />, onClick: () => convert(r, "sales_order"), testid: `convert-so-${r.id}`, hidden: !!r.converted_id },
                        { label: "Convert to Invoice", icon: <Receipt size={16} />, onClick: () => convert(r, "invoice"), testid: `convert-inv-${r.id}`, hidden: !!r.converted_id },
                        { label: "Mark completed", icon: <CheckCircle size={16} />, onClick: () => markCompleted(r), testid: `complete-reorder-${r.id}`, hidden: r.status === "completed" },
                      ]} />
                    </div>
                  </td>
                </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={isAdmin ? 8 : 7} className="px-6 py-10 text-center text-muted-foreground">No reorder requests.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <AdminDeleteDialog open={bulkOpen} label={`${selIds.length} reorder request(s)`} onClose={() => setBulkOpen(false)} onConfirm={bulkDelete} />
    </div>
  );
}
