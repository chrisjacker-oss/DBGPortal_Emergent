import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";

const empty = { name: "", email: "", password: "", role: "salesman", commission_rate: 10 };

export default function Team() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [delRow, setDelRow] = useState(null);

  const load = () => api.get("/users").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditing(null); setOpen(true); };
  const openEdit = (r) => { setForm({ ...empty, ...r, password: "" }); setEditing(r.id); setOpen(true); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    const payload = { name: form.name, email: form.email, role: form.role, commission_rate: Number(form.commission_rate) };
    if (form.password) payload.password = form.password;
    try {
      if (editing) await api.put(`/users/${editing}`, payload);
      else await api.post("/users", payload);
      toast.success("Team member saved"); setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };
  const confirmDelete = async (password) => {
    try {
      await api.delete(`/users/${delRow.id}`, { data: { password } });
      toast.success("Team member removed"); setDelRow(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  return (
    <div>
      <PageHeader overline="Administration" title="Team & Roles">
        <Btn onClick={openNew} data-testid="add-user-btn"><Plus size={16} weight="bold" /> Add Member</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">Name</th>
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono">Role</th>
                <th className="px-6 py-3 font-mono text-right">Commission</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="users-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-medium">{r.name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.email}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-block border px-2 py-0.5 text-xs font-mono uppercase tracking-wider ${r.role === "admin" ? "bg-foreground text-primary-foreground border-foreground" : "bg-[#06B6D4]/10 text-[#0E7490] border-[#06B6D4]/30"}`}>{r.role}</span>
                  </td>
                  <td className="px-6 py-3 text-right font-mono">{r.role === "salesman" ? `${r.commission_rate ?? 0}%` : "—"}</td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => openEdit(r)} data-testid={`edit-user-${r.id}`}><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => setDelRow(r)} data-testid={`delete-user-${r.id}`}><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">No team members.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit" : "New"} Team Member</DialogTitle>
            <DialogDescription className="font-mono text-xs">Admins have full control. Salesmen have limited access and earn commission.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Inp label="Full name" value={form.name} onChange={set("name")} testid="user-name" />
            <Inp label="Email" value={form.email} onChange={set("email")} testid="user-email" />
            <Inp label={editing ? "New password (leave blank to keep)" : "Password"} type="password" value={form.password} onChange={set("password")} testid="user-password" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="overline text-muted-foreground">Role</span>
                <select value={form.role} onChange={set("role")} data-testid="user-role" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="salesman">Salesman</option>
                  <option value="installer">Service / Installer</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <Inp label="Commission %" type="number" value={form.commission_rate} onChange={set("commission_rate")} testid="user-commission" />
            </div>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="save-user-btn">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={!!delRow} label={`team member ${delRow?.name || ""}`} onClose={() => setDelRow(null)} onConfirm={confirmDelete} />
    </div>
  );
}
