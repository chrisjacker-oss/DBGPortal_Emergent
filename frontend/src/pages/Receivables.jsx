import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatCard, StatusBadge } from "@/components/kit";
import { downloadCsv } from "@/lib/download";
import { CheckCircle, DownloadSimple } from "@phosphor-icons/react";

export default function Receivables() {
  const [rows, setRows] = useState([]);
  const load = () => api.get("/invoices").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const markPaid = async (id) => { await api.patch(`/invoices/${id}/status`, null, { params: { status: "paid" } }); toast.success("Payment recorded"); load(); };

  const open = rows.filter((r) => r.status !== "paid");
  const outstanding = open.reduce((s, r) => s + r.total, 0);
  const collected = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.total, 0);

  const isOverdue = (r) => r.status !== "paid" && r.due_date && new Date(r.due_date) < new Date();

  return (
    <div>
      <PageHeader overline="Accounts Receivable" title="Receivables">
        <Btn variant="outline" onClick={() => downloadCsv("/export/xero/invoices", "xero_invoices.csv")} data-testid="ar-export-btn">
          <DownloadSimple size={16} weight="bold" /> Export to Xero
        </Btn>
      </PageHeader>

      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
          <StatCard testid="ar-outstanding" label="Total Receivable" value={currency(outstanding)} accent="#F59E0B" sub={`${open.length} open invoices`} />
          <StatCard testid="ar-collected" label="Collected" value={currency(collected)} accent="#16A34A" />
          <StatCard testid="ar-overdue" label="Overdue" value={currency(open.filter(isOverdue).reduce((s, r) => s + r.total, 0))} accent="#DC2626" />
        </div>

        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">#</th>
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Due</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Balance</th>
                <th className="px-6 py-3 font-mono text-right">Action</th>
              </tr>
            </thead>
            <tbody data-testid="receivables-table">
              {open.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-mono">{r.number}</td>
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3 font-mono text-muted-foreground">{r.due_date || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={isOverdue(r) ? "overdue" : r.status} /></td>
                  <td className="px-6 py-3 text-right font-mono">{currency(r.total)}</td>
                  <td className="px-6 py-3 text-right">
                    <Btn variant="ghost" onClick={() => markPaid(r.id)} data-testid={`receive-payment-${r.id}`}><CheckCircle size={16} /> Receive</Btn>
                  </td>
                </tr>
              ))}
              {open.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">Nothing outstanding — all caught up.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
