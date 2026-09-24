import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import SearchSelect from "@/components/SearchSelect";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CaretLeft, CaretRight, Plus, PencilSimple, Trash, EnvelopeSimple, CalendarBlank } from "@phosphor-icons/react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const emptyForm = { date: "", time_of_day: "morning", status: "confirmed", customer_id: "", contact_id: "", description: "", linked_type: "", linked_id: "" };

export default function Installs() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [installs, setInstalls] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState(null);

  const ym = ymOf(cursor);
  const load = () => api.get(`/installs?month=${ym}`).then((r) => setInstalls(r.data)).catch(() => setInstalls([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ym]);
  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (open && form.customer_id) {
      api.get(`/customers/${form.customer_id}/contacts`).then((r) => setContacts(r.data)).catch(() => setContacts([]));
      Promise.all([api.get("/sales-orders").catch(() => ({ data: [] })), api.get("/invoices").catch(() => ({ data: [] }))]).then(([so, inv]) => {
        const opts = [
          ...so.data.filter((x) => x.customer_id === form.customer_id && !x.voided).map((x) => ({ value: `sales_order:${x.id}`, label: `${x.number} · ${x.title || "Sales Order"}` })),
          ...inv.data.filter((x) => x.customer_id === form.customer_id && !x.voided).map((x) => ({ value: `invoice:${x.id}`, label: `${x.number} · ${x.title || "Invoice"}` })),
        ];
        setJobs(opts);
      });
    } else if (open) { setContacts([]); setJobs([]); }
  }, [open, form.customer_id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openAdd = (dateStr) => { setEditing(null); setForm({ ...emptyForm, date: dateStr || todayStr() }); setOpen(true); };
  const openEdit = (it) => { setEditing(it); setForm({ date: it.date, time_of_day: it.time_of_day || "morning", status: it.status || "confirmed", customer_id: it.customer_id || "", contact_id: it.contact_id || "", description: it.description || "", linked_type: it.linked_type || "", linked_id: it.linked_id || "" }); setOpen(true); };

  const save = async () => {
    if (!form.customer_id) { toast.error("Select a customer"); return; }
    if (!form.date) { toast.error("Pick a date"); return; }
    setSaving(true);
    try {
      const payload = { ...form, contact_id: form.contact_id || null, linked_type: form.linked_type || null, linked_id: form.linked_id || null };
      if (editing) {
        const { data } = await api.put(`/installs/${editing.id}`, payload);
        const n = data.notify || {};
        if (n.status === "sent") toast.success(`Install updated · reschedule alert emailed to ${n.to}`);
        else if (n.status === "error") toast.warning("Install updated, but the reschedule email couldn't be sent — use Resend");
        else toast.success("Install updated");
      } else {
        const { data } = await api.post("/installs", payload);
        const n = data.notify || {};
        if (n.status === "sent") toast.success(`Install scheduled · alert emailed to ${n.to}`);
        else if (n.status === "no_email") toast.warning("Install scheduled, but no email on file for the contact/customer");
        else if (n.status === "error") toast.warning("Install scheduled, but the alert email couldn't be sent — use Resend");
        else toast.success("Install scheduled");
      }
      setOpen(false); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const resend = async (it) => {
    try { const { data } = await api.post(`/installs/${it.id}/notify`); data.status === "sent" ? toast.success(`Alert re-sent to ${data.to}`) : toast.warning("No email on file to send to"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Send failed"); }
  };
  const confirmDelete = async (password) => {
    try { await api.delete(`/installs/${del.id}`, { data: { password } }); toast.success("Install removed"); setDel(null); load(); return true; }
    catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  // build calendar grid
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const byDate = installs.reduce((acc, it) => { (acc[it.date] = acc[it.date] || []).push(it); return acc; }, {});
  const isToday = (d) => d && `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(d)}` === todayStr();

  return (
    <div>
      <PageHeader overline="Scheduling" title="Install Calendar">
        <Btn onClick={() => openAdd()} data-testid="add-install-btn"><Plus size={16} weight="bold" /> Schedule Install</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Btn variant="outline" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} data-testid="install-prev-month"><CaretLeft size={16} weight="bold" /></Btn>
            <div className="font-display font-bold text-xl min-w-[220px] text-center" data-testid="install-month-label">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</div>
            <Btn variant="outline" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} data-testid="install-next-month"><CaretRight size={16} weight="bold" /></Btn>
          </div>
          <Btn variant="ghost" onClick={() => setCursor(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })} data-testid="install-today"><CalendarBlank size={16} weight="bold" /> Today</Btn>
        </div>

        <div className="border border-border bg-card">
          <div className="grid grid-cols-7 border-b border-border">
            {WEEKDAYS.map((w) => <div key={w} className="px-3 py-2 overline text-muted-foreground text-center">{w}</div>)}
          </div>
          <div className="grid grid-cols-7" data-testid="install-calendar-grid">
            {cells.map((d, i) => {
              const dateStr = d ? `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(d)}` : null;
              const items = d ? (byDate[dateStr] || []) : [];
              return (
                <div key={i} className={`min-h-[118px] border-b border-r border-border p-1.5 last:border-r-0 ${i % 7 === 6 ? "border-r-0" : ""} ${d ? "" : "bg-secondary/30"}`}>
                  {d && (
                    <div className="h-full flex flex-col">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-mono ${isToday(d) ? "bg-[#06B6D4] text-white px-1.5 py-0.5 rounded-full" : "text-muted-foreground"}`}>{d}</span>
                        <button onClick={() => openAdd(dateStr)} data-testid={`install-add-${dateStr}`} className="text-muted-foreground hover:text-foreground" title="Schedule install"><Plus size={14} weight="bold" /></button>
                      </div>
                      <div className="mt-1 space-y-1 overflow-y-auto">
                        {items.map((it) => (
                          <button key={it.id} onClick={() => openEdit(it)} data-testid={`install-item-${it.id}`}
                            className={`w-full text-left px-1.5 py-1 text-[11px] leading-tight ${it.status === "tentative" ? "bg-[#F59E0B]/15 text-[#78350F] hover:bg-[#F59E0B]/25" : "bg-[#0A0A0A] text-white hover:bg-[#0A0A0A]/85"}`}>
                            <span className={`inline-block text-[9px] font-bold uppercase px-1 mr-1 ${it.status === "tentative" ? "bg-[#F59E0B] text-[#0A0A0A]" : "bg-[#06B6D4] text-white"}`}>{it.status === "tentative" ? "REQ" : it.time_label === "Afternoon" ? "PM" : "AM"}</span>
                            <span className="font-medium">{it.customer_name}</span>
                            {it.linked_number ? (
                              <span role="link" tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); const path = it.linked_type === "invoice" ? "/invoices" : it.linked_type === "estimate" ? "/estimates" : "/sales-orders"; navigate(`${path}?focus=${it.linked_id}`); }}
                                data-testid={`install-linked-${it.id}`}
                                className="block text-[10px] text-[#67E8F9] underline hover:text-white cursor-pointer">{it.linked_number}</span>
                            ) : null}
                            {it.description ? <span className="block text-[10px] text-gray-300 truncate">{it.description}</span> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && !saving && (setOpen(false), setEditing(null))}>
        <DialogContent className="rounded-none max-w-lg" data-testid="install-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit" : "Schedule"} Install</DialogTitle>
            <DialogDescription className="font-mono text-xs">Tentative customer requests stay in review until staff confirms the appointment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} testid="install-date" />
              <label className="block">
                <span className="overline text-muted-foreground">Time of day</span>
                <select value={form.time_of_day} onChange={(e) => set("time_of_day", e.target.value)} data-testid="install-time"
                  className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="overline text-muted-foreground">Schedule state</span>
              <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="install-status"
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="confirmed">Confirmed installation</option>
                <option value="tentative">Tentative customer request</option>
              </select>
            </label>
            <div className="block">
              <span className="overline text-muted-foreground">Customer</span>
              <SearchSelect testid="install-customer" value={form.customer_id} placeholder="Select customer…"
                options={customers.map((c) => ({ value: c.id, label: c.company || c.name }))}
                onChange={(v) => setForm((f) => ({ ...f, customer_id: v, contact_id: "" }))} />
            </div>
            <label className="block">
              <span className="overline text-muted-foreground">Contact (email alert goes here)</span>
              <select value={form.contact_id || ""} onChange={(e) => set("contact_id", e.target.value)} data-testid="install-contact" disabled={!form.customer_id}
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                <option value="">{contacts.length ? "Use customer email" : "No contacts on file — uses customer email"}</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : " (no email)"}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="overline text-muted-foreground">Link to job (optional)</span>
              <select value={form.linked_type && form.linked_id ? `${form.linked_type}:${form.linked_id}` : ""}
                onChange={(e) => { const [t, id] = e.target.value ? e.target.value.split(":") : ["", ""]; setForm((f) => ({ ...f, linked_type: t, linked_id: id })); }}
                data-testid="install-link-job" disabled={!form.customer_id}
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                <option value="">{jobs.length ? "Not linked" : "No sales orders / invoices for this customer"}</option>
                {jobs.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="overline text-muted-foreground">What is being installed</span>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} data-testid="install-description" rows={3}
                placeholder="e.g. Full wrap on Box Truck #4, both doors + rear graphics"
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            {editing && editing.status !== "tentative" && <Btn variant="outline" onClick={() => resend(editing)} data-testid="install-resend-btn"><EnvelopeSimple size={16} weight="bold" /> Resend alert</Btn>}
            {editing && isAdmin && <Btn variant="danger" onClick={() => { setDel(editing); setOpen(false); }} data-testid="install-delete-btn"><Trash size={16} weight="bold" /> Delete</Btn>}
            <Btn variant="outline" onClick={() => { setOpen(false); setEditing(null); }} disabled={saving}>Cancel</Btn>
            <Btn onClick={save} disabled={saving || !form.customer_id || !form.date} data-testid="install-save-btn">{saving ? "Saving…" : (editing ? form.status === "confirmed" && editing.status === "tentative" ? "Confirm & Notify" : "Save" : "Schedule & Notify")}</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={!!del} label={`install on ${del?.date || ""}`} onClose={() => setDel(null)} onConfirm={confirmDelete} />
    </div>
  );
}
