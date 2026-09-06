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
import ActionsMenu from "@/components/ActionsMenu";
import { MarginCell } from "@/components/MarginCell";
import { Plus, PencilSimple, Trash, CheckCircle, EnvelopeSimple, LockKey, Eye, Printer } from "@phosphor-icons/react";
const viewDocPdf = (path) => window.open(`${process.env.REACT_APP_BACKEND_URL}/api${path}?inline=1`, "_blank");
const printDoc = (path) => {
  const w = window.open(`${process.env.REACT_APP_BACKEND_URL}/api${path}?inline=1`, "_blank");
  if (!w) { toast.error("Please allow pop-ups to print"); return; }
  const go = () => { try { w.focus(); w.print(); } catch (e) { /* PDF viewer print toolbar available */ } };
  w.addEventListener?.("load", go);
  setTimeout(go, 1200);
};

export default function Estimates() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isSalesman = user?.role === "salesman";
  const canSeeMargin = user?.role === "admin" || user?.role === "salesman";
  const [rows, setRows] = useState([]);
  const [lowThreshold, setLowThreshold] = useState(0);
  const [sel, setSel] = useState({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delEst, setDelEst] = useState(null);
  const [noteDoc, setNoteDoc] = useState(null);
  const [params] = useSearchParams();
  const focusId = params.get("focus");
  const focusRef = useRef(null);

  const load = () => api.get("/estimates").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get("/settings").then((r) => setLowThreshold(Number(r.data.low_margin_threshold || 0))).catch(() => {}); }, []);
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

  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const allChecked = rows.length > 0 && rows.every((r) => sel[r.id]);
  const toggleAll = () => { const n = {}; if (!allChecked) rows.forEach((r) => (n[r.id] = true)); setSel(n); };
  const bulkDelete = async (password) => {
    try {
      const { data } = await api.post("/estimates/bulk-delete", { ids: selIds, password });
      toast.success(`Deleted ${data.deleted} estimate(s)`); setBulkOpen(false); setSel({}); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  return (
    <div>
      <PageHeader overline="Sales" title="Estimates">
        {isAdmin && selIds.length > 0 && <Btn variant="outline" onClick={() => setBulkOpen(true)} data-testid="bulk-delete-estimates-btn"><Trash size={16} weight="bold" /> Delete {selIds.length}</Btn>}
        <Btn onClick={() => { setEditing(null); setOpen(true); }} data-testid="add-estimate-btn"><Plus size={16} weight="bold" /> New Estimate</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                {isAdmin && <th className="px-4 py-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} data-testid="estimate-select-all" className="h-4 w-4 accent-[#0A0A0A]" /></th>}
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Job</th>
                <th className="px-6 py-3 font-mono">Salesman</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Commission</th>
                <th className="px-6 py-3 font-mono text-right">Total</th>
                {canSeeMargin && <th className="px-6 py-3 font-mono text-right text-[#0E7490]">Margin</th>}
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="estimates-table">
              {rows.map((r) => (
                <tr key={r.id} ref={r.id === focusId ? focusRef : null} data-testid={`estimate-row-${r.id}`} className={`border-b border-border last:border-0 hover:bg-secondary/50 ${r.id === focusId ? "ring-2 ring-[#0E7490] ring-inset bg-[#06B6D4]/5" : ""}`}>
                  {isAdmin && <td className="px-4 py-3"><input type="checkbox" checked={!!sel[r.id]} onChange={() => setSel((s) => ({ ...s, [r.id]: !s[r.id] }))} data-testid={`estimate-select-${r.id}`} className="h-4 w-4 accent-[#0A0A0A]" /></td>}
                  <td className="px-6 py-3 font-mono">
                    <button onClick={() => { setEditing(r); setOpen(true); }} data-testid={`estimate-number-${r.id}`} className="text-[#0E7490] hover:underline font-semibold">{r.number}</button>
                  </td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.salesman_name || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono text-[#A21CAF]">{r.commission_amount ? `${currency(r.commission_amount)} (${r.commission_rate}%)` : "—"}</td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  {canSeeMargin && <MarginCell row={r} threshold={lowThreshold} testid={`estimate-margin-${r.id}`} />}
                  <td className="px-6 py-3"><ReceiptBadge doc={r} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end">
                      <ActionsMenu testid={`estimate-actions-${r.id}`} items={[
                        { label: "Web view", icon: <Eye size={16} />, onClick: () => viewDocPdf(`/estimates/${r.id}/pdf`), testid: `view-estimate-${r.id}`, hidden: isSalesman },
                        { label: "Print", icon: <Printer size={16} />, onClick: () => printDoc(`/estimates/${r.id}/pdf`), testid: `print-estimate-${r.id}`, hidden: isSalesman },
                        { label: "Email to customer", icon: <EnvelopeSimple size={16} />, onClick: () => sendEmail(r.id), testid: `send-estimate-${r.id}` },
                        { label: "Approve → Sales Order", icon: <CheckCircle size={16} />, onClick: () => approve(r.id), testid: `approve-estimate-${r.id}`, hidden: r.status === "approved" || isSalesman },
                        { label: "Edit", icon: <PencilSimple size={16} />, onClick: () => { setEditing(r); setOpen(true); }, testid: `edit-estimate-${r.id}`, hidden: isSalesman },
                        { label: "Internal note", icon: <LockKey size={16} />, onClick: () => setNoteDoc(r), testid: `note-estimate-${r.id}`, hidden: !isAdmin },
                        { separator: true, hidden: !isAdmin },
                        { label: "Delete", icon: <Trash size={16} />, onClick: () => setDelEst(r), testid: `delete-estimate-${r.id}`, danger: true, hidden: !isAdmin },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9 + (canSeeMargin ? 1 : 0) + (isAdmin ? 1 : 0)} className="px-6 py-10 text-center text-muted-foreground">No estimates yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="estimate" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
      <AdminDeleteDialog open={!!delEst} label={`estimate ${delEst?.number || ""}`} onClose={() => setDelEst(null)} onConfirm={confirmDelete} />
      <AdminDeleteDialog open={bulkOpen} label={`${selIds.length} selected estimate(s)`} onClose={() => setBulkOpen(false)} onConfirm={bulkDelete} />
      <InternalNoteDialog open={!!noteDoc} number={noteDoc?.number} url={`/estimates/${noteDoc?.id}/internal-notes`} value={noteDoc?.internal_notes}
        onClose={() => setNoteDoc(null)} onSaved={(d) => setRows((rs) => rs.map((x) => (x.id === d.id ? { ...x, internal_notes: d.internal_notes } : x)))} />
    </div>
  );
}
