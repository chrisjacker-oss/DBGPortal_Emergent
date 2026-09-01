import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const empty = { name: "", company: "", email: "", phone: "", address: "", notes: "" };

export default function Customers() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);

  const load = () => api.get("/customers").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditing(null); setOpen(true); };
  const openEdit = (r) => { setForm(r); setEditing(r.id); setOpen(true); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    try {
      if (editing) await api.put(`/customers/${editing}`, form);
      else await api.post("/customers", form);
      toast.success("Customer saved");
      setOpen(false);
      load();
    } catch (e) { toast.error("Save failed"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this customer?")) return;
    await api.delete(`/customers/${id}`);
    toast.success("Deleted");
    load();
  };

  return (
    <div>
      <PageHeader overline="CRM" title="Customers">
        <Btn onClick={openNew} data-testid="add-customer-btn"><Plus size={16} weight="bold" /> New Customer</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">Name</th>
                <th className="px-6 py-3 font-mono">Company</th>
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono">Phone</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="customers-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-medium">{r.name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.company || "—"}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.email || "—"}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.phone || "—"}</td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-2">
                      <Btn variant="ghost" onClick={() => openEdit(r)} data-testid={`edit-customer-${r.id}`}><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => remove(r.id)} data-testid={`delete-customer-${r.id}`}><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">No customers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Edit" : "New"} Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Inp label="Name" value={form.name} onChange={set("name")} testid="cust-name" />
            <Inp label="Company" value={form.company} onChange={set("company")} testid="cust-company" />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Email" value={form.email} onChange={set("email")} testid="cust-email" />
              <Inp label="Phone" value={form.phone} onChange={set("phone")} testid="cust-phone" />
            </div>
            <Inp label="Address" value={form.address} onChange={set("address")} testid="cust-address" />
            <Inp label="Notes" value={form.notes} onChange={set("notes")} testid="cust-notes" />
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="save-customer-btn">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
