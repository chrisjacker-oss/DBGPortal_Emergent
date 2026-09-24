import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import SendDialog from "@/components/SendDialog";
import SearchSelect from "@/components/SearchSelect";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import ActionsMenu from "@/components/ActionsMenu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Plus, PaperPlaneTilt, UploadSimple, Eye, Trash, ClockCounterClockwise, Image as ImageIcon, PencilSimple } from "@phosphor-icons/react";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const LINK_KINDS = [
  { value: "", label: "No linked job" },
  { value: "estimate", label: "Estimate" },
  { value: "sales_order", label: "Sales Order" },
  { value: "invoice", label: "Invoice" },
];
const KIND_PATH = { estimate: "/estimates", sales_order: "/sales-orders", invoice: "/invoices" };

const STATUS_STYLE = {
  draft: "bg-muted text-muted-foreground border-border",
  sent: "bg-[#06B6D4]/10 text-[#0E7490] border-[#06B6D4]/30",
  approved: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/30",
  changes_requested: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30",
};
const STATUS_LABEL = { draft: "Draft", sent: "Sent", approved: "Approved", changes_requested: "Changes Requested" };

function ProofStatus({ status }) {
  return (
    <span className={`inline-block border px-2 py-0.5 text-xs font-mono uppercase tracking-wider ${STATUS_STYLE[status] || STATUS_STYLE.draft}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function ProofReadState({ version, testid }) {
  const recipients = version?.sent_recipients || [];
  if (!recipients.length) return <span className="text-xs text-muted-foreground" data-testid={testid}>Not tracked</span>;
  const opened = recipients.filter((recipient) => recipient.opened_at).length;
  const title = recipients.map((recipient) => `${recipient.email}: ${recipient.opened_at ? "Opened" : "Unread"}`).join("\n");
  return <span title={title} data-testid={testid} className={opened ? "text-xs font-mono text-[#15803D]" : "text-xs font-mono text-[#B45309]"}>{opened ? `Opened ${opened}/${recipients.length}` : `Unread 0/${recipients.length}`}</span>;
}

const empty = () => ({ customer_id: "", contact_id: "", title: "", notes: "", link_kind: "", link_id: "" });

export default function Proofs() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [linkDocs, setLinkDocs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendDoc, setSendDoc] = useState(null);
  const [delRow, setDelRow] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);
  const verRef = useRef(null);
  const verForId = useRef(null);

  const load = () => api.get("/proofs").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (!form.customer_id) { setContacts([]); return; }
    api.get(`/customers/${form.customer_id}/contacts`).then((r) => setContacts(r.data)).catch(() => setContacts([]));
  }, [form.customer_id]);
  useEffect(() => {
    if (!form.customer_id || !form.link_kind) { setLinkDocs([]); return; }
    api.get(KIND_PATH[form.link_kind]).then((r) => setLinkDocs((r.data || []).filter((d) => d.customer_id === form.customer_id))).catch(() => setLinkDocs([]));
  }, [form.customer_id, form.link_kind]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const openNew = () => { setForm(empty()); setFile(null); setOpen(true); };

  const save = async () => {
    if (!form.customer_id) { toast.error("Choose a customer"); return; }
    if (!form.title.trim()) { toast.error("Add a title / job name"); return; }
    if (!file) { toast.error("Choose a PDF, JPG or PNG file"); return; }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("customer_id", form.customer_id);
    if (form.contact_id) fd.append("contact_id", form.contact_id);
    fd.append("title", form.title);
    if (form.notes) fd.append("notes", form.notes);
    if (form.link_kind) fd.append("link_kind", form.link_kind);
    if (form.link_id) fd.append("link_id", form.link_id);
    setBusy(true);
    try {
      await api.post("/proofs", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Proof created"); setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not create proof"); }
    finally { setBusy(false); }
  };

  const pickVersion = (id) => { verForId.current = id; verRef.current?.click(); };
  const uploadVersion = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !verForId.current) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      await api.post(`/proofs/${verForId.current}/version`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("New version uploaded — you can re-send it now"); load();
    } catch (e2) { toast.error(e2.response?.data?.detail || "Upload failed"); }
  };

  const viewFile = (id) => window.open(`${BACKEND}/api/proofs/${id}/file`, "_blank");
  const confirmDelete = async (password) => {
    try { await api.delete(`/proofs/${delRow.id}`, { data: { password } }); toast.success("Proof deleted"); setDelRow(null); load(); return true; }
    catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  const latestDecision = (r) => {
    const v = (r.versions || []).find((x) => x.version === r.current_version) || (r.versions || [])[r.versions.length - 1];
    return v;
  };

  return (
    <div>
      <PageHeader overline="Design" title="Artwork Proofs">
        <Btn onClick={openNew} data-testid="add-proof-btn"><Plus size={16} weight="bold" /> New Proof</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-5 py-3 font-mono">#</th>
                <th className="px-5 py-3 font-mono">Customer</th>
                <th className="px-5 py-3 font-mono">Artwork</th>
                <th className="px-5 py-3 font-mono">Linked</th>
                <th className="px-5 py-3 font-mono text-center">Ver.</th>
                <th className="px-5 py-3 font-mono">Status</th>
                <th className="px-5 py-3 font-mono">Sent To</th>
                <th className="px-5 py-3 font-mono">Read</th>
                <th className="px-5 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="proofs-table">
              {rows.map((r) => {
                const dec = latestDecision(r);
                return (
                  <tr key={r.id} data-testid={`proof-row-${r.id}`} className="border-b border-border last:border-0 hover:bg-secondary/50 align-top">
                    <td className="px-5 py-3 font-mono">{r.number}</td>
                    <td className="px-5 py-3 font-medium">{r.customer_name}{r.contact_name ? <div className="text-xs text-muted-foreground">Attn: {r.contact_name}</div> : null}</td>
                    <td className="px-5 py-3">{r.title}{r.notes ? <div className="text-xs text-muted-foreground max-w-[260px]">{r.notes}</div> : null}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{r.link_number || "—"}</td>
                    <td className="px-5 py-3 font-mono text-center">v{r.current_version}</td>
                    <td className="px-5 py-3">
                      <ProofStatus status={r.status} />
                      {r.status === "changes_requested" && dec?.change_notes ? (
                        <div className="mt-1 text-xs text-[#B45309] max-w-[260px] whitespace-pre-wrap" data-testid={`proof-changes-${r.id}`}>“{dec.change_notes}”</div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{dec?.sent_to || "—"}</td>
                    <td className="px-5 py-3"><ProofReadState version={dec} testid={`proof-read-${r.id}`} /></td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <ActionsMenu testid={`proof-actions-${r.id}`} items={[
                          { label: "View artwork", icon: <Eye size={16} />, onClick: () => viewFile(r.id), testid: `view-proof-${r.id}` },
                          { label: "Send to customer", icon: <PaperPlaneTilt size={16} />, onClick: () => setSendDoc(r), testid: `send-proof-${r.id}` },
                          { label: "Upload new version", icon: <UploadSimple size={16} />, onClick: () => pickVersion(r.id), testid: `newver-proof-${r.id}` },
                          { label: "Version history", icon: <ClockCounterClockwise size={16} />, onClick: () => setHistoryRow(r), testid: `history-proof-${r.id}` },
                          { separator: true, hidden: !isAdmin },
                          { label: "Delete", icon: <Trash size={16} />, onClick: () => setDelRow(r), danger: true, testid: `delete-proof-${r.id}`, hidden: !isAdmin },
                        ]} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={9} className="px-6 py-12 text-center text-muted-foreground"><ImageIcon size={22} className="mx-auto mb-2 opacity-50" />No artwork proofs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <input ref={verRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={uploadVersion} data-testid="proof-version-input" />

      {/* New proof dialog */}
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)}>
        <DialogContent className="rounded-none max-w-lg max-h-[90vh] overflow-y-auto" data-testid="proof-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">New Artwork Proof</DialogTitle>
            <DialogDescription className="font-mono text-xs">Upload artwork and send it to a customer for approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block">
              <span className="overline text-muted-foreground">Customer</span>
              <SearchSelect testid="proof-customer" value={form.customer_id} placeholder="Search customer…"
                options={customers.map((c) => ({ value: c.id, label: c.company || c.name }))}
                onChange={(v) => setForm({ ...form, customer_id: v, contact_id: "", link_id: "" })} />
            </label>
            <label className="block">
              <span className="overline text-muted-foreground">Contact (who approves)</span>
              <select value={form.contact_id} onChange={set("contact_id")} data-testid="proof-contact" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">{contacts.length ? "Use company email" : "No contacts on file — uses company email"}</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ""}</option>)}
              </select>
            </label>
            <Inp label="Title / job name" value={form.title} onChange={set("title")} testid="proof-title" />
            <label className="block">
              <span className="overline text-muted-foreground">Notes to customer (optional)</span>
              <textarea value={form.notes} onChange={set("notes")} rows={2} data-testid="proof-notes" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="overline text-muted-foreground">Link to job (optional)</span>
                <select value={form.link_kind} onChange={(e) => setForm({ ...form, link_kind: e.target.value, link_id: "" })} data-testid="proof-link-kind" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {LINK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              {form.link_kind && (
                <label className="block">
                  <span className="overline text-muted-foreground">Document</span>
                  <select value={form.link_id} onChange={set("link_id")} data-testid="proof-link-id" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">— Select —</option>
                    {linkDocs.map((d) => <option key={d.id} value={d.id}>{d.number} — {d.title}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className="block">
              <span className="overline text-muted-foreground">Artwork file (PDF, JPG or PNG · max 25MB)</span>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="proof-file"
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none file:mr-3 file:border-0 file:bg-foreground file:text-primary-foreground file:px-3 file:py-1 file:text-xs" />
              {file && <div className="text-xs text-muted-foreground mt-1">{file.name}</div>}
            </label>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Btn>
            <Btn onClick={save} disabled={busy} data-testid="save-proof-btn">{busy ? "Uploading…" : "Create proof"}</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history dialog */}
      <Dialog open={!!historyRow} onOpenChange={(o) => !o && setHistoryRow(null)}>
        <DialogContent className="rounded-none max-w-lg max-h-[90vh] overflow-y-auto" data-testid="proof-history-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Proof {historyRow?.number} — history</DialogTitle>
            <DialogDescription className="font-mono text-xs">{historyRow?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(historyRow?.versions || []).slice().reverse().map((v) => (
              <div key={v.version} className="border border-border p-3" data-testid={`proof-version-${historyRow?.id}-${v.version}`}>
                <div className="flex items-center justify-between">
                  <div className="font-mono text-sm font-semibold">v{v.version} <span className="text-muted-foreground font-normal">· {v.original_filename}</span></div>
                  <ProofStatus status={v.decision === "approved" ? "approved" : v.decision === "changes" ? "changes_requested" : (v.sent_at ? "sent" : "draft")} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Uploaded {String(v.uploaded_at).slice(0, 10)}{v.uploaded_by ? ` by ${v.uploaded_by}` : ""}
                  {v.sent_at ? ` · Sent ${String(v.sent_at).slice(0, 10)} to ${v.sent_to || ""}` : ""}
                  {v.sent_recipients?.length ? ` · Opened ${v.sent_recipients.filter((recipient) => recipient.opened_at).length}/${v.sent_recipients.length}` : ""}
                  {v.decided_at ? ` · Responded ${String(v.decided_at).slice(0, 10)}${v.decided_by ? ` by ${v.decided_by}` : ""}` : ""}
                </div>
                {v.change_notes && <div className="mt-2 text-xs text-[#B45309] bg-[#F59E0B]/10 border border-[#F59E0B]/30 p-2 whitespace-pre-wrap">“{v.change_notes}”</div>}
                <button onClick={() => window.open(`${BACKEND}/api/proofs/${historyRow.id}/file?version=${v.version}`, "_blank")} className="mt-2 text-xs text-[#0E7490] hover:underline inline-flex items-center gap-1"><Eye size={12} /> View this version</button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <SendDialog open={!!sendDoc} doc={sendDoc} path="/proofs" kindLabel="proof" allowNote={false} onClose={() => setSendDoc(null)} onSent={load} />
      <AdminDeleteDialog open={!!delRow} label={`proof ${delRow?.number || ""}`} onClose={() => setDelRow(null)} onConfirm={confirmDelete} />
    </div>
  );
}
