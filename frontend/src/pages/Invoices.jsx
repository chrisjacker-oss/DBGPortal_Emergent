import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge, ReceiptBadge, WorkStatusSelect, TrackingLink, PaymentState } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import SendDialog from "@/components/SendDialog";
import PaymentRequestDialog from "@/components/PaymentRequestDialog";
import ActionConfirmDialog from "@/components/ActionConfirmDialog";
import PayNowDialog from "@/components/PayNowDialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import RecordPaymentDialog from "@/components/RecordPaymentDialog";
import ActionsMenu from "@/components/ActionsMenu";
import { MarginCell } from "@/components/MarginCell";
import { downloadFile } from "@/lib/download";
import { Plus, PencilSimple, Trash, CheckCircle, DownloadSimple, EnvelopeSimple, FilePdf, CreditCard, Prohibit, ArrowCounterClockwise, ClockCounterClockwise, Printer, LockKey, Eye, Receipt, CopySimple } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export default function Invoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isSalesman = user?.role === "salesman";
  const canEditDocuments = isAdmin || isSalesman;
  const canSeeMargin = user?.role === "admin" || user?.role === "salesman";
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sendDoc, setSendDoc] = useState(null);
  const [paymentDoc, setPaymentDoc] = useState(null);
  const [actionConfirm, setActionConfirm] = useState(null);
  const [payInv, setPayInv] = useState(null);
  const [delInv, setDelInv] = useState(null);
  const [recInv, setRecInv] = useState(null);
  const [histInv, setHistInv] = useState(null);
  const [histRows, setHistRows] = useState([]);
  const [detailInv, setDetailInv] = useState(null);
  const [detailPays, setDetailPays] = useState([]);
  const [lineage, setLineage] = useState(null);
  const [internalDraft, setInternalDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [tab, setTab] = useState("active");
  const [lowThreshold, setLowThreshold] = useState(0);
  const [sel, setSel] = useState({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [sortKey, setSortKey] = useState("");
  const [pFrom, setPFrom] = useState("");
  const [pTo, setPTo] = useState("");
  const [acctMonth, setAcctMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [xeroOpen, setXeroOpen] = useState(false);
  const [xeroMonth, setXeroMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [xeroBusy, setXeroBusy] = useState(false);
  const [inZeroSaving, setInZeroSaving] = useState({});
  const [params] = useSearchParams();
  const focusId = params.get("focus");
  const openId = params.get("open");
  const focusRef = useRef(null);
  const openedFromSearchRef = useRef(null);
  useEffect(() => { if (focusId && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, [focusId, rows]);
  const exportInvoicesPdf = async () => {
    setXeroBusy(true);
    try {
      await downloadFile(`/export/invoices-pdf?month=${xeroMonth}`, `Invoices-${xeroMonth}.pdf`, "application/pdf");
      setXeroOpen(false);
    } catch { toast.error(`No invoices found for ${xeroMonth}`); }
    setXeroBusy(false);
  };
  useEffect(() => { setSortKey(""); setPFrom(""); setPTo(""); setSel({}); }, [tab]);

  const load = () => api.get("/invoices").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get("/settings").then((r) => { setLowThreshold(Number(r.data.low_margin_threshold || 0)); }).catch(() => {}); }, []);
  useEffect(() => {
    if (!openId || openedFromSearchRef.current === openId) return;
    const invoice = rows.find((row) => row.id === openId);
    if (!invoice) return;
    openedFromSearchRef.current = openId;
    openDetail(invoice);
  }, [openId, rows]);

  const openHistory = async (r) => {
    try {
      const { data } = await api.get(`/invoices/${r.id}/payments`);
      setHistRows(data); setHistInv(r);
    } catch { toast.error("Could not load payment history"); }
  };

  const openDetail = async (r) => {
    setDetailInv(r); setDetailPays([]); setLineage(null); setInternalDraft(r.internal_notes || "");
    api.get(`/invoices/${r.id}/payments`).then(({ data }) => setDetailPays(data)).catch(() => {});
    api.get(`/invoices/${r.id}/lineage`).then(({ data }) => setLineage(data)).catch(() => {});
  };

  const saveInternalNotes = async () => {
    setSavingNote(true);
    try {
      const { data } = await api.patch(`/invoices/${detailInv.id}/internal-notes`, { notes: internalDraft });
      setDetailInv(data);
      setRows((rs) => rs.map((x) => (x.id === data.id ? { ...x, internal_notes: data.internal_notes } : x)));
      toast.success("Internal note saved");
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSavingNote(false); }
  };

  const paidOf = (inv) => (inv?.status === "paid" ? Number(inv?.total || 0) : Number(inv?.amount_paid || 0));
  const viewPdf = (path) => window.open(`${process.env.REACT_APP_BACKEND_URL}/api${path}?inline=1`, "_blank");
  const printDoc = (path) => {
    const w = window.open(`${process.env.REACT_APP_BACKEND_URL}/api${path}?inline=1`, "_blank");
    if (!w) { toast.error("Please allow pop-ups to print"); return; }
    const go = () => { try { w.focus(); w.print(); } catch (e) { /* PDF viewer print toolbar available */ } };
    w.addEventListener?.("load", go);
    setTimeout(go, 1200);
  };
  const genCommissionPO = async () => {
    try {
      const { data } = await api.post(`/invoices/${detailInv.id}/commission-po`);
      toast.success(`Created ${data.number} for ${data.salesman_name}`);
      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/purchase-orders/${data.id}/pdf?inline=1`, "_blank");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not generate PO"); }
  };
  const printInvoice = () => {
    const inv = detailInv; if (!inv) return;
    const paid = paidOf(inv);
    const bal = Math.round((Number(inv.total || 0) - paid) * 100) / 100;
    const rowsHtml = (inv.line_items || []).map((li) => {
      const flat = flatCustomerCharge(li);
      const quantity = flat ? "—" : (li.quantity || 0);
      const unitPrice = flat ? "—" : currency(customerUnitPrice(li));
      return `
        <tr>
          <td>${(li.description || "").replace(/</g, "&lt;")}${li.details ? `<div style="color:#666;font-size:11px">${(li.details || "").replace(/</g, "&lt;")}</div>` : ""}</td>
          <td style="text-align:center">${(li.width_in || 0)}" × ${(li.height_in || 0)}"</td>
          <td style="text-align:right">${quantity}</td>
          <td style="text-align:right">${unitPrice}</td>
          <td style="text-align:right">${currency(li.line_total)}</td>
        </tr>`;
    }).join("");
    const paysHtml = (detailPays || []).map((p) => `
      <tr>
        <td>${p.date ? new Date(p.date).toLocaleString() : "—"}</td>
        <td>${(p.method || "").replace(/</g, "&lt;")}${p.notes ? `<div style="color:#666;font-size:11px">${(p.notes || "").replace(/</g, "&lt;")}</div>` : ""}</td>
        <td style="text-align:right">${currency(p.amount)}</td>
      </tr>`).join("") || `<tr><td colspan="3" style="color:#666">No payments recorded.</td></tr>`;
    const html = `<!doctype html><html><head><title>${inv.number}</title>
      <style>
        *{font-family:Arial,Helvetica,sans-serif;color:#0a0a0a}
        body{margin:32px}
        h1{font-size:26px;margin:0;letter-spacing:1px}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{border-bottom:1px solid #e5e7eb;padding:8px;text-align:left;font-size:13px}
        th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666}
        .muted{color:#666;font-size:12px}
        .tot{display:flex;justify-content:flex-end;gap:40px;font-size:13px;padding:4px 8px}
        .tot b{min-width:110px;display:inline-block;text-align:right}
        .bar{height:3px;background:#06b6d4;margin:14px 0}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h1>INVOICE</h1><div class="muted">DBG Signs, Inc. · Image Is Everything</div></div>
        <div style="text-align:right"><div style="font-size:18px;font-weight:bold">${inv.number}</div>
        <div class="muted">Status: ${(inv.status || "").toUpperCase()}</div></div>
      </div>
      <div class="bar"></div>
      <div style="display:flex;justify-content:space-between">
        <div><div class="muted">BILL TO</div><div style="font-weight:bold">${(inv.customer_name || "").replace(/</g, "&lt;")}</div>
        ${inv.contact_name ? `<div class="muted">Attn: ${inv.contact_name}</div>` : ""}</div>
        <div style="text-align:right"><div class="muted">Issued: ${(inv.created_at || "").slice(0, 10)}</div>
        <div class="muted">Est. Complete: ${inv.due_date || "—"}</div>${inv.net_terms ? `<div class="muted">Terms: ${inv.net_terms}</div>` : ""}</div>
      </div>
      ${inv.shipping_address ? `<div style="margin-top:12px;padding:10px;background:#f9fafb;border-left:3px solid #06b6d4"><div class="muted">SHIP TO</div><div style="white-space:pre-wrap">${String(inv.shipping_address).replace(/</g, "&lt;")}</div></div>` : ""}
      ${inv.title ? `<div style="margin-top:10px;font-weight:bold">${(inv.title || "").replace(/</g, "&lt;")}</div>` : ""}
      <table><thead><tr><th>Description</th><th style="text-align:center">W × H</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <div style="margin-top:12px">
        <div class="tot"><span>Subtotal</span><b>${currency(inv.subtotal)}</b></div>
        ${Number(inv.tax_amount || 0) > 0 ? `<div class="tot"><span>Tax (${inv.tax_rate}%)</span><b>${currency(inv.tax_amount)}</b></div>` : ""}
        <div class="tot" style="font-size:16px;font-weight:bold"><span>Total</span><b>${currency(inv.total)}</b></div>
        <div class="tot" style="color:#16a34a"><span>Paid</span><b>${currency(paid)}</b></div>
        <div class="tot" style="color:${bal > 0 ? "#dc2626" : "#16a34a"}"><span>Balance</span><b>${currency(bal)}</b></div>
      </div>
      <h3 style="margin-top:24px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#666">Payment history</h3>
      <table><thead><tr><th>Date</th><th>Method</th><th style="text-align:right">Amount</th></tr></thead><tbody>${paysHtml}</tbody></table>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank", "width=820,height=900");
    if (!w) { toast.error("Please allow pop-ups to print"); URL.revokeObjectURL(url); return; }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const save = async (payload) => {
    try {
      if (editing) await api.put(`/invoices/${editing.id}`, payload);
      else await api.post("/invoices", payload);
      toast.success("Invoice saved");
      setOpen(false); setEditing(null); load();
    } catch { toast.error("Save failed"); }
  };

  const setVoid = async (id, voided) => {
    try {
      await api.patch(`/invoices/${id}/void`, null, { params: { voided } });
      toast.success(voided ? "Invoice voided" : "Invoice reactivated"); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const confirmDelete = async (password) => {
    try {
      await api.delete(`/invoices/${delInv.id}`, { data: { password } });
      toast.success("Invoice deleted"); setDelInv(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };
  const sendEmail = (id) => { const r = rows.find((x) => x.id === id); if (r) setSendDoc(r); };
  const duplicate = async (id) => {
    try {
      const { data } = await api.post(`/invoices/${id}/duplicate`);
      toast.success(`Sales Order ${data.number} created`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not create sales order");
    }
  };

  const visible = rows.filter((r) => {
    if (r.voided) return tab === "voided";
    if (r.status === "paid") return tab === "paid";
    const emailed = !!r.email_sent_at;
    if (tab === "invoiced") return emailed;
    if (tab === "active") return !emailed;
    return false;
  });
  const isPaid = tab === "paid";
  const canDeleteCurrentInvoices = isAdmin && tab !== "invoiced" && !isPaid;
  const showComm = tab !== "voided";
  const filtered = isPaid ? visible.filter((r) => {
    const d = (r.paid_at || "").slice(0, 10);
    if (pFrom && d && d < pFrom) return false;
    if (pTo && d && d > pTo) return false;
    if ((pFrom || pTo) && !d) return false;
    return true;
  }) : visible;
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "customer") return (a.customer_name || "").localeCompare(b.customer_name || "");
    if (sortKey === "paid_desc") return (b.paid_at || "").localeCompare(a.paid_at || "");
    if (sortKey === "paid_asc") return (a.paid_at || "").localeCompare(b.paid_at || "");
    return 0;
  });
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const allChecked = sorted.length > 0 && sorted.every((r) => sel[r.id]);
  const toggleAll = () => { const n = {}; if (!allChecked) sorted.forEach((r) => (n[r.id] = true)); setSel(n); };
  const bulkDelete = async (password) => {
    try {
      const { data } = await api.post("/invoices/bulk-delete", { ids: selIds, password });
      toast.success(`Deleted ${data.deleted} invoice(s)`); setBulkOpen(false); setSel({}); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };
  const changeWork = async (r, status) => {
    if (!status || status === r.work_status) return;
    try {
      const { data } = await api.patch(`/invoices/${r.id}/work-status`, null, { params: { status } });
      toast.success(`Work status set · customer emailed`);
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, work_status: data.work_status } : x)));
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update work status"); }
  };
  const setInZero = async (r, inZero) => {
    if (Boolean(r.in_zero) === inZero) return;
    setInZeroSaving((current) => ({ ...current, [r.id]: true }));
    try {
      const { data } = await api.patch(`/invoices/${r.id}/in-zero`, { in_zero: inZero });
      setRows((current) => current.map((row) => (row.id === r.id ? data : row)));
      toast.success(`Input Zero marked ${inZero ? "Yes" : "No"}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not update Input Zero");
    } finally {
      setInZeroSaving((current) => ({ ...current, [r.id]: false }));
    }
  };

  return (
    <div>
      <PageHeader overline="Billing" title="Invoices">
        {canDeleteCurrentInvoices && selIds.length > 0 && <Btn variant="outline" onClick={() => setBulkOpen(true)} data-testid="bulk-delete-invoices-btn"><Trash size={16} weight="bold" /> Delete {selIds.length}</Btn>}
        <Btn variant="outline" onClick={() => setXeroOpen(true)} data-testid="export-xero-invoices-btn">
          <DownloadSimple size={16} weight="bold" /> Export to Xero
        </Btn>
        <Btn onClick={() => { setEditing(null); setOpen(true); }} data-testid="add-invoice-btn"><Plus size={16} weight="bold" /> New Invoice</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex gap-2" data-testid="invoice-tabs">
            <Btn variant={tab === "active" ? "solid" : "outline"} onClick={() => setTab("active")} data-testid="tab-active">Active</Btn>
            <Btn variant={tab === "invoiced" ? "solid" : "outline"} onClick={() => setTab("invoiced")} data-testid="tab-invoiced">Invoiced &amp; Waiting Payment</Btn>
            <Btn variant={tab === "paid" ? "solid" : "outline"} onClick={() => setTab("paid")} data-testid="tab-paid">Paid</Btn>
            <Btn variant={tab === "voided" ? "solid" : "outline"} onClick={() => setTab("voided")} data-testid="tab-voided">Voided</Btn>
          </div>
          <div className="flex items-end gap-3 ml-auto flex-wrap">
            {isAdmin && (
              <div className="flex items-end gap-2" data-testid="acct-month-export">
                <label className="block">
                  <span className="overline text-muted-foreground">Accounting export</span>
                  <input type="month" value={acctMonth} onChange={(e) => setAcctMonth(e.target.value)} data-testid="acct-month-input"
                    className="mt-1 block border border-input bg-card px-3 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <Btn variant="outline" onClick={async () => { try { await downloadFile(`/export/accounting-pdf?month=${acctMonth}`, `Accounting-${acctMonth}.pdf`, "application/pdf"); } catch { toast.error(`No paid invoices found for ${acctMonth}`); } }} data-testid="acct-month-download-btn">
                  <FilePdf size={16} weight="bold" /> Paid invoices PDF
                </Btn>
              </div>
            )}
            <label className="block">
              <span className="overline text-muted-foreground">Sort by</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} data-testid="invoice-sort" className="mt-1 block border border-input bg-card px-3 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Newest first</option>
                <option value="customer">Customer (A–Z)</option>
                {isPaid && <option value="paid_desc">Paid date (newest)</option>}
                {isPaid && <option value="paid_asc">Paid date (oldest)</option>}
              </select>
            </label>
            {isPaid && (
              <>
                <label className="block"><span className="overline text-muted-foreground">Paid from</span>
                  <input type="date" value={pFrom} onChange={(e) => setPFrom(e.target.value)} data-testid="inv-paid-from" className="mt-1 block border border-input bg-card px-3 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
                <label className="block"><span className="overline text-muted-foreground">Paid to</span>
                  <input type="date" value={pTo} onChange={(e) => setPTo(e.target.value)} data-testid="inv-paid-to" className="mt-1 block border border-input bg-card px-3 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
                {(pFrom || pTo) && <Btn variant="outline" onClick={() => { setPFrom(""); setPTo(""); }} data-testid="inv-paid-clear">Clear</Btn>}
              </>
            )}
          </div>
        </div>
        <div className="border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm font-semibold text-foreground">
            <thead>
              <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-[0.08em] text-foreground">
                {canDeleteCurrentInvoices && <th className="px-4 py-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} data-testid="invoice-select-all" className="h-4 w-4 accent-[#0A0A0A]" /></th>}
                <th className="px-6 py-3 font-mono">#</th>
                {isPaid && <th className="px-6 py-3 font-mono">Input Zero</th>}
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Job</th>
                <th className="px-6 py-3 font-mono">Order Date</th>
                <th className="px-6 py-3 font-mono">{isPaid ? "Paid Date" : "Due"}</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono">Work status</th>
                <th className="px-6 py-3 font-mono">Tracking #</th>
                {isPaid && <th className="px-6 py-3 font-mono">Payment Type</th>}
                <th className="px-6 py-3 font-mono text-right">Total</th>
                {canSeeMargin && <th className="px-6 py-3 font-mono text-right text-[#0E7490]">Margin</th>}
                {showComm && <th className="px-6 py-3 font-mono text-right">Commission</th>}
                {isPaid && <th className="px-6 py-3 font-mono">Notes</th>}
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="invoices-table">
              {sorted.map((r) => (
                <tr key={r.id} ref={r.id === focusId ? focusRef : null} data-testid={`invoice-row-${r.id}`} className={`border-b border-border last:border-0 hover:bg-secondary/50 ${r.id === focusId ? "ring-2 ring-[#0E7490] ring-inset bg-[#06B6D4]/5" : ""}`}>
                  {canDeleteCurrentInvoices && <td className="px-4 py-3"><input type="checkbox" checked={!!sel[r.id]} onChange={() => setSel((s) => ({ ...s, [r.id]: !s[r.id] }))} data-testid={`invoice-select-${r.id}`} className="h-4 w-4 accent-[#0A0A0A]" /></td>}
                  <td className="px-6 py-3 font-mono">
                    <button onClick={() => openDetail(r)} data-testid={`invoice-number-${r.id}`} className="text-[#0E7490] hover:underline font-semibold">{r.number}</button>
                  </td>
                  {isPaid && (
                    <td className="px-6 py-3">
                      {isAdmin ? (
                        <select
                          value={r.in_zero ? "yes" : "no"}
                          onChange={(event) => setInZero(r, event.target.value === "yes")}
                          disabled={!!inZeroSaving[r.id]}
                          data-testid={`invoice-in-zero-${r.id}`}
                          className={[
                            "border border-input bg-card px-2 py-1 text-sm rounded-none",
                            "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
                          ].join(" ")}
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      ) : (
                        <span data-testid={`invoice-in-zero-value-${r.id}`}>
                          {r.in_zero ? "Yes" : "No"}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.order_date || "—"}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{isPaid ? ((r.paid_at || "").slice(0, 10) || "—") : (r.payment_due_date || r.due_date || "—")}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3"><WorkStatusSelect value={r.work_status} onChange={(s) => changeWork(r, s)} disabled={r.voided} testid={`invoice-work-status-${r.id}`} /></td>
                  <td className="px-6 py-3 font-mono text-muted-foreground" data-testid={`invoice-tracking-cell-${r.id}`}><TrackingLink value={r.tracking_number} shipType={r.shipping_type} shippedDate={r.shipped_date} testid={`invoice-tracking-${r.id}`} /></td>
                  {isPaid && <td className="px-6 py-3 text-muted-foreground" data-testid={`payment-type-${r.id}`}>{r.payment_method || "—"}</td>}
                  <td className="px-6 py-3 text-right font-mono">
                    {currency(r.total)}
                    <div className="mt-1"><PaymentState doc={r} testid={`invoice-payment-${r.id}`} /></div>
                    {Number(r.amount_paid || 0) > 0 && r.status !== "paid" && (
                      <div className="text-[11px] text-[#F59E0B]" data-testid={`balance-${r.id}`}>Bal {currency(Number(r.total || 0) - Number(r.amount_paid || 0))}</div>
                    )}
                  </td>
                  {canSeeMargin && <MarginCell row={r} threshold={lowThreshold} testid={`invoice-margin-${r.id}`} />}
                  {showComm && (
                    <td className="px-6 py-3 text-right font-mono" data-testid={`invoice-commission-${r.id}`}>
                      {Number(r.commission_amount || 0) > 0 ? (
                        <>
                          <span className="text-[#A21CAF] font-semibold">{currency(r.commission_amount)}</span>
                          <div className="text-[11px] text-muted-foreground font-sans">{r.salesman_name || "—"}{r.commission_rate ? ` · ${r.commission_rate}%` : ""}</div>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  {isPaid && <td className="px-6 py-3 text-muted-foreground text-xs italic max-w-[200px]" data-testid={`payment-notes-${r.id}`}>{r.payment_notes ? `“${r.payment_notes}”` : "—"}</td>}
                  <td className="px-6 py-3"><ReceiptBadge doc={r} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end">
                      <ActionsMenu testid={`invoice-actions-${r.id}`} items={[
                        {
                          label: "Web view",
                          icon: <Eye size={16} />,
                          onClick: () => setActionConfirm({
                            title: `Open Invoice ${r.number}`,
                            description: "Open this invoice PDF in a new browser tab.",
                            confirmLabel: "Open PDF",
                            onConfirm: () => viewPdf(`/invoices/${r.id}/pdf`),
                          }),
                          testid: `view-invoice-${r.id}`,
                          hidden: isSalesman,
                        },
                        {
                          label: "Print",
                          icon: <Printer size={16} />,
                          onClick: () => setActionConfirm({
                            title: `Print Invoice ${r.number}`,
                            description: "Open the print view for this invoice.",
                            confirmLabel: "Open print view",
                            onConfirm: () => printDoc(`/invoices/${r.id}/pdf`),
                          }),
                          testid: `print-invoice-${r.id}`,
                        },
                        {
                          label: "Download PDF",
                          icon: <FilePdf size={16} />,
                          onClick: () => setActionConfirm({
                            title: `Download Invoice ${r.number}`,
                            description: "Download this invoice as a PDF file.",
                            confirmLabel: "Download PDF",
                            onConfirm: () => downloadFile(
                              `/invoices/${r.id}/pdf`,
                              `${r.number}.pdf`,
                              "application/pdf"
                            ),
                          }),
                          testid: `pdf-invoice-${r.id}`,
                          hidden: isSalesman,
                        },
                        { label: "Payment history", icon: <ClockCounterClockwise size={16} />, onClick: () => openHistory(r), testid: `history-invoice-${r.id}`, hidden: !(Number(r.amount_paid || 0) > 0 || r.status === "paid") || isSalesman },
                        { label: "Email to customer", icon: <EnvelopeSimple size={16} />, onClick: () => sendEmail(r.id), testid: `send-invoice-${r.id}`, hidden: r.voided },
                        { label: "COD/Deposit Email", icon: <CreditCard size={16} />, onClick: () => setPaymentDoc(r), testid: `payment-invoice-${r.id}`, hidden: r.voided || r.status === "paid" },
                        {
                          label: "Create Sales Order Copy",
                          icon: <CopySimple size={16} />,
                          onClick: () => setActionConfirm({
                            title: `Create Sales Order from ${r.number}?`,
                            description: `Create a new Sales Order for ${r.customer_name} with this invoice's details.`,
                            confirmLabel: "Create sales order",
                            onConfirm: () => duplicate(r.id),
                          }),
                          testid: `duplicate-invoice-${r.id}`,
                          hidden: !isAdmin,
                        },
                        { label: "Pay now (card)", icon: <CreditCard size={16} />, onClick: () => setPayInv(r), testid: `pay-invoice-${r.id}`, hidden: r.voided || r.status === "paid" || isSalesman },
                        { label: "Record payment", icon: <CheckCircle size={16} />, onClick: () => setRecInv(r), testid: `mark-paid-${r.id}`, hidden: r.voided || r.status === "paid" || isSalesman },
                        {
                          label: "Download to accounting",
                          icon: <FilePdf size={16} />,
                          onClick: () => setActionConfirm({
                            title: `Export Invoice ${r.number}`,
                            description: "Download this invoice for your accounting records.",
                            confirmLabel: "Download export",
                            onConfirm: () => downloadFile(
                              `/invoices/${r.id}/accounting-pdf`,
                              `Accounting-${r.number}.pdf`,
                              "application/pdf"
                            ),
                          }),
                          testid: `acct-pdf-invoice-${r.id}`,
                          hidden: !(Number(r.amount_paid || 0) > 0 || r.status === "paid") || isSalesman,
                        },
                        { label: "Edit", icon: <PencilSimple size={16} />, onClick: () => { setEditing(r); setOpen(true); }, testid: `edit-invoice-${r.id}`, hidden: r.voided || !canEditDocuments },
                        {
                          label: "Void",
                          icon: <Prohibit size={16} />,
                          onClick: () => setActionConfirm({
                            title: `Void Invoice ${r.number}`,
                            description: "Void this invoice. It can be reactivated later.",
                            confirmLabel: "Void invoice",
                            danger: true,
                            onConfirm: () => setVoid(r.id, true),
                          }),
                          testid: `void-invoice-${r.id}`,
                          hidden: !isAdmin || r.voided,
                        },
                        {
                          label: "Reactivate",
                          icon: <ArrowCounterClockwise size={16} />,
                          onClick: () => setActionConfirm({
                            title: `Reactivate Invoice ${r.number}`,
                            description: "Return this invoice to its active workflow.",
                            confirmLabel: "Reactivate",
                            onConfirm: () => setVoid(r.id, false),
                          }),
                          testid: `reactivate-invoice-${r.id}`,
                          hidden: !isAdmin || !r.voided,
                        },
                        { separator: true, hidden: !isAdmin },
                        { label: "Delete", icon: <Trash size={16} />, onClick: () => setDelInv(r), testid: `delete-invoice-${r.id}`, danger: true, hidden: !canDeleteCurrentInvoices },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={11 + (isPaid ? 3 : 0) + (showComm ? 1 : 0) +
                      (canSeeMargin ? 1 : 0) + (canDeleteCurrentInvoices ? 1 : 0)}
                    className="px-6 py-10 text-center text-muted-foreground"
                  >
                    No {tab} invoices.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="invoice" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
      <SendDialog open={!!sendDoc} doc={sendDoc} path="/invoices" kindLabel="invoice" onClose={() => setSendDoc(null)} onSent={load} />
      <PaymentRequestDialog open={!!paymentDoc} doc={paymentDoc} path="/invoices" kindLabel="Invoice" onClose={() => setPaymentDoc(null)} onSent={load} />
      <ActionConfirmDialog action={actionConfirm} onClose={() => setActionConfirm(null)} />
      <PayNowDialog open={!!payInv} invoice={payInv} onClose={() => setPayInv(null)} onPaid={() => { setPayInv(null); load(); }} />
      <RecordPaymentDialog open={!!recInv} invoice={recInv} onClose={() => setRecInv(null)} onSaved={() => { setRecInv(null); load(); }} />
      <AdminDeleteDialog open={!!delInv} label={`invoice ${delInv?.number || ""}`} onClose={() => setDelInv(null)} onConfirm={confirmDelete} />
      <AdminDeleteDialog open={bulkOpen} label={`${selIds.length} selected invoice(s)`} onClose={() => setBulkOpen(false)} onConfirm={bulkDelete} />

      <Dialog open={xeroOpen} onOpenChange={(o) => !o && setXeroOpen(false)}>
        <DialogContent className="rounded-none max-w-md" data-testid="xero-export-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Export invoices to Xero</DialogTitle>
            <DialogDescription className="font-mono text-xs">Downloads a PDF list of all invoices for the selected month (invoice #, date, customer, total, paid, balance, status).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="overline text-muted-foreground">Month</label>
            <input type="month" value={xeroMonth} onChange={(e) => setXeroMonth(e.target.value)} data-testid="xero-export-month"
              className="w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setXeroOpen(false)}>Cancel</Btn>
            <Btn variant="outline" onClick={async () => { setXeroBusy(true); try { await downloadFile(`/export/invoices-csv?month=${xeroMonth}`, `Invoices-${xeroMonth}.csv`, "text/csv"); setXeroOpen(false); } catch { toast.error(`No invoices found for ${xeroMonth}`); } setXeroBusy(false); }} disabled={xeroBusy || !xeroMonth} data-testid="xero-export-csv-btn"><DownloadSimple size={16} weight="bold" /> Download CSV</Btn>
            <Btn onClick={exportInvoicesPdf} disabled={xeroBusy || !xeroMonth} data-testid="xero-export-download-btn"><DownloadSimple size={16} weight="bold" /> {xeroBusy ? "Preparing…" : "Download PDF"}</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!histInv} onOpenChange={(o) => !o && setHistInv(null)}>
        <DialogContent className="rounded-none max-w-md" data-testid="payment-history-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Payments · {histInv?.number}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {currency(histInv?.amount_paid)} paid of {currency(histInv?.total)}
            </DialogDescription>
          </DialogHeader>
          {histRows.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">No card payments recorded.</div>
          ) : (
            <div className="divide-y divide-border" data-testid="payment-history-list">
              {histRows.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <div className="font-mono">{p.date ? new Date(p.date).toLocaleString() : "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.method}</div>
                    {p.notes && <div className="text-xs text-muted-foreground italic mt-0.5" data-testid={`payment-note-${i}`}>“{p.notes}”</div>}
                  </div>
                  <div className="font-mono font-semibold text-[#16A34A]">{currency(p.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailInv} onOpenChange={(o) => !o && setDetailInv(null)}>
        <DialogContent className="rounded-none max-w-3xl max-h-[88vh] overflow-y-auto" data-testid="invoice-detail-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-3">Invoice {detailInv?.number} <StatusBadge status={detailInv?.status} /></DialogTitle>
            <DialogDescription className="font-mono text-xs">{detailInv?.customer_name}{detailInv?.title ? ` · ${detailInv.title}` : ""}</DialogDescription>
          </DialogHeader>
          {detailInv && (
            <div className="space-y-5 text-sm">
              <StageTracker lineage={lineage} inv={detailInv} paidOf={paidOf} onGo={(to) => { setDetailInv(null); navigate(to); }} />

              {(lineage?.estimate || lineage?.sales_order) && (
                <div className="flex flex-wrap gap-2" data-testid="linked-docs">
                  {lineage?.estimate && (
                    <Btn variant="outline" onClick={() => viewPdf(`/estimates/${lineage.estimate.id}/pdf`)} data-testid="view-quote-btn"><Eye size={16} weight="bold" /> View Quote {lineage.estimate.number}</Btn>
                  )}
                  {lineage?.sales_order && (
                    <Btn variant="outline" onClick={() => viewPdf(`/sales-orders/${lineage.sales_order.id}/pdf`)} data-testid="view-so-btn"><Eye size={16} weight="bold" /> View Sales Order {lineage.sales_order.number}</Btn>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Issued" value={(detailInv.created_at || "").slice(0, 10) || "—"} />
                <Field label="Est. Complete" value={detailInv.due_date || "—"} />
                <Field label="Terms" value={detailInv.net_terms || "—"} />
                <Field label="Payment due" value={detailInv.payment_due_date || (detailInv.email_sent_at ? "—" : "on email send")} />
                <Field label="From SO" value={detailInv.from_sales_order || "—"} />
              </div>
              {detailInv.shipping_address && (
                <div
                  className="border-l-2 border-[#06B6D4] bg-secondary/30 px-4 py-3"
                  data-testid="invoice-detail-shipping-address"
                >
                  <div className="overline text-muted-foreground">Ship To</div>
                  <div className="mt-1 whitespace-pre-wrap">{detailInv.shipping_address}</div>
                </div>
              )}

              <div className="border border-border">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-left overline text-muted-foreground">
                    <th className="px-3 py-2 font-mono">Description</th>
                    <th className="px-3 py-2 font-mono text-center">W × H × Qty</th>
                    <th className="px-3 py-2 font-mono text-right">Sqft</th>
                    <th className="px-3 py-2 font-mono text-right">Unit price</th>
                    <th className="px-3 py-2 font-mono text-right">Amount</th>
                    {canSeeMargin && <th className="px-3 py-2 font-mono text-right text-[#0E7490]">Margin</th>}
                  </tr></thead>
                  <tbody data-testid="invoice-detail-items">
                    {(detailInv.line_items || []).map((li, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">{li.description}{li.details && <div className="text-xs text-muted-foreground">{li.details}</div>}</td>
                        <td className="px-3 py-2 text-center font-mono text-muted-foreground">{li.width_in}" × {li.height_in}" × {li.quantity}</td>
                        <td className="px-3 py-2 text-right font-mono">{Number(li.area_sqft || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono" data-testid={`detail-item-unit-${i}`}>
                          {flatCustomerCharge(li) ? "—" : currency(customerUnitPrice(li))}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{currency(li.line_total)}</td>
                        {canSeeMargin && <td className="px-3 py-2 text-right font-mono text-[#16A34A]" data-testid={`detail-item-margin-${i}`}>{Number(li.material_cost) > 0 ? ((Number(li.material_margin || 0) / Number(li.material_cost)) * 100).toFixed(0) : 0}%</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col items-end gap-1 font-mono">
                <div className="flex gap-10"><span className="text-muted-foreground">Subtotal</span><span className="w-28 text-right">{currency(detailInv.subtotal)}</span></div>
                {Number(detailInv.tax_amount || 0) > 0 && <div className="flex gap-10"><span className="text-muted-foreground">Tax ({detailInv.tax_rate}%)</span><span className="w-28 text-right">{currency(detailInv.tax_amount)}</span></div>}
                <div className="flex gap-10 text-base font-bold"><span>Total</span><span className="w-28 text-right">{currency(detailInv.total)}</span></div>
                <div className="flex gap-10 text-[#16A34A]"><span>Paid</span><span className="w-28 text-right" data-testid="detail-paid">{currency(paidOf(detailInv))}</span></div>
                <div className="flex gap-10" style={{ color: (detailInv.total - paidOf(detailInv)) > 0.005 ? "#DC2626" : "#16A34A" }}><span>Balance</span><span className="w-28 text-right" data-testid="detail-balance">{currency(Number(detailInv.total || 0) - paidOf(detailInv))}</span></div>
              </div>

              <div>
                <div className="overline text-muted-foreground mb-2">Payment history</div>
                {detailPays.length === 0 ? (
                  <div className="text-muted-foreground text-sm py-3">No payments recorded.</div>
                ) : (
                  <div className="divide-y divide-border border border-border" data-testid="invoice-detail-payments">
                    {detailPays.map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <div className="font-mono text-sm">{p.date ? new Date(p.date).toLocaleString() : "—"}</div>
                          <div className="text-xs text-muted-foreground">{p.method}{p.notes ? ` · “${p.notes}”` : ""}</div>
                        </div>
                        <div className="font-mono font-semibold text-[#16A34A]">{currency(p.amount)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border flex-wrap">
                {canEditDocuments && !detailInv.voided && (
                  <Btn variant="outline" onClick={() => { const inv = detailInv; setDetailInv(null); setEditing(inv); setOpen(true); }} data-testid="detail-edit-btn"><PencilSimple size={16} weight="bold" /> Edit invoice</Btn>
                )}
                {isAdmin && Number(detailInv.commission_amount || 0) > 0 && (
                  <Btn variant="outline" onClick={genCommissionPO} data-testid="generate-po-btn"><Receipt size={16} weight="bold" /> Generate Commission PO</Btn>
                )}
                <Btn variant="outline" onClick={() => downloadFile(`/invoices/${detailInv.id}/pdf`, `${detailInv.number}.pdf`, "application/pdf")} data-testid="detail-download-pdf"><FilePdf size={16} weight="bold" /> Download PDF</Btn>
                <Btn onClick={printInvoice} data-testid="detail-print-btn"><Printer size={16} weight="bold" /> Print / Save as PDF</Btn>
              </div>

              {canSeeMargin && (
                <div className="border border-[#0E7490]/30 bg-[#0E7490]/5 p-3" data-testid="invoice-margin-block">
                  <div className="overline text-[#0E7490] mb-2 flex items-center gap-1.5"><LockKey size={13} weight="bold" /> Material margin · internal only (never shown to the customer)</div>
                  <div className="flex items-center justify-between font-mono text-sm">
                    <span className="text-muted-foreground">Margin</span>
                    <span className="font-semibold text-[#16A34A]" data-testid="invoice-margin-amount">{Number(detailInv.material_margin_pct || 0).toFixed(1)}%</span>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="border border-[#A21CAF]/30 bg-[#A21CAF]/5 p-3">
                  <div className="overline text-[#A21CAF] mb-2 flex items-center gap-1.5"><LockKey size={13} weight="bold" /> Internal note · admin only (never shown to the customer)</div>
                  <textarea value={internalDraft} onChange={(e) => setInternalDraft(e.target.value)} data-testid="internal-notes-input" rows={2}
                    placeholder="Private notes for staff — e.g. discount reason, follow-up, special instructions…"
                    className="w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
                  <div className="flex justify-end mt-2">
                    <Btn variant="outline" onClick={saveInternalNotes} disabled={savingNote} data-testid="save-internal-notes-btn">{savingNote ? "Saving…" : "Save note"}</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="overline text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function flatCustomerCharge(item) {
  return ["shipping", "installation", "cnc router time", "design time", "decal removal", "service call", "local delivery fee"].includes(
    String(item.category || "").trim().toLowerCase()
  );
}

function customerUnitPrice(item) {
  const quantity = Number(item.quantity || 0);
  if (quantity <= 0) return 0;
  return Number(item.line_total || 0) / quantity;
}

function StageTracker({ lineage, inv, paidOf, onGo }) {
  const d = (s) => (s ? String(s).slice(0, 10) : "");
  const paid = inv?.status === "paid";
  const steps = [
    { key: "estimate", label: "Estimate", num: lineage?.estimate?.number, date: d(lineage?.estimate?.created_at), done: !!lineage?.estimate, to: lineage?.estimate ? `/estimates?focus=${lineage.estimate.id}` : null },
    { key: "sales_order", label: "Sales Order", num: lineage?.sales_order?.number, date: d(lineage?.sales_order?.created_at), done: !!lineage?.sales_order, to: lineage?.sales_order ? `/sales-orders?focus=${lineage.sales_order.id}` : null },
    { key: "invoice", label: "Invoice", num: inv?.number, date: d(inv?.created_at), done: true, to: null },
    { key: "paid", label: "Paid", num: paid ? "Settled" : "Awaiting", date: d(inv?.paid_at), done: paid, to: null },
  ];
  return (
    <div className="border border-border bg-secondary/30 p-4" data-testid="invoice-stage-tracker">
      <div className="overline text-muted-foreground mb-3">Workflow</div>
      <div className="flex items-center">
        {steps.map((s, i) => {
          const clickable = !!(s.to && onGo);
          return (
            <div key={s.key} className="flex items-center flex-1 last:flex-none">
              <button type="button" disabled={!clickable} onClick={() => clickable && onGo(s.to)} data-testid={`stage-${s.key}`}
                className={`flex flex-col items-center text-center ${clickable ? "cursor-pointer group" : "cursor-default"}`}>
                <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors ${s.done ? "bg-[#0E7490] border-[#0E7490] text-white" : "bg-card border-border text-muted-foreground"} ${clickable ? "group-hover:ring-2 group-hover:ring-[#06B6D4]/40" : ""}`}>
                  {s.done ? <CheckCircle size={18} weight="fill" /> : <span className="text-xs font-mono">{i + 1}</span>}
                </div>
                <div className={`mt-1.5 text-xs font-mono font-semibold ${clickable ? "group-hover:text-[#0E7490] group-hover:underline" : ""}`}>{s.label}</div>
                <div className={`text-[11px] font-mono ${s.done ? "text-foreground" : "text-muted-foreground"}`}>{s.num || "—"}</div>
                {s.date && <div className="text-[10px] text-muted-foreground font-mono">{s.date}</div>}
              </button>
              {i < steps.length - 1 && <div className={`h-0.5 flex-1 mx-2 -mt-8 ${steps[i + 1].done ? "bg-[#0E7490]" : "bg-border"}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
