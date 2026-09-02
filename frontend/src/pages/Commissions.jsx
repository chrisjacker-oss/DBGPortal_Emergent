import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { StatCard, StatusBadge } from "@/components/kit";

export default function Commissions() {
  const { user } = useAuth();
  const [data, setData] = useState({ rows: [], by_salesman: [], total_earned: 0, total_pending: 0 });
  useEffect(() => { api.get("/commissions").then((r) => setData(r.data)); }, []);

  return (
    <div>
      <PageHeader overline={user?.role === "salesman" ? "Your earnings" : "Sales team"} title="Commissions" />
      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
          <StatCard testid="comm-earned" label="Earned (approved)" value={currency(data.total_earned)} accent="#16A34A" />
          <StatCard testid="comm-pending" label="Pending (open estimates)" value={currency(data.total_pending)} accent="#F59E0B" />
          <StatCard testid="comm-total" label="Total Pipeline" value={currency(data.total_earned + data.total_pending)} accent="#A21CAF" />
        </div>

        {user?.role !== "salesman" && data.by_salesman.length > 0 && (
          <div>
            <div className="overline text-muted-foreground mb-3">By salesman</div>
            <div className="border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left overline text-muted-foreground">
                    <th className="px-6 py-3 font-mono">Salesman</th>
                    <th className="px-6 py-3 font-mono text-right">Estimates</th>
                    <th className="px-6 py-3 font-mono text-right">Earned</th>
                    <th className="px-6 py-3 font-mono text-right">Pending</th>
                    <th className="px-6 py-3 font-mono text-right">Total</th>
                  </tr>
                </thead>
                <tbody data-testid="commission-by-salesman">
                  {data.by_salesman.map((s) => (
                    <tr key={s.salesman_name} className="border-b border-border last:border-0 hover:bg-secondary/50">
                      <td className="px-6 py-3 font-medium">{s.salesman_name}</td>
                      <td className="px-6 py-3 text-right font-mono">{s.count}</td>
                      <td className="px-6 py-3 text-right font-mono text-[#16A34A]">{currency(s.earned)}</td>
                      <td className="px-6 py-3 text-right font-mono text-[#B45309]">{currency(s.pending)}</td>
                      <td className="px-6 py-3 text-right font-mono font-semibold">{currency(s.earned + s.pending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <div className="overline text-muted-foreground mb-3">Commission breakdown</div>
          <div className="border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left overline text-muted-foreground">
                  <th className="px-6 py-3 font-mono">Estimate</th>
                  <th className="px-6 py-3 font-mono">Customer</th>
                  <th className="px-6 py-3 font-mono">Salesman</th>
                  <th className="px-6 py-3 font-mono">Status</th>
                  <th className="px-6 py-3 font-mono text-right">Sale Base</th>
                  <th className="px-6 py-3 font-mono text-right">Rate</th>
                  <th className="px-6 py-3 font-mono text-right">Commission</th>
                </tr>
              </thead>
              <tbody data-testid="commission-rows">
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                    <td className="px-6 py-3 font-mono">{r.number}<div className="text-xs text-muted-foreground font-sans">{r.title}</div></td>
                    <td className="px-6 py-3">{r.customer_name}</td>
                    <td className="px-6 py-3">{r.salesman_name}</td>
                    <td className="px-6 py-3"><StatusBadge status={r.earned ? "approved" : r.status} /></td>
                    <td className="px-6 py-3 text-right font-mono">{currency(r.base)}</td>
                    <td className="px-6 py-3 text-right font-mono">{r.commission_rate}%</td>
                    <td className="px-6 py-3 text-right font-mono font-semibold text-[#A21CAF]">{currency(r.commission_amount)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && <tr><td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">No commissions yet. Set a rate when creating an estimate.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
