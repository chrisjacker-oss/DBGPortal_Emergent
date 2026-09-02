import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge, ReceiptBadge } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import InternalNoteDialog from "@/components/InternalNoteDialog";
import { Plus, PencilSimple, Trash, CheckCircle, EnvelopeSimple, LockKey } from "@phosphor-icons/react";

export default function Estimates() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delEst, setDelEst] = useState(null);
  const [noteDoc, setNoteDoc] = useState(null);
  const [params] = useSearchParams();
  const focusId = params.get("focus");
  const focusRef = useRef(null);

  const load = () => api.get("/estimates").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (focusId && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, [focusId, rows]);

  const save = async (payload) => {
    try {
      if (editing) await api.put(`/estimates/${editing.id}`, payload);
      else await api.post("/estimates", payload);
      toast.success("Estimate saved");
      setOpen(false); setEditing(null); load();
    } catch { toast.error("Save failed"); }
  };

  const approve = async (id) => {
    try {
      const { data } = await api.post(`/estimates/${id}/approve`);
      toast.success(`Approved → Sales Order ${data.number}`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Approve failed"); }
  };
  const sendEmail = async (id) => {
    try {
      const { data } = await api.post(`/estimates/${id}/send`);
      toast.success(`Emailed to ${data.to}`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Email failed"); }
  };
  const confirmDelete = async (password) => {
    try {
      await api.delete(`/estimates/${delEst.id}`, { data: { password } });
      toast.success("Estimate deleted"); setDelEst(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
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
                <th className="px-6 py-3 font-mono">Salesman</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Commission</th>
                <th className="px-6 py-3 font-mono text-right">Total</th>
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="estimates-table">
              {rows.map((r) => (
                <tr key={r.id} ref={r.id === focusId ? focusRef : null} data-testid={`estimate-row-${r.id}`} className={`border-b border-border last:border-0 hover:bg-secondary/50 ${r.id === focusId ? "ring-2 ring-[#0E7490] ring-inset bg-[#06B6D4]/5" : ""}`}>
                  <td className="px-6 py-3 font-mono">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.salesman_name || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono text-[#A21CAF]">{r.commission_amount ? `${currency(r.commission_amount)} (${r.commission_rate}%)` : "—"}</td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  <td className="px-6 py-3"><ReceiptBadge doc={r} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => sendEmail(r.id)} data-testid={`send-estimate-${r.id}`} title="Email to customer"><EnvelopeSimple size={16} /></Btn>
                      {r.status !== "approved" && (
                        <Btn variant="ghost" onClick={() => approve(r.id)} data-testid={`approve-estimate-${r.id}`} title="Approve → Sales Order"><CheckCircle size={16} /> Approve</Btn>
                      )}
                      <Btn variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} data-testid={`edit-estimate-${r.id}`}><PencilSimple size={16} /></Btn>
                      {isAdmin && (
                        <Btn variant="ghost" onClick={() => setNoteDoc(r)} data-testid={`note-estimate-${r.id}`} title="Internal note (admin only)"><LockKey size={16} /></Btn>
                      )}
                      {isAdmin && (
                        <Btn variant="ghost" onClick={() => setDelEst(r)} data-testid={`delete-estimate-${r.id}`} title="Delete"><Trash size={16} /></Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="px-6 py-10 text-center text-muted-foreground">No estimates yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="estimate" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
      <AdminDeleteDialog open={!!delEst} label={`estimate ${delEst?.number || ""}`} onClose={() => setDelEst(null)} onConfirm={confirmDelete} />
      <InternalNoteDialog open={!!noteDoc} number={noteDoc?.number} url={`/estimates/${noteDoc?.id}/internal-notes`} value={noteDoc?.internal_notes}
        onClose={() => setNoteDoc(null)} onSaved={(d) => setRows((rs) => rs.map((x) => (x.id === d.id ? { ...x, internal_notes: d.internal_notes } : x)))} />
    </div>
  );
}
