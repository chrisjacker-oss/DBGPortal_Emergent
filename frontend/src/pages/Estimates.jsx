import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import { Plus, PencilSimple, Trash, ArrowRight } from "@phosphor-icons/react";

export default function Estimates() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = () => api.get("/estimates").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const save = async (payload) => {
    try {
      if (editing) await api.put(`/estimates/${editing.id}`, payload);
      else await api.post("/estimates", payload);
      toast.success("Estimate saved");
      setOpen(false); setEditing(null); load();
    } catch { toast.error("Save failed"); }
  };

  const convert = async (id) => {
    await api.post(`/estimates/${id}/convert`);
    toast.success("Converted to invoice");
    load();
  };
  const remove = async (id) => {
    if (!window.confirm("Delete estimate?")) return;
    await api.delete(`/estimates/${id}`); toast.success("Deleted"); load();
  };

  return (
    <div>
      <PageHeader overline="Sales" title="Estimates">
        <Btn onClick={() => { setEditing(null); setOpen(true); }} data-testid="add-estimate-btn"><Plus size={16} weight="bold" /> New Estimate</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Job</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Total</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="estimates-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-mono">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      {r.status !== "approved" && (
                        <Btn variant="ghost" onClick={() => convert(r.id)} data-testid={`convert-estimate-${r.id}`} title="Convert to invoice"><ArrowRight size={16} /></Btn>
                      )}
                      <Btn variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} data-testid={`edit-estimate-${r.id}`}><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => remove(r.id)} data-testid={`delete-estimate-${r.id}`}><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">No estimates yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="estimate" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
    </div>
  );
}
