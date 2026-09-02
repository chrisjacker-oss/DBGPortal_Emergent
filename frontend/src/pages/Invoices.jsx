import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge, ReceiptBadge } from "@/components/kit";
import DocBuilder from "@/components/DocBuilder";
import PayNowDialog from "@/components/PayNowDialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import { downloadCsv, downloadFile } from "@/lib/download";
import { Plus, PencilSimple, Trash, CheckCircle, DownloadSimple, EnvelopeSimple, FilePdf, CreditCard, Prohibit, ArrowCounterClockwise } from "@phosphor-icons/react";

export default function Invoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [payInv, setPayInv] = useState(null);
  const [delInv, setDelInv] = useState(null);
  const [tab, setTab] = useState("active");

  const load = () => api.get("/invoices").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const save = async (payload) => {
    try {
      if (editing) await api.put(`/invoices/${editing.id}`, payload);
      else await api.post("/invoices", payload);
      toast.success("Invoice saved");
      setOpen(false); setEditing(null); load();
    } catch { toast.error("Save failed"); }
  };

  const markPaid = async (id) => {
    await api.patch(`/invoices/${id}/status`, null, { params: { status: "paid" } });
    toast.success("Marked paid"); load();
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

  const visible = rows.filter((r) => (tab === "voided" ? r.voided : !r.voided));

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
                  <td className="px-6 py-3 font-mono">{r.number}</td>
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
                      {!r.voided && <>
                        <Btn variant="ghost" onClick={() => sendEmail(r.id)} data-testid={`send-invoice-${r.id}`} title="Email to customer"><EnvelopeSimple size={16} /></Btn>
                        {r.status !== "paid" && (
                          <Btn variant="ghost" onClick={() => setPayInv(r)} data-testid={`pay-invoice-${r.id}`} title="Pay now (card)"><CreditCard size={16} /></Btn>
                        )}
                        {r.status !== "paid" && (
                          <Btn variant="ghost" onClick={() => markPaid(r.id)} data-testid={`mark-paid-${r.id}`} title="Mark paid"><CheckCircle size={16} /></Btn>
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
      <AdminDeleteDialog open={!!delInv} label={`invoice ${delInv?.number || ""}`} onClose={() => setDelInv(null)} onConfirm={confirmDelete} />
    </div>
  );
}
