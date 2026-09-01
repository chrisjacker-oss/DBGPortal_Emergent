import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import { downloadCsv } from "@/lib/download";
import { Plus, PencilSimple, Trash, CheckCircle, DownloadSimple } from "@phosphor-icons/react";

export default function Invoices() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = () => api.get("/invoices").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const save = async (payload) => {
    try {
      if (editing) await api.put(`/invoices/${editing.id}`, payload);
      else await api.post("/invoices", payload);
      toast.success("Invoice saved");
      setOpen(false); setEditing(null); load();
    } catch { toast.error("Save failed"); }
  };

  const markPaid = async (id) => {
    await api.patch(`/invoices/${id}/status`, null, { params: { status: "paid" } });
    toast.success("Marked paid"); load();
  };
  const remove = async (id) => {
    if (!window.confirm("Delete invoice?")) return;
    await api.delete(`/invoices/${id}`); toast.success("Deleted"); load();
  };

  return (
    <div>
      <PageHeader overline="Billing" title="Invoices">
        <Btn variant="outline" onClick={() => downloadCsv("/export/xero/invoices", "xero_invoices.csv")} data-testid="export-xero-invoices-btn">
          <DownloadSimple size={16} weight="bold" /> Export to Xero
        </Btn>
        <Btn onClick={() => { setEditing(null); setOpen(true); }} data-testid="add-invoice-btn"><Plus size={16} weight="bold" /> New Invoice</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Job</th>
                <th className="px-6 py-3 font-mono">Due</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Total</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="invoices-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-mono">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.due_date || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      {r.status !== "paid" && (
                        <Btn variant="ghost" onClick={() => markPaid(r.id)} data-testid={`mark-paid-${r.id}`} title="Mark paid"><CheckCircle size={16} /></Btn>
                      )}
                      <Btn variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} data-testid={`edit-invoice-${r.id}`}><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => remove(r.id)} data-testid={`delete-invoice-${r.id}`}><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="invoice" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
    </div>
  );
}
