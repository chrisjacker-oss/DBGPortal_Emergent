import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn, StatCard, StatusBadge } from "@/components/kit";
import { downloadCsv, downloadFile } from "@/lib/download";
import { CheckCircle, DownloadSimple, FilePdf, WarningCircle } from "@phosphor-icons/react";

const OVERDUE_DAYS = 45;

const daysOverdue = (r) => {
  const ref = (r.due_date || r.created_at || "").slice(0, 10);
  if (!ref) return 0;
  const diff = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
  return diff;
};

export default function Receivables() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const load = () => api.get("/invoices").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const markPaid = async (id) => { await api.patch(`/invoices/${id}/status`, null, { params: { status: "paid" } }); toast.success("Payment recorded"); load(); };
  const sendPastDue = async (id) => {
    try { const { data } = await api.post(`/invoices/${id}/send-past-due`); toast.success(data.sent ? `Past-due notice sent to ${data.to}` : `Skipped: ${data.reason}`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Send failed"); }
  };
  const sendAllPastDue = async () => {
    if (!window.confirm(`Email past-due notices for all invoices over ${OVERDUE_DAYS} days?`)) return;
    try { const { data } = await api.post("/receivables/send-past-due", null, { params: { days: OVERDUE_DAYS } });
      toast.success(`Sent ${data.sent_count}, skipped ${data.skipped_count}`); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Send failed"); }
  };
  const pdf = (r) => downloadFile(`/invoices/${r.id}/pdf`, `${r.number}.pdf`, "application/pdf");

  const open = rows.filter((r) => r.status !== "paid");
  const outstanding = open.reduce((s, r) => s + r.total, 0);
  const collected = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.total, 0);
  const isOverdue = (r) => r.status !== "paid" && r.due_date && new Date(r.due_date) < new Date();
  const pastDueCount = open.filter((r) => daysOverdue(r) > OVERDUE_DAYS).length;

  return (
    <div>
      <PageHeader overline="Accounts Receivable" title="Receivables">
        {isAdmin && (
          <Btn variant="outline" onClick={sendAllPastDue} data-testid="send-all-pastdue-btn" title={`Email all invoices over ${OVERDUE_DAYS} days past due`}>
            <WarningCircle size={16} weight="bold" /> Send Past-Due ({pastDueCount})
          </Btn>
        )}
        <Btn variant="outline" onClick={() => downloadCsv("/export/xero/invoices", "xero_invoices.csv")} data-testid="ar-export-btn">
          <DownloadSimple size={16} weight="bold" /> Export to Xero
        </Btn>
      </PageHeader>

      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-border border border-border">
          <StatCard testid="ar-outstanding" label="Total Receivable" value={currency(outstanding)} accent="#F59E0B" sub={`${open.length} open invoices`} />
          <StatCard testid="ar-collected" label="Collected" value={currency(collected)} accent="#16A34A" />
          <StatCard testid="ar-overdue" label="Overdue" value={currency(open.filter(isOverdue).reduce((s, r) => s + r.total, 0))} accent="#DC2626" />
          <StatCard testid="ar-pastdue45" label={`Past due > ${OVERDUE_DAYS}d`} value={pastDueCount} accent="#A21CAF" />
        </div>

        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Due</th>
                <th className="px-6 py-3 font-mono">Aging</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Balance</th>
                <th className="px-6 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="receivables-table">
              {open.map((r) => {
                const od = daysOverdue(r);
                const past = od > OVERDUE_DAYS;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                    <td className="px-6 py-3 font-mono">{r.number}</td>
                    <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                    <td className="px-6 py-3 font-mono text-muted-foreground">{r.due_date || "—"}</td>
                    <td className="px-6 py-3 font-mono text-xs">{od > 0 ? <span className={past ? "text-destructive font-semibold" : "text-muted-foreground"}>{od}d</span> : <span className="text-muted-foreground">current</span>}</td>
                    <td className="px-6 py-3"><StatusBadge status={isOverdue(r) ? "overdue" : r.status} /></td>
                    <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-1">
                        <Btn variant="ghost" onClick={() => pdf(r)} data-testid={`pdf-invoice-${r.id}`} title="Download PDF"><FilePdf size={16} /></Btn>
                        {isAdmin && past && <Btn variant="ghost" onClick={() => sendPastDue(r.id)} data-testid={`pastdue-invoice-${r.id}`} title="Send past-due notice + PDF"><WarningCircle size={16} /></Btn>}
                        <Btn variant="ghost" onClick={() => markPaid(r.id)} data-testid={`receive-payment-${r.id}`}><CheckCircle size={16} /> Receive</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {open.length === 0 && <tr><td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">Nothing outstanding — all caught up.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
