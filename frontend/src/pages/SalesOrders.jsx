import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge, ReceiptBadge, WorkStatusSelect, TrackingLink } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import SendDialog from "@/components/SendDialog";
import ActionsMenu from "@/components/ActionsMenu";
import { MarginCell } from "@/components/MarginCell";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import InternalNoteDialog from "@/components/InternalNoteDialog";
import { Receipt, Trash, EnvelopeSimple, Plus, PencilSimple, Prohibit, ArrowCounterClockwise, LockKey, Eye, Printer, CopySimple } from "@phosphor-icons/react";
const viewDocPdf = (path) => window.open(`${process.env.REACT_APP_BACKEND_URL}/api${path}?inline=1`, "_blank");
const printDoc = (path) => {
  const w = window.open(`${process.env.REACT_APP_BACKEND_URL}/api${path}?inline=1`, "_blank");
  if (!w) { toast.error("Please allow pop-ups to print"); return; }
  const go = () => { try { w.focus(); w.print(); } catch (e) { /* PDF viewer print toolbar available */ } };
  w.addEventListener?.("load", go);
  setTimeout(go, 1200);
};

export default function SalesOrders() {
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
  const [delSo, setDelSo] = useState(null);
  const [noteDoc, setNoteDoc] = useState(null);
  const [sendDoc, setSendDoc] = useState(null);
  const [tab, setTab] = useState("active");
  const [params] = useSearchParams();
  const focusId = params.get("focus");
  const focusRef = useRef(null);
  const load = () => api.get("/sales-orders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get("/settings").then((r) => setLowThreshold(Number(r.data.low_margin_threshold || 0))).catch(() => {}); }, []);
  useEffect(() => { if (focusId && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, [focusId, rows]);

  const save = async (payload) => {
    try {
      if (editing) await api.put(`/sales-orders/${editing.id}`, payload);
      else await api.post("/sales-orders", payload);
      toast.success("Sales order saved");
      setOpen(false); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const sendEmail = (id) => { const r = rows.find((x) => x.id === id); if (r) setSendDoc(r); };
  const duplicate = async (id) => {
    try { const { data } = await api.post(`/sales-orders/${id}/duplicate`); toast.success(`Copied → ${data.number}`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Copy failed"); }
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

  const visible = rows.filter((r) => {
    if (tab === "voided") return r.voided;
    if (tab === "approved") return !r.voided && !!r.invoice_id;
    return !r.voided && !r.invoice_id;
  });
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const allChecked = visible.length > 0 && visible.every((r) => sel[r.id]);
  const toggleAll = () => { const n = {}; if (!allChecked) visible.forEach((r) => (n[r.id] = true)); setSel(n); };
  const bulkDelete = async (password) => {
    try {
      const { data } = await api.post("/sales-orders/bulk-delete", { ids: selIds, password });
      toast.success(`Deleted ${data.deleted} sales order(s)`); setBulkOpen(false); setSel({}); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };
  const changeWork = async (r, status) => {
    if (!status || status === r.work_status) return;
    try {
      const { data } = await api.patch(`/sales-orders/${r.id}/work-status`, null, { params: { status } });
      toast.success(`Work status set · customer emailed`);
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, work_status: data.work_status } : x)));
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update work status"); }
  };

  return (
    <div>
      <PageHeader overline="Production" title="Sales Orders">
        {isAdmin && selIds.length > 0 && <Btn variant="outline" onClick={() => setBulkOpen(true)} data-testid="bulk-delete-so-btn"><Trash size={16} weight="bold" /> Delete {selIds.length}</Btn>}
        <Btn onClick={() => { setEditing(null); setOpen(true); }} data-testid="add-so-btn"><Plus size={16} weight="bold" /> New Sales Order</Btn>
      </PageHeader>
      <div className="p-8">
        <div className="flex gap-2 mb-4" data-testid="so-tabs">
          <Btn variant={tab === "active" ? "solid" : "outline"} onClick={() => setTab("active")} data-testid="so-tab-active">Active</Btn>
          <Btn variant={tab === "approved" ? "solid" : "outline"} onClick={() => setTab("approved")} data-testid="so-tab-approved">Approved (Invoiced)</Btn>
          <Btn variant={tab === "voided" ? "solid" : "outline"} onClick={() => setTab("voided")} data-testid="so-tab-voided">Voided</Btn>
        </div>
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                {isAdmin && <th className="px-4 py-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} data-testid="so-select-all" className="h-4 w-4 accent-[#0A0A0A]" /></th>}
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Job</th>
                <th className="px-6 py-3 font-mono">Order Date</th>
                <th className="px-6 py-3 font-mono">From</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono">Work status</th>
                <th className="px-6 py-3 font-mono">Tracking #</th>
                <th className="px-6 py-3 font-mono text-right">Total</th>
                {canSeeMargin && <th className="px-6 py-3 font-mono text-right text-[#0E7490]">Margin</th>}
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="sales-orders-table">
              {visible.map((r) => (
                <tr key={r.id} ref={r.id === focusId ? focusRef : null} data-testid={`so-row-${r.id}`} className={`border-b border-border last:border-0 hover:bg-secondary/50 ${r.id === focusId ? "ring-2 ring-[#0E7490] ring-inset bg-[#06B6D4]/5" : ""}`}>
                  {isAdmin && <td className="px-4 py-3"><input type="checkbox" checked={!!sel[r.id]} onChange={() => setSel((s) => ({ ...s, [r.id]: !s[r.id] }))} data-testid={`so-select-${r.id}`} className="h-4 w-4 accent-[#0A0A0A]" /></td>}
                  <td className="px-6 py-3 font-mono">
                    <button onClick={() => { setEditing(r); setOpen(true); }} data-testid={`so-number-${r.id}`} className="text-[#0E7490] hover:underline font-semibold">{r.number}</button>
                  </td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.order_date || "—"}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.from_estimate || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3"><WorkStatusSelect value={r.work_status} onChange={(s) => changeWork(r, s)} disabled={isSalesman || r.voided} testid={`so-work-status-${r.id}`} /></td>
                  <td className="px-6 py-3 font-mono text-muted-foreground" data-testid={`so-tracking-cell-${r.id}`}><TrackingLink value={r.tracking_number} shipType={r.shipping_type} shippedDate={r.shipped_date} testid={`so-tracking-${r.id}`} /></td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  {canSeeMargin && <MarginCell row={r} threshold={lowThreshold} testid={`so-margin-${r.id}`} />}
                  <td className="px-6 py-3"><ReceiptBadge doc={r} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end">
                      <ActionsMenu testid={`so-actions-${r.id}`} items={[
                        { label: "Web view", icon: <Eye size={16} />, onClick: () => viewDocPdf(`/sales-orders/${r.id}/pdf`), testid: `view-so-doc-${r.id}`, hidden: isSalesman },
                        { label: "Print", icon: <Printer size={16} />, onClick: () => printDoc(`/sales-orders/${r.id}/pdf`), testid: `print-so-${r.id}` },
                        { label: "Email to customer", icon: <EnvelopeSimple size={16} />, onClick: () => sendEmail(r.id), testid: `send-so-${r.id}`, hidden: r.voided },
                        { label: "Create a copy", icon: <CopySimple size={16} />, onClick: () => duplicate(r.id), testid: `duplicate-so-${r.id}` },
                        { label: "Convert to invoice", icon: <Receipt size={16} />, onClick: () => convert(r.id), testid: `invoice-so-${r.id}`, hidden: r.voided || !!r.invoice_id || isSalesman },
                        { label: "Edit", icon: <PencilSimple size={16} />, onClick: () => { setEditing(r); setOpen(true); }, testid: `edit-so-${r.id}`, hidden: r.voided || isSalesman },
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
              {visible.length === 0 && <tr><td colSpan={11 + (canSeeMargin ? 1 : 0) + (isAdmin ? 1 : 0)} className="px-6 py-10 text-center text-muted-foreground">No {tab} sales orders.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="sales-order" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
      <SendDialog open={!!sendDoc} doc={sendDoc} path="/sales-orders" kindLabel="sales order" onClose={() => setSendDoc(null)} onSent={load} />
      <AdminDeleteDialog open={!!delSo} label={`sales order ${delSo?.number || ""}`} onClose={() => setDelSo(null)} onConfirm={confirmDelete} />
      <AdminDeleteDialog open={bulkOpen} label={`${selIds.length} selected sales order(s)`} onClose={() => setBulkOpen(false)} onConfirm={bulkDelete} />
      <InternalNoteDialog open={!!noteDoc} number={noteDoc?.number} url={`/sales-orders/${noteDoc?.id}/internal-notes`} value={noteDoc?.internal_notes}
        onClose={() => setNoteDoc(null)} onSaved={(d) => setRows((rs) => rs.map((x) => (x.id === d.id ? { ...x, internal_notes: d.internal_notes } : x)))} />
    </div>
  );
}
