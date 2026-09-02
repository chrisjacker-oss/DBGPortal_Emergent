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
          <div onClick={() => navigate("/receivables")} className="cursor-pointer transition-colors hover:bg-secondary/40" data-testid="receivable-link" title="View all outstanding receivables">
            <StatCard testid="stat-receivable" label="Outstanding Receivable" value={currency(d?.receivable)} accent="#F59E0B" sub="View all outstanding →" />
          </div>
          {isAdmin && <StatCard testid="stat-payable" label="Accounts Payable" value={currency(d?.payable)} accent="#DC2626" sub="Bills owed to vendors" />}
          <StatCard testid="stat-collected" label="Collected (paid)" value={currency(d?.collected)} accent="#16A34A" sub="Invoices marked paid" />
          <StatCard testid="stat-netcash" label="Net Cash Position" value={currency(d?.net_cash)} accent="#06B6D4" sub="Collected − bills paid" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-px bg-border border border-border">
          <MiniStat icon={FileText} label="Open Estimates" value={d?.open_estimates ?? "—"} />
          <MiniStat icon={ClipboardText} label="Open Sales Orders" value={d?.open_sales_orders ?? "—"} />
          <MiniStat icon={Wallet} label="Total Invoices" value={d?.invoice_count ?? "—"} />
          <MiniStat icon={Users} label="Customers" value={d?.customer_count ?? "—"} />
          <MiniStat icon={Stack} label="Materials" value={d?.material_count ?? "—"} />
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

function MiniStat({ icon: Icon, label, value }) {
  return (
    <div className="bg-card p-6 flex items-center gap-4">
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
