import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { currency } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { StatCard, Btn } from "@/components/kit";
import {
  ArrowCircleDown,
  ArrowCircleUp,
  FileText,
  ClipboardText,
  Wallet,
  Users,
  Stack,
} from "@phosphor-icons/react";

export default function Dashboard() {
  const [d, setD] = useState(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api.get("/dashboard").then((r) => setD(r.data)).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader overline="Shop overview" title="Dashboard" />
      <div className="p-8 space-y-8">
        <div className={`grid grid-cols-1 md:grid-cols-2 ${isAdmin ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-px bg-border border border-border`}>
          <div onClick={() => navigate("/receivables?filter=overdue")} className="cursor-pointer transition-colors hover:bg-secondary/40" data-testid="receivable-link" title="View overdue receivables">
            <StatCard testid="stat-receivable" label="Outstanding Receivable" value={currency(d?.receivable)} accent="#F59E0B" sub="View overdue →" />
          </div>
          {isAdmin && (
            <div onClick={() => navigate("/payables")} className="cursor-pointer transition-colors hover:bg-secondary/40" data-testid="payable-link" title="View accounts payable">
              <StatCard testid="stat-payable" label="Accounts Payable" value={currency(d?.payable)} accent="#DC2626" sub="Bills owed to vendors →" />
            </div>
          )}
          <div onClick={() => navigate("/receivables")} className="cursor-pointer transition-colors hover:bg-secondary/40" data-testid="collected-link" title="View collected invoices">
            <StatCard testid="stat-collected" label="Collected (paid)" value={currency(d?.collected)} accent="#16A34A" sub="Invoices marked paid →" />
          </div>
          <StatCard testid="stat-netcash" label="Net Cash Position" value={currency(d?.net_cash)} accent="#06B6D4" sub="Collected − bills paid" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-px bg-border border border-border">
          <MiniStat icon={FileText} label="Open Estimates" value={d?.open_estimates ?? "—"} onClick={() => navigate("/estimates")} testid="mini-estimates" />
          <MiniStat icon={ClipboardText} label="Open Sales Orders" value={d?.open_sales_orders ?? "—"} onClick={() => navigate("/sales-orders")} testid="mini-sales-orders" />
          <MiniStat icon={Wallet} label="Total Invoices" value={d?.invoice_count ?? "—"} onClick={() => navigate("/invoices")} testid="mini-invoices" />
          <MiniStat icon={Users} label="Customers" value={d?.customer_count ?? "—"} onClick={() => navigate("/customers")} testid="mini-customers" />
          <MiniStat icon={Stack} label="Materials" value={d?.material_count ?? "—"} onClick={() => navigate("/materials")} testid="mini-materials" />
        </div>

        <div>
          <div className="overline text-muted-foreground mb-3">Quick actions</div>
          <div className="flex flex-wrap gap-3">
            <Btn onClick={() => navigate("/estimates")} data-testid="qa-estimate"><FileText size={16} weight="bold" /> New Estimate</Btn>
            <Btn variant="outline" onClick={() => navigate("/invoices")} data-testid="qa-invoice"><ArrowCircleDown size={16} weight="bold" /> New Invoice</Btn>
            {isAdmin && <Btn variant="outline" onClick={() => navigate("/payables")} data-testid="qa-bill"><ArrowCircleUp size={16} weight="bold" /> Record Bill</Btn>}
            {isAdmin && <Btn variant="outline" onClick={() => navigate("/materials")} data-testid="qa-material"><Stack size={16} weight="bold" /> Add Material</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, onClick, testid }) {
  return (
    <div onClick={onClick} data-testid={testid} className={`bg-card p-6 flex items-center gap-4 ${onClick ? "cursor-pointer transition-colors hover:bg-secondary/40" : ""}`}>
      <div className="h-10 w-10 border border-border flex items-center justify-center">
        <Icon size={20} weight="bold" />
      </div>
      <div>
        <div className="font-display font-bold text-2xl leading-none">{value}</div>
        <div className="overline text-muted-foreground mt-1">{label}</div>
      </div>
    </div>
  );
}
