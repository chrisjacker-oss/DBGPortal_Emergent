import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatCard, StatusBadge } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { downloadCsv } from "@/lib/download";
import { Plus, PencilSimple, Trash, CheckCircle, DownloadSimple } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";

const empty = { vendor: "", reference: "", description: "", amount: 0, due_date: "", status: "unpaid" };

export default function Payables() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [delRow, setDelRow] = useState(null);

  const load = () => api.get("/bills").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const openNew = () => { setForm(empty); setEditing(null); setOpen(true); };
  const openEdit = (r) => { setForm({ ...empty, ...r }); setEditing(r.id); setOpen(true); };

  const save = async () => {
    const payload = { ...form, amount: Number(form.amount), due_date: form.due_date || null };
    try {
      if (editing) await api.put(`/bills/${editing}`, payload);
      else await api.post("/bills", payload);
      toast.success("Bill saved"); setOpen(false); load();
    } catch { toast.error("Save failed"); }
  };
  const markPaid = async (id) => { await api.patch(`/bills/${id}/status`, null, { params: { status: "paid" } }); toast.success("Marked paid"); load(); };
  const confirmDelete = async (password) => {
    try {
      await api.delete(`/bills/${delRow.id}`, { data: { password } });
      toast.success("Bill deleted"); setDelRow(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  const outstanding = rows.filter((r) => r.status !== "paid").reduce((s, r) => s + r.amount, 0);
  const paid = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <PageHeader overline="Accounts Payable" title="Bills & Payables">
        <Btn variant="outline" onClick={() => downloadCsv("/export/xero/bills", "xero_bills.csv")} data-testid="export-xero-bills-btn">
          <DownloadSimple size={16} weight="bold" /> Export to Xero
        </Btn>
        <Btn onClick={openNew} data-testid="add-bill-btn"><Plus size={16} weight="bold" /> Record Bill</Btn>
      </PageHeader>

      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
          <StatCard testid="ap-outstanding" label="Outstanding Payable" value={currency(outstanding)} accent="#DC2626" />
          <StatCard testid="ap-paid" label="Paid" value={currency(paid)} accent="#16A34A" />
          <StatCard testid="ap-count" label="Open Bills" value={rows.filter((r) => r.status !== "paid").length} accent="#F59E0B" />
        </div>

        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Vendor</th>
                <th className="px-6 py-3 font-mono">Description</th>
                <th className="px-6 py-3 font-mono">Due</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Amount</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="bills-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-mono">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.vendor}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.description || r.reference || "—"}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.due_date || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.amount)}</td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      {r.status !== "paid" && <Btn variant="ghost" onClick={() => markPaid(r.id)} data-testid={`pay-bill-${r.id}`}><CheckCircle size={16} /></Btn>}
                      <Btn variant="ghost" onClick={() => openEdit(r)} data-testid={`edit-bill-${r.id}`}><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => setDelRow(r)} data-testid={`delete-bill-${r.id}`}><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">No bills yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Edit" : "Record"} Bill</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Inp label="Vendor" value={form.vendor} onChange={set("vendor")} testid="bill-vendor" />
            <Inp label="Reference / PO" value={form.reference} onChange={set("reference")} testid="bill-ref" />
            <Inp label="Description" value={form.description} onChange={set("description")} testid="bill-desc" />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Amount" type="number" value={form.amount} onChange={set("amount")} testid="bill-amount" />
              <Inp label="Due date" type="date" value={form.due_date || ""} onChange={set("due_date")} testid="bill-due" />
            </div>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="save-bill-btn">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={!!delRow} label={`bill ${delRow?.number || ""}`} onClose={() => setDelRow(null)} onConfirm={confirmDelete} />
    </div>
  );
}
