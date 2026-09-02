import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { UserPlus, Trash, Prohibit, CheckCircle } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";

const empty = { name: "", email: "", password: "", company: "", phone: "", tier: "", net_terms: "Net 15" };

export default function PortalAccounts() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [delRow, setDelRow] = useState(null);

  const load = () => api.get("/portal-accounts").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async () => {
    if (!form.name || !form.email || !form.password) { toast.error("Name, email and password are required"); return; }
    try {
      await api.post("/portal-accounts", {
        name: form.name, email: form.email, password: form.password,
        company: form.company || null, phone: form.phone || null,
        tier: form.tier === "" ? null : Number(form.tier), net_terms: form.net_terms,
      });
      toast.success("Portal account created"); setOpen(false); setForm(empty); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Create failed"); }
  };

  const toggleSuspend = async (r) => {
    try {
      await api.patch(`/portal-accounts/${r.id}/status`, null, { params: { suspended: !r.suspended } });
      toast.success(r.suspended ? "Account reactivated" : "Account suspended"); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const confirmDelete = async (password) => {
    try {
      await api.delete(`/portal-accounts/${delRow.id}`, { data: { password } });
      toast.success("Portal account deleted"); setDelRow(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  return (
    <div>
      <PageHeader overline="Access · Customer Portal" title="Portal Accounts">
        <Btn onClick={() => { setForm(empty); setOpen(true); }} data-testid="add-portal-account-btn"><UserPlus size={16} weight="bold" /> New Account</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">Name</th>
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono">Company</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="portal-accounts-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-medium">{r.name}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.email}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.company || "—"}</td>
                  <td className="px-6 py-3">
                    {r.suspended
                      ? <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 border border-[#DC2626]/40 text-[#DC2626]" data-testid={`status-${r.id}`}>Suspended</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 border border-[#16A34A]/40 text-[#16A34A]" data-testid={`status-${r.id}`}>Active</span>}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => toggleSuspend(r)} data-testid={`suspend-${r.id}`} title={r.suspended ? "Reactivate" : "Suspend"}>
                        {r.suspended ? <CheckCircle size={16} /> : <Prohibit size={16} />}
                      </Btn>
                      <Btn variant="ghost" onClick={() => setDelRow(r)} data-testid={`delete-portal-account-${r.id}`} title="Delete"><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">No portal accounts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg" data-testid="portal-account-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">New Portal Account</DialogTitle>
            <DialogDescription className="font-mono text-xs">Creates a customer login for the reorder & payment portal.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Inp label="Full name" value={form.name} onChange={set("name")} testid="pa-name" />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Email" type="email" value={form.email} onChange={set("email")} testid="pa-email" />
              <Inp label="Temporary password" type="text" value={form.password} onChange={set("password")} testid="pa-password" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Company" value={form.company} onChange={set("company")} testid="pa-company" />
              <Inp label="Phone" value={form.phone} onChange={set("phone")} testid="pa-phone" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="overline text-muted-foreground">Pricing tier</span>
                <select value={form.tier} onChange={set("tier")} data-testid="pa-tier" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">No tier</option>
                  <option value="1">Tier 1 (35%)</option>
                  <option value="2">Tier 2 (25%)</option>
                  <option value="3">Tier 3 (15%)</option>
                </select>
              </label>
              <label className="block">
                <span className="overline text-muted-foreground">Net terms</span>
                <select value={form.net_terms} onChange={set("net_terms")} data-testid="pa-terms" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {["COD", "50/50", "Net 10", "Net 15"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={create} data-testid="save-portal-account-btn">Create account</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={!!delRow} label={`portal login for ${delRow?.email || ""}`} onClose={() => setDelRow(null)} onConfirm={confirmDelete} />
    </div>
  );
}
