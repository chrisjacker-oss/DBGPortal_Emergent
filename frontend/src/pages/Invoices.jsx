import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge, ReceiptBadge } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import PayNowDialog from "@/components/PayNowDialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import RecordPaymentDialog from "@/components/RecordPaymentDialog";
import { downloadCsv, downloadFile } from "@/lib/download";
import { Plus, PencilSimple, Trash, CheckCircle, DownloadSimple, EnvelopeSimple, FilePdf, CreditCard, Prohibit, ArrowCounterClockwise, ClockCounterClockwise, Printer, LockKey } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export default function Invoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
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

  const load = () => api.get("/invoices").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

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
  const printInvoice = () => {
    const inv = detailInv; if (!inv) return;
    const paid = paidOf(inv);
    const bal = Math.round((Number(inv.total || 0) - paid) * 100) / 100;
    const rowsHtml = (inv.line_items || []).map((li) => `
      <tr>
        <td>${(li.description || "").replace(/</g, "&lt;")}${li.details ? `<div style="color:#666;font-size:11px">${(li.details || "").replace(/</g, "&lt;")}</div>` : ""}</td>
        <td style="text-align:center">${(li.width_in || 0)}" × ${(li.height_in || 0)}" × ${(li.quantity || 0)}</td>
        <td style="text-align:right">${Number(li.area_sqft || 0).toFixed(2)}</td>
        <td style="text-align:right">${currency(li.line_total)}</td>
      </tr>`).join("");
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
        <div class="muted">Due: ${inv.due_date || "—"}</div>${inv.net_terms ? `<div class="muted">Terms: ${inv.net_terms}</div>` : ""}</div>
      </div>
      ${inv.title ? `<div style="margin-top:10px;font-weight:bold">${(inv.title || "").replace(/</g, "&lt;")}</div>` : ""}
      <table><thead><tr><th>Description</th><th style="text-align:center">W × H × Qty</th><th style="text-align:right">Sqft</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rowsHtml}</tbody></table>
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
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) { toast.error("Please allow pop-ups to print"); return; }
    w.document.open(); w.document.write(html); w.document.close();
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
  const sendEmail = async (id) => {
    try { const { data } = await api.post(`/invoices/${id}/send`); toast.success(`Emailed to ${data.to}`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Email failed"); }
  };

  const visible = rows.filter((r) => (tab === "voided" ? r.voided : tab === "paid" ? (!r.voided && r.status === "paid") : (!r.voided && r.status !== "paid")));

  return (
    <div>
      <PageHeader overline="Billing" title="Invoices">
        <Btn variant="outline" onClick={() => downloadCsv("/export/xero/invoices", "xero_invoices.csv")} data-testid="export-xero-invoices-btn">
          <DownloadSimple size={16} weight="bold" /> Export to Xero
        </Btn>
        <Btn onClick={() => { setEditing(null); setOpen(true); }} data-testid="add-invoice-btn"><Plus size={16} weight="bold" /> New Invoice</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="flex gap-2 mb-4" data-testid="invoice-tabs">
          <Btn variant={tab === "active" ? "solid" : "outline"} onClick={() => setTab("active")} data-testid="tab-active">Active</Btn>
          <Btn variant={tab === "paid" ? "solid" : "outline"} onClick={() => setTab("paid")} data-testid="tab-paid">Paid</Btn>
          <Btn variant={tab === "voided" ? "solid" : "outline"} onClick={() => setTab("voided")} data-testid="tab-voided">Voided</Btn>
        </div>
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
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="invoices-table">
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-mono">
                    <button onClick={() => openDetail(r)} data-testid={`invoice-number-${r.id}`} className="text-[#0E7490] hover:underline font-semibold">{r.number}</button>
                  </td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.due_date || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono">
                    {currency(r.total)}
                    {Number(r.amount_paid || 0) > 0 && r.status !== "paid" && (
                      <div className="text-[11px] text-[#F59E0B]" data-testid={`balance-${r.id}`}>Bal {currency(Number(r.total || 0) - Number(r.amount_paid || 0))}</div>
                    )}
                  </td>
                  <td className="px-6 py-3"><ReceiptBadge doc={r} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => downloadFile(`/invoices/${r.id}/pdf`, `${r.number}.pdf`, "application/pdf")} data-testid={`pdf-invoice-${r.id}`} title="Download PDF"><FilePdf size={16} /></Btn>
                      {(Number(r.amount_paid || 0) > 0 || r.status === "paid") && (
                        <Btn variant="ghost" onClick={() => openHistory(r)} data-testid={`history-invoice-${r.id}`} title="Payment history"><ClockCounterClockwise size={16} /></Btn>
                      )}
                      {!r.voided && <>
                        <Btn variant="ghost" onClick={() => sendEmail(r.id)} data-testid={`send-invoice-${r.id}`} title="Email to customer"><EnvelopeSimple size={16} /></Btn>
                        {r.status !== "paid" && (
                          <Btn variant="ghost" onClick={() => setPayInv(r)} data-testid={`pay-invoice-${r.id}`} title="Pay now (card)"><CreditCard size={16} /></Btn>
                        )}
                        {r.status !== "paid" && (
                          <Btn variant="ghost" onClick={() => setRecInv(r)} data-testid={`mark-paid-${r.id}`} title="Record payment (check / ACH / wire)"><CheckCircle size={16} /></Btn>
                        )}
                        <Btn variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} data-testid={`edit-invoice-${r.id}`}><PencilSimple size={16} /></Btn>
                        {isAdmin && <Btn variant="ghost" onClick={() => setVoid(r.id, true)} data-testid={`void-invoice-${r.id}`} title="Void"><Prohibit size={16} /></Btn>}
                      </>}
                      {r.voided && isAdmin && (
                        <Btn variant="ghost" onClick={() => setVoid(r.id, false)} data-testid={`reactivate-invoice-${r.id}`} title="Reactivate"><ArrowCounterClockwise size={16} /></Btn>
                      )}
                      {isAdmin && (
                        <Btn variant="ghost" onClick={() => setDelInv(r)} data-testid={`delete-invoice-${r.id}`} title="Delete"><Trash size={16} /></Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={8} className="px-6 py-10 text-center text-muted-foreground">No {tab} invoices.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="invoice" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
      <PayNowDialog open={!!payInv} invoice={payInv} onClose={() => setPayInv(null)} onPaid={() => { setPayInv(null); load(); }} />
      <RecordPaymentDialog open={!!recInv} invoice={recInv} onClose={() => setRecInv(null)} onSaved={() => { setRecInv(null); load(); }} />
      <AdminDeleteDialog open={!!delInv} label={`invoice ${delInv?.number || ""}`} onClose={() => setDelInv(null)} onConfirm={confirmDelete} />

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
              <StageTracker lineage={lineage} inv={detailInv} paidOf={paidOf} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Issued" value={(detailInv.created_at || "").slice(0, 10) || "—"} />
                <Field label="Due" value={detailInv.due_date || "—"} />
                <Field label="Terms" value={detailInv.net_terms || "—"} />
                <Field label="From SO" value={detailInv.from_sales_order || "—"} />
              </div>

              <div className="border border-border">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-left overline text-muted-foreground">
                    <th className="px-3 py-2 font-mono">Description</th>
                    <th className="px-3 py-2 font-mono text-center">W × H × Qty</th>
                    <th className="px-3 py-2 font-mono text-right">Sqft</th>
                    <th className="px-3 py-2 font-mono text-right">Amount</th>
                  </tr></thead>
                  <tbody data-testid="invoice-detail-items">
                    {(detailInv.line_items || []).map((li, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">{li.description}{li.details && <div className="text-xs text-muted-foreground">{li.details}</div>}</td>
                        <td className="px-3 py-2 text-center font-mono text-muted-foreground">{li.width_in}" × {li.height_in}" × {li.quantity}</td>
                        <td className="px-3 py-2 text-right font-mono">{Number(li.area_sqft || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{currency(li.line_total)}</td>
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

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Btn variant="outline" onClick={() => downloadFile(`/invoices/${detailInv.id}/pdf`, `${detailInv.number}.pdf`, "application/pdf")} data-testid="detail-download-pdf"><FilePdf size={16} weight="bold" /> Download PDF</Btn>
                <Btn onClick={printInvoice} data-testid="detail-print-btn"><Printer size={16} weight="bold" /> Print / Save as PDF</Btn>
              </div>

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

function StageTracker({ lineage, inv, paidOf }) {
  const d = (s) => (s ? String(s).slice(0, 10) : "");
  const paid = inv?.status === "paid";
  const steps = [
    { key: "estimate", label: "Estimate", num: lineage?.estimate?.number, date: d(lineage?.estimate?.created_at), done: !!lineage?.estimate },
    { key: "sales_order", label: "Sales Order", num: lineage?.sales_order?.number, date: d(lineage?.sales_order?.created_at), done: !!lineage?.sales_order },
    { key: "invoice", label: "Invoice", num: inv?.number, date: d(inv?.created_at), done: true },
    { key: "paid", label: "Paid", num: paid ? "Settled" : "Awaiting", date: d(inv?.paid_at), done: paid },
  ];
  return (
    <div className="border border-border bg-secondary/30 p-4" data-testid="invoice-stage-tracker">
      <div className="overline text-muted-foreground mb-3">Workflow</div>
      <div className="flex items-center">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center text-center" data-testid={`stage-${s.key}`}>
              <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 ${s.done ? "bg-[#0E7490] border-[#0E7490] text-white" : "bg-card border-border text-muted-foreground"}`}>
                {s.done ? <CheckCircle size={18} weight="fill" /> : <span className="text-xs font-mono">{i + 1}</span>}
              </div>
              <div className="mt-1.5 text-xs font-mono font-semibold">{s.label}</div>
              <div className={`text-[11px] font-mono ${s.done ? "text-foreground" : "text-muted-foreground"}`}>{s.num || "—"}</div>
              {s.date && <div className="text-[10px] text-muted-foreground font-mono">{s.date}</div>}
            </div>
            {i < steps.length - 1 && <div className={`h-0.5 flex-1 mx-2 -mt-8 ${steps[i + 1].done ? "bg-[#0E7490]" : "bg-border"}`} />}
          </div>
        ))}
      </div>
    </div>
  );
}
