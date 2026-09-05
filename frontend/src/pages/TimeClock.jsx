import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { useAuth } from "@/context/AuthContext";
import { downloadCsv } from "@/lib/download";
import { Clock, Play, Stop, Plus, PencilSimple, Trash, DownloadSimple } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); };
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const today = () => new Date().toISOString().slice(0, 10);

export default function TimeClock() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canClock = user?.role === "installer" || user?.role === "salesman";

  const [status, setStatus] = useState(null);
  const [entries, setEntries] = useState([]);
  const [staff, setStaff] = useState([]);
  const [now, setNow] = useState(Date.now());

  // admin filters
  const [fUser, setFUser] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  // dialogs
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ user_id: "", clock_in: "", clock_out: "", commission_note: "" });
  const [open, setOpen] = useState(false);
  const [delRow, setDelRow] = useState(null);

  const loadStatus = () => api.get("/timeclock/status").then((r) => setStatus(r.data)).catch(() => {});
  const loadEntries = () => {
    const q = [];
    if (isAdmin && fUser) q.push(`user_id=${fUser}`);
    if (fFrom) q.push(`start=${fFrom}`);
    if (fTo) q.push(`end=${fTo}`);
    api.get(`/timeclock/entries${q.length ? `?${q.join("&")}` : ""}`).then((r) => setEntries(r.data)).catch(() => {});
  };
  useEffect(() => { if (canClock) loadStatus(); }, []);           // eslint-disable-line
  useEffect(() => { loadEntries(); }, [fUser, fFrom, fTo]);       // eslint-disable-line
  useEffect(() => { if (isAdmin) api.get("/users").then((r) => setStaff(r.data.filter((u) => u.role !== "admin"))).catch(() => {}); }, [isAdmin]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const clockIn = async () => { try { await api.post("/timeclock/clock-in"); toast.success("Clocked in"); loadStatus(); loadEntries(); } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } };
  const clockOut = async () => { try { await api.post("/timeclock/clock-out"); toast.success("Clocked out"); loadStatus(); loadEntries(); } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } };

  const openAdd = () => { setEditing(null); setForm({ user_id: staff[0]?.id || "", clock_in: toLocalInput(new Date().toISOString()), clock_out: "", commission_note: "" }); setOpen(true); };
  const openEdit = (e) => { setEditing(e.id); setForm({ user_id: e.user_id, clock_in: toLocalInput(e.clock_in), clock_out: toLocalInput(e.clock_out), commission_note: e.commission_note || "" }); setOpen(true); };
  const save = async () => {
    if (!form.clock_in) { toast.error("Clock-in time is required"); return; }
    try {
      if (editing) {
        await api.put(`/timeclock/entries/${editing}`, { clock_in: fromLocalInput(form.clock_in), clock_out: fromLocalInput(form.clock_out), commission_note: form.commission_note });
      } else {
        if (!form.user_id) { toast.error("Select a team member"); return; }
        await api.post("/timeclock/entries", { user_id: form.user_id, clock_in: fromLocalInput(form.clock_in), clock_out: fromLocalInput(form.clock_out), commission_note: form.commission_note });
      }
      toast.success("Saved"); setOpen(false); loadEntries();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };
  const confirmDelete = async (password) => {
    try { await api.delete(`/timeclock/entries/${delRow.id}`, { data: { password } }); toast.success("Entry deleted"); setDelRow(null); loadEntries(); return true; }
    catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };
  const exportCsv = () => {
    const q = [];
    if (fUser) q.push(`user_id=${fUser}`);
    if (fFrom) q.push(`start=${fFrom}`);
    if (fTo) q.push(`end=${fTo}`);
    downloadCsv(`/timeclock/export${q.length ? `?${q.join("&")}` : ""}`, "timeclock.csv");
  };

  const totalHours = entries.reduce((s, e) => s + (e.hours || 0), 0);
  const elapsed = () => {
    if (!status?.entry?.clock_in) return "";
    const secs = Math.floor((now - new Date(status.entry.clock_in).getTime()) / 1000);
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div>
      <PageHeader overline="Time & Attendance" title="Time Clock">
        {isAdmin && <Btn variant="outline" onClick={exportCsv} data-testid="tc-export-btn"><DownloadSimple size={16} weight="bold" /> Export CSV</Btn>}
        {isAdmin && <Btn onClick={openAdd} data-testid="tc-add-btn"><Plus size={16} weight="bold" /> Add Entry</Btn>}
      </PageHeader>

      <div className="p-8 space-y-8">
        {canClock && (
          <div className="border border-border bg-card p-6 flex items-center justify-between" data-testid="tc-clock-panel">
            <div className="flex items-center gap-4">
              <Clock size={32} weight="bold" className="text-[#0E7490]" />
              <div>
                <div className="overline text-muted-foreground">Status</div>
                <div className="text-lg font-medium" data-testid="tc-status">
                  {status?.clocked_in ? <>On the clock · <span className="font-mono">{elapsed()}</span></> : "Clocked out"}
                </div>
                {status?.clocked_in && <div className="text-sm text-muted-foreground">Since {fmtTime(status.entry.clock_in)}</div>}
              </div>
            </div>
            {status?.clocked_in
              ? <Btn onClick={clockOut} data-testid="tc-clock-out-btn"><Stop size={18} weight="fill" /> Clock Out</Btn>
              : <Btn onClick={clockIn} data-testid="tc-clock-in-btn"><Play size={18} weight="fill" /> Clock In</Btn>}
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="overline text-muted-foreground self-center mr-2">{isAdmin ? "All timesheets" : "My timesheet"}</div>
            {isAdmin && (
              <label className="block"><span className="overline text-muted-foreground">Employee</span>
                <select value={fUser} onChange={(e) => setFUser(e.target.value)} data-testid="tc-filter-user" className="mt-1 block border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Everyone</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select></label>
            )}
            <label className="block"><span className="overline text-muted-foreground">From</span>
              <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} data-testid="tc-filter-from" className="mt-1 block border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
            <label className="block"><span className="overline text-muted-foreground">To</span>
              <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} data-testid="tc-filter-to" className="mt-1 block border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
            {(fFrom || fTo || fUser) && <Btn variant="outline" onClick={() => { setFFrom(""); setFTo(""); setFUser(""); }} data-testid="tc-filter-clear">Clear</Btn>}
            <div className="ml-auto text-sm font-mono self-center">Total: <span className="font-semibold">{totalHours.toFixed(2)} h</span></div>
          </div>

          <div className="border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-border text-left overline text-muted-foreground">
                  {isAdmin && <th className="px-5 py-3">Employee</th>}
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Clock in</th>
                  <th className="px-5 py-3">Clock out</th>
                  <th className="px-5 py-3 text-right">Hours</th>
                  <th className="px-5 py-3">Commission note</th>
                  {isAdmin && <th className="px-5 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody data-testid="tc-entries">
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-secondary/50" data-testid={`tc-row-${e.id}`}>
                    {isAdmin && <td className="px-5 py-3 font-medium">{e.user_name}</td>}
                    <td className="px-5 py-3 font-mono text-muted-foreground">{e.date}</td>
                    <td className="px-5 py-3">{fmtTime(e.clock_in)}</td>
                    <td className="px-5 py-3">{e.clock_out ? fmtTime(e.clock_out) : <span className="text-[#0E7490]">On the clock</span>}</td>
                    <td className="px-5 py-3 text-right font-mono">{e.hours == null ? "—" : e.hours.toFixed(2)}</td>
                    <td className="px-5 py-3 text-muted-foreground max-w-[240px] truncate">{e.commission_note || "—"}</td>
                    {isAdmin && (
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Btn variant="ghost" onClick={() => openEdit(e)} data-testid={`tc-edit-${e.id}`}><PencilSimple size={16} /></Btn>
                          <Btn variant="ghost" onClick={() => setDelRow(e)} data-testid={`tc-delete-${e.id}`}><Trash size={16} /></Btn>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {entries.length === 0 && <tr><td colSpan={isAdmin ? 7 : 5} className="px-6 py-10 text-center text-muted-foreground">No time entries.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg" data-testid="tc-entry-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit" : "Add"} Time Entry</DialogTitle>
            <DialogDescription className="font-mono text-xs">Correct clock times or add a missed entry. Commission note is optional.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!editing && (
              <label className="block"><span className="overline text-muted-foreground">Team member</span>
                <select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} data-testid="tc-form-user" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">— Select —</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select></label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="overline text-muted-foreground">Clock in</span>
                <input type="datetime-local" value={form.clock_in} onChange={(e) => setForm({ ...form, clock_in: e.target.value })} data-testid="tc-form-in" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
              <label className="block"><span className="overline text-muted-foreground">Clock out</span>
                <input type="datetime-local" value={form.clock_out} onChange={(e) => setForm({ ...form, clock_out: e.target.value })} data-testid="tc-form-out" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
            </div>
            <label className="block"><span className="overline text-muted-foreground">Commission note</span>
              <textarea value={form.commission_note} onChange={(e) => setForm({ ...form, commission_note: e.target.value })} data-testid="tc-form-commission" rows={3} placeholder="Commission / pay notes for this entry" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="tc-save-btn">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={!!delRow} label={`time entry for ${delRow?.user_name || ""}`} onClose={() => setDelRow(null)} onConfirm={confirmDelete} />
    </div>
  );
}
