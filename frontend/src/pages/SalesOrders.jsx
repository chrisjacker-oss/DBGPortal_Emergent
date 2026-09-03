import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge, ReceiptBadge } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import ActionsMenu from "@/components/ActionsMenu";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import InternalNoteDialog from "@/components/InternalNoteDialog";
import { Receipt, Trash, EnvelopeSimple, Plus, PencilSimple, Prohibit, ArrowCounterClockwise, LockKey, Eye } from "@phosphor-icons/react";
const viewDocPdf = (path) => window.open(`${process.env.REACT_APP_BACKEND_URL}/api${path}?inline=1`, "_blank");

const NEXT = { open: "in_production", in_production: "fulfilled" };

export default function SalesOrders() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canSeeMargin = user?.role === "admin" || user?.role === "salesman";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delSo, setDelSo] = useState(null);
  const [noteDoc, setNoteDoc] = useState(null);
  const [tab, setTab] = useState("active");
  const [params] = useSearchParams();
  const focusId = params.get("focus");
  const focusRef = useRef(null);
  const load = () => api.get("/sales-orders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (focusId && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, [focusId, rows]);

  const save = async (payload) => {
    try {
      if (editing) await api.put(`/sales-orders/${editing.id}`, payload);
      else await api.post("/sales-orders", payload);
      toast.success("Sales order saved");
      setOpen(false); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

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
  const setVoid = async (id, voided) => {
    try {
      await api.patch(`/sales-orders/${id}/void`, null, { params: { voided } });
      toast.success(voided ? "Sales order voided" : "Sales order reactivated"); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const confirmDelete = async (password) => {
    try {
      await api.delete(`/sales-orders/${delSo.id}`, { data: { password } });
      toast.success("Sales order deleted"); setDelSo(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  const visible = rows.filter((r) => (tab === "voided" ? r.voided : !r.voided));

  return (
    <div>
      <PageHeader overline="Production" title="Sales Orders">
        <Btn onClick={() => { setEditing(null); setOpen(true); }} data-testid="add-so-btn"><Plus size={16} weight="bold" /> New Sales Order</Btn>
      </PageHeader>
      <div className="p-8">
        <div className="flex gap-2 mb-4" data-testid="so-tabs">
          <Btn variant={tab === "active" ? "solid" : "outline"} onClick={() => setTab("active")} data-testid="so-tab-active">Active</Btn>
          <Btn variant={tab === "voided" ? "solid" : "outline"} onClick={() => setTab("voided")} data-testid="so-tab-voided">Voided</Btn>
        </div>
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
                {canSeeMargin && <th className="px-6 py-3 font-mono text-right text-[#0E7490]">Margin</th>}
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="sales-orders-table">
              {visible.map((r) => (
                <tr key={r.id} ref={r.id === focusId ? focusRef : null} data-testid={`so-row-${r.id}`} className={`border-b border-border last:border-0 hover:bg-secondary/50 ${r.id === focusId ? "ring-2 ring-[#0E7490] ring-inset bg-[#06B6D4]/5" : ""}`}>
                  <td className="px-6 py-3 font-mono">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.from_estimate || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  {canSeeMargin && (
                    <td className="px-6 py-3 text-right font-mono" data-testid={`so-margin-${r.id}`}>
                      <span className="text-[#16A34A] font-semibold">{currency(r.material_margin || 0)}</span>
                      <div className="text-[11px] text-muted-foreground font-sans">{Number(r.material_margin_pct || 0).toFixed(0)}%</div>
                    </td>
                  )}
                  <td className="px-6 py-3"><ReceiptBadge doc={r} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end">
                      <ActionsMenu testid={`so-actions-${r.id}`} items={[
                        { label: "Web view", icon: <Eye size={16} />, onClick: () => viewDocPdf(`/sales-orders/${r.id}/pdf`), testid: `view-so-doc-${r.id}` },
                        { label: "Email to customer", icon: <EnvelopeSimple size={16} />, onClick: () => sendEmail(r.id), testid: `send-so-${r.id}`, hidden: r.voided },
                        { label: NEXT[r.status] ? `Advance → ${NEXT[r.status].replace("_", " ")}` : "", icon: <ArrowCounterClockwise size={16} />, onClick: () => advance(r), testid: `advance-so-${r.id}`, hidden: r.voided || !NEXT[r.status] },
                        { label: "Convert to invoice", icon: <Receipt size={16} />, onClick: () => convert(r.id), testid: `invoice-so-${r.id}`, hidden: r.voided || !!r.invoice_id },
                        { label: "Edit", icon: <PencilSimple size={16} />, onClick: () => { setEditing(r); setOpen(true); }, testid: `edit-so-${r.id}`, hidden: r.voided },
                        { label: "Void", icon: <Prohibit size={16} />, onClick: () => setVoid(r.id, true), testid: `void-so-${r.id}`, hidden: !isAdmin || r.voided },
                        { label: "Reactivate", icon: <ArrowCounterClockwise size={16} />, onClick: () => setVoid(r.id, false), testid: `reactivate-so-${r.id}`, hidden: !isAdmin || !r.voided },
                        { label: "Internal note", icon: <LockKey size={16} />, onClick: () => setNoteDoc(r), testid: `note-so-${r.id}`, hidden: !isAdmin },
                        { separator: true, hidden: !isAdmin },
                        { label: "Delete", icon: <Trash size={16} />, onClick: () => setDelSo(r), testid: `delete-so-${r.id}`, danger: true, hidden: !isAdmin },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={8 + (canSeeMargin ? 1 : 0)} className="px-6 py-10 text-center text-muted-foreground">No {tab} sales orders.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="sales-order" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
      <AdminDeleteDialog open={!!delSo} label={`sales order ${delSo?.number || ""}`} onClose={() => setDelSo(null)} onConfirm={confirmDelete} />
      <InternalNoteDialog open={!!noteDoc} number={noteDoc?.number} url={`/sales-orders/${noteDoc?.id}/internal-notes`} value={noteDoc?.internal_notes}
        onClose={() => setNoteDoc(null)} onSaved={(d) => setRows((rs) => rs.map((x) => (x.id === d.id ? { ...x, internal_notes: d.internal_notes } : x)))} />
    </div>
  );
}
