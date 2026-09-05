import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Plus, PencilSimple, Trash, UsersThree, Key, UserMinus, UploadSimple, DownloadSimple } from "@phosphor-icons/react";
import { downloadCsv } from "@/lib/download";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";

const empty = { name: "", company: "", email: "", phone: "", address: "", notes: "", tier: "", title: "", net_terms: "Net 15", portal_enabled: false };
const TIER_PCT = { 1: "35%", 2: "25%", 3: "15%" };

export default function Customers() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [contactCust, setContactCust] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [cForm, setCForm] = useState({ name: "", email: "", phone: "", title: "" });
  const [del, setDel] = useState(null); // { url, label, after }
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importKind, setImportKind] = useState("customers"); // customers | contacts
  const [sel, setSel] = useState({});
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = () => api.get("/customers").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const loadContacts = (cid) => api.get(`/customers/${cid}/contacts`).then((r) => setContacts(r.data)).catch(() => setContacts([]));
  const openContacts = async (r) => { setContactCust(r); setCForm({ name: "", email: "", phone: "", title: "" }); await loadContacts(r.id); };
  const addContact = async () => {
    if (!cForm.name.trim()) { toast.error("Contact name is required"); return; }
    try { await api.post(`/customers/${contactCust.id}/contacts`, cForm); setCForm({ name: "", email: "", phone: "", title: "" }); loadContacts(contactCust.id); toast.success("Contact added"); }
    catch { toast.error("Could not add contact"); }
  };
  const delContact = (c) => setDel({ url: `/contacts/${c.id}`, label: `contact ${c.name}`, after: () => loadContacts(contactCust.id) });
  const togglePortal = async (c) => {
    if (c.has_portal) {
      setDel({ url: `/contacts/${c.id}/portal`, label: `portal login for ${c.name}`, after: () => loadContacts(contactCust.id) });
    } else {
      if (!c.email) { toast.error("Add an email to this contact first"); return; }
      const pw = window.prompt(`Set a portal password for ${c.name}:`);
      if (!pw) return;
      try { await api.post(`/contacts/${c.id}/portal`, { password: pw }); toast.success("Portal login created"); loadContacts(contactCust.id); }
      catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    }
  };

  const openNew = () => { setForm(empty); setEditing(null); setOpen(true); };
  const openEdit = (r) => { setForm({ ...empty, ...r, tier: r.tier ?? "", title: r.title ?? "", net_terms: r.net_terms ?? "Net 15", portal_enabled: !!r.portal_enabled }); setEditing(r.id); setOpen(true); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    const payload = { ...form, tier: form.tier === "" ? null : Number(form.tier) };
    try {
      if (editing) await api.put(`/customers/${editing}`, payload);
      else await api.post("/customers", payload);
      toast.success("Customer saved");
      setOpen(false);
      load();
    } catch (e) { toast.error("Save failed"); }
  };

  const remove = (r) => setDel({ url: `/customers/${r.id}`, label: `customer ${r.company || r.name}`, after: load });
  const confirmDelete = async (password) => {
    try {
      await api.delete(del.url, { data: { password } });
      toast.success("Deleted"); const after = del.after; setDel(null); after && after(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  const openImport = (kind) => { setImportKind(kind); setImportResult(null); setImportOpen(true); };
  const downloadTemplate = () => {
    const csv = importKind === "contacts"
      ? "customer,name,email,phone,title\nAcme Signs,Jane Roe,jane@acme.com,555-222-3333,Purchasing\n"
      : "name,company,email,phone,address,title,tier,net_terms,notes\nJohn Doe,Acme Signs,john@acme.com,555-123-4567,\"123 Main St, Dallas TX\",Owner,1,Net 15,VIP account\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${importKind}-import-template.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true); setImportResult(null);
    try {
      const text = await file.text();
      const { data } = await api.post(importKind === "contacts" ? "/contacts/import" : "/customers/import", { csv: text });
      setImportResult(data);
      if (data.created > 0) { toast.success(`Imported ${data.created} ${importKind === "contacts" ? "contact" : "customer"}(s)`); load(); }
      else toast.message("Nothing new was imported");
    } catch (err) { toast.error(err.response?.data?.detail || "Import failed"); }
    finally { setImporting(false); }
  };

  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const allChecked = rows.length > 0 && rows.every((r) => sel[r.id]);
  const toggleAll = () => { const n = {}; if (!allChecked) rows.forEach((r) => (n[r.id] = true)); setSel(n); };
  const bulkDelete = async (password) => {
    try {
      const { data } = await api.post("/customers/bulk-delete", { ids: selIds, password });
      toast.success(`Deleted ${data.deleted} customer(s)`); setBulkOpen(false); setSel({}); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  return (
    <div>
      <PageHeader overline="CRM" title="Customers">
        {isAdmin && selIds.length > 0 && <Btn variant="outline" onClick={() => setBulkOpen(true)} data-testid="bulk-delete-btn"><Trash size={16} weight="bold" /> Delete {selIds.length}</Btn>}
        <Btn variant="outline" onClick={() => openImport("customers")} data-testid="import-customers-btn"><UploadSimple size={16} weight="bold" /> Import CSV</Btn>
        <Btn variant="outline" onClick={() => openImport("contacts")} data-testid="import-contacts-btn"><UploadSimple size={16} weight="bold" /> Import Contacts</Btn>
        <Btn variant="outline" onClick={() => downloadCsv("/export/customers", "customers_contacts.csv")} data-testid="export-customers-btn"><DownloadSimple size={16} weight="bold" /> Export CSV</Btn>
        <Btn variant="outline" onClick={() => downloadCsv("/export/contacts", "contacts.csv")} data-testid="export-contacts-btn"><DownloadSimple size={16} weight="bold" /> Export Contacts</Btn>
        <Btn onClick={openNew} data-testid="add-customer-btn"><Plus size={16} weight="bold" /> New Customer</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                {isAdmin && <th className="px-4 py-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} data-testid="customer-select-all" className="h-4 w-4 accent-[#0A0A0A]" /></th>}
                <th className="px-6 py-3 font-mono">Name</th>
                <th className="px-6 py-3 font-mono">Company</th>
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono">Tier</th>
                <th className="px-6 py-3 font-mono">Terms</th>
                <th className="px-6 py-3 font-mono">Portal</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="customers-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  {isAdmin && <td className="px-4 py-3"><input type="checkbox" checked={!!sel[r.id]} onChange={() => setSel((s) => ({ ...s, [r.id]: !s[r.id] }))} data-testid={`customer-select-${r.id}`} className="h-4 w-4 accent-[#0A0A0A]" /></td>}
                  <td className="px-6 py-3 font-medium">{r.name}{r.title && <span className="block text-xs text-muted-foreground">{r.title}</span>}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.company || "—"}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.email || "—"}</td>
                  <td className="px-6 py-3">{r.tier ? <span className="font-mono text-xs border border-[#A21CAF]/30 bg-[#D946EF]/10 text-[#A21CAF] px-2 py-0.5">T{r.tier} · {TIER_PCT[r.tier]}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{r.net_terms || "—"}</td>
                  <td className="px-6 py-3">{r.portal_enabled ? <span className="text-[#16A34A] text-xs font-mono">● On</span> : <span className="text-muted-foreground text-xs font-mono">Off</span>}</td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-2">
                      <Btn variant="ghost" onClick={() => openContacts(r)} data-testid={`contacts-customer-${r.id}`} title="Contacts"><UsersThree size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => openEdit(r)} data-testid={`edit-customer-${r.id}`}><PencilSimple size={16} /></Btn>
                      {isAdmin && <Btn variant="ghost" onClick={() => remove(r)} data-testid={`delete-customer-${r.id}`}><Trash size={16} /></Btn>}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={isAdmin ? 8 : 7} className="px-6 py-10 text-center text-muted-foreground">No customers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Edit" : "New"} Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Name" value={form.name} onChange={set("name")} testid="cust-name" />
              <Inp label="Title" value={form.title} onChange={set("title")} testid="cust-title" />
            </div>
            <Inp label="Company" value={form.company} onChange={set("company")} testid="cust-company" />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Email" value={form.email} onChange={set("email")} testid="cust-email" />
              <Inp label="Phone" value={form.phone} onChange={set("phone")} testid="cust-phone" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="overline text-muted-foreground">Discount tier</span>
                <select value={form.tier} onChange={set("tier")} data-testid="cust-tier" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">None</option>
                  <option value="1">Tier 1 — 35%</option>
                  <option value="2">Tier 2 — 25%</option>
                  <option value="3">Tier 3 — 15%</option>
                </select>
              </label>
              <label className="block">
                <span className="overline text-muted-foreground">Net terms</span>
                <select value={form.net_terms} onChange={set("net_terms")} data-testid="cust-terms" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {["COD", "50/50", "Net 10", "Net 15"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <Inp label="Address" value={form.address} onChange={set("address")} testid="cust-address" />
            <Inp label="Notes" value={form.notes} onChange={set("notes")} testid="cust-notes" />
            <label className="flex items-center gap-2 cursor-pointer select-none" data-testid="cust-portal-label">
              <input type="checkbox" checked={form.portal_enabled} onChange={(e) => setForm({ ...form, portal_enabled: e.target.checked })} data-testid="cust-portal" className="h-4 w-4 accent-[#0A0A0A]" />
              <span className="text-sm">Enable customer portal access</span>
            </label>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="save-customer-btn">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!contactCust} onOpenChange={(o) => !o && setContactCust(null)}>
        <DialogContent className="rounded-none max-w-lg max-h-[90vh] overflow-y-auto" data-testid="contacts-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Contacts · {contactCust?.company || contactCust?.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs">People at this company. Pick one as "Attn" on documents; optionally give them a portal login.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2" data-testid="contacts-list">
            {contacts.length === 0 && <div className="text-sm text-muted-foreground py-2">No contacts yet.</div>}
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between border border-border px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{c.name}{c.title ? <span className="text-muted-foreground font-normal"> — {c.title}</span> : ""}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{c.email || "no email"}{c.phone ? ` · ${c.phone}` : ""}</div>
                  {c.has_portal && <div className="text-[11px] text-[#16A34A] font-mono">● portal login</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {isAdmin && (
                    <Btn variant="ghost" onClick={() => togglePortal(c)} data-testid={`toggle-portal-${c.id}`} title={c.has_portal ? "Remove portal login" : "Create portal login"}>
                      {c.has_portal ? <UserMinus size={16} /> : <Key size={16} />}
                    </Btn>
                  )}
                  {isAdmin && <Btn variant="ghost" onClick={() => delContact(c)} data-testid={`delete-contact-${c.id}`}><Trash size={16} /></Btn>}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 space-y-3">
            <div className="overline text-muted-foreground">Add contact</div>
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Name" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} testid="new-contact-name" />
              <Inp label="Title" value={cForm.title} onChange={(e) => setCForm({ ...cForm, title: e.target.value })} testid="new-contact-title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Email" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} testid="new-contact-email" />
              <Inp label="Phone" value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} testid="new-contact-phone" />
            </div>
            <Btn onClick={addContact} data-testid="add-contact-btn"><Plus size={16} weight="bold" /> Add contact</Btn>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setContactCust(null)}>Done</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={!!del} label={del?.label || "record"} onClose={() => setDel(null)} onConfirm={confirmDelete} />

      <Dialog open={importOpen} onOpenChange={(o) => !o && !importing && setImportOpen(false)}>
        <DialogContent className="rounded-none max-w-lg" data-testid="import-customers-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">{importKind === "contacts" ? "Import contacts from CSV" : "Import customers from CSV"}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{importKind === "contacts" ? "Columns: customer (company to attach to), name, email, phone, title. Rows are skipped if the customer can't be matched." : "Columns: name, company, email, phone, address, title, tier (1–3), net_terms, notes. Rows with a duplicate email are skipped."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <button onClick={downloadTemplate} data-testid="download-template-btn" className="inline-flex items-center gap-2 text-sm text-[#0E7490] hover:underline">
              <DownloadSimple size={16} /> Download CSV template
            </button>
            <label className="block border-2 border-dashed border-input px-4 py-8 text-center cursor-pointer hover:bg-secondary/40 transition-colors">
              <UploadSimple size={28} className="mx-auto mb-2 text-muted-foreground" />
              <div className="text-sm font-medium">{importing ? "Importing…" : "Choose a .csv file to upload"}</div>
              <div className="text-xs text-muted-foreground mt-1">{importKind === "contacts" ? "Contacts will be attached to matching customers" : "Your customer list will be added to the CRM"}</div>
              <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={importing} data-testid="import-file-input" className="hidden" />
            </label>
            {importResult && (
              <div className="border border-border bg-secondary/30 px-4 py-3 text-sm" data-testid="import-result">
                <div><b>{importResult.created}</b> added · <b>{importResult.skipped}</b> skipped</div>
                {importResult.errors?.length > 0 && (
                  <ul className="mt-2 text-xs text-muted-foreground list-disc pl-5 max-h-32 overflow-y-auto">
                    {importResult.errors.map((er, i) => <li key={i}>{er}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setImportOpen(false)} disabled={importing} data-testid="import-close-btn">Done</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={bulkOpen} label={`${selIds.length} selected customer(s)`} onClose={() => setBulkOpen(false)} onConfirm={bulkDelete} />
    </div>
  );
}

export function Inp({ label, testid, ...props }) {
  return (
    <label className="block">
      <span className="overline text-muted-foreground">{label}</span>
      <input {...props} data-testid={testid} className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
    </label>
  );
}
