import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge, ReceiptBadge } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import { Receipt, Trash, EnvelopeSimple, Plus, PencilSimple, Prohibit, ArrowCounterClockwise } from "@phosphor-icons/react";

const NEXT = { open: "in_production", in_production: "fulfilled" };

export default function SalesOrders() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delSo, setDelSo] = useState(null);
  const [tab, setTab] = useState("active");
  const load = () => api.get("/sales-orders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const save = async (payload) => {
    try {
      if (editing) await api.put(`/sales-orders/${editing.id}`, payload);
      else await api.post("/sales-orders", payload);
      toast.success("Sales order saved");
      setOpen(false); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const advance = async (r) => {
    const status = NEXT[r.status];
    if (!status) return;
    try {
      await api.patch(`/sales-orders/${r.id}/status`, null, { params: { status } });
      toast.success(`Marked ${status.replace("_", " ")}`); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
  };
  const sendEmail = async (id) => {
    try { const { data } = await api.post(`/sales-orders/${id}/send`); toast.success(`Emailed to ${data.to}`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Email failed"); }
  };
  const convert = async (id) => {
    try {
      const { data } = await api.post(`/sales-orders/${id}/convert`);
      toast.success(`Invoice ${data.number} created`); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Convert failed"); }
  };
  const setVoid = async (id, voided) => {
    try {
      await api.patch(`/sales-orders/${id}/void`, null, { params: { voided } });
      toast.success(voided ? "Sales order voided" : "Sales order reactivated"); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const confirmDelete = async (password) => {
    try {
      await api.delete(`/sales-orders/${delSo.id}`, { data: { password } });
      toast.success("Sales order deleted"); setDelSo(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  const visible = rows.filter((r) => (tab === "voided" ? r.voided : !r.voided));

  return (
    <div>
      <PageHeader overline="Production" title="Sales Orders">
        <Btn onClick={() => { setEditing(null); setOpen(true); }} data-testid="add-so-btn"><Plus size={16} weight="bold" /> New Sales Order</Btn>
      </PageHeader>
      <div className="p-8">
        <div className="flex gap-2 mb-4" data-testid="so-tabs">
          <Btn variant={tab === "active" ? "solid" : "outline"} onClick={() => setTab("active")} data-testid="so-tab-active">Active</Btn>
          <Btn variant={tab === "voided" ? "solid" : "outline"} onClick={() => setTab("voided")} data-testid="so-tab-voided">Voided</Btn>
        </div>
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Job</th>
                <th className="px-6 py-3 font-mono">From</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Total</th>
                <th className="px-6 py-3 font-mono">Email</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="sales-orders-table">
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-mono">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.title}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.from_estimate || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  <td className="px-6 py-3"><ReceiptBadge doc={r} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      {!r.voided && <>
                        <Btn variant="ghost" onClick={() => sendEmail(r.id)} data-testid={`send-so-${r.id}`} title="Email to customer"><EnvelopeSimple size={16} /></Btn>
                        {NEXT[r.status] && <Btn variant="ghost" onClick={() => advance(r)} data-testid={`advance-so-${r.id}`}>{NEXT[r.status].replace("_", " ")}</Btn>}
                        {!r.invoice_id && <Btn variant="ghost" onClick={() => convert(r.id)} data-testid={`invoice-so-${r.id}`} title="Convert to invoice"><Receipt size={16} /> Invoice</Btn>}
                        <Btn variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} data-testid={`edit-so-${r.id}`}><PencilSimple size={16} /></Btn>
                        <Btn variant="ghost" onClick={() => setVoid(r.id, true)} data-testid={`void-so-${r.id}`} title="Void"><Prohibit size={16} /></Btn>
                      </>}
                      {r.voided && (
                        <Btn variant="ghost" onClick={() => setVoid(r.id, false)} data-testid={`reactivate-so-${r.id}`} title="Reactivate"><ArrowCounterClockwise size={16} /></Btn>
                      )}
                      {isAdmin && (
                        <Btn variant="ghost" onClick={() => setDelSo(r)} data-testid={`delete-so-${r.id}`} title="Delete"><Trash size={16} /></Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={8} className="px-6 py-10 text-center text-muted-foreground">No {tab} sales orders.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DocBuilder open={open} kind="sales-order" initial={editing} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} />
      <AdminDeleteDialog open={!!delSo} label={`sales order ${delSo?.number || ""}`} onClose={() => setDelSo(null)} onConfirm={confirmDelete} />
    </div>
  );
}
