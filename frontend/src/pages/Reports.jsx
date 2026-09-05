import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import api, { currency } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import { TrendUp, TrendDown } from "@phosphor-icons/react";

function Delta({ pct }) {
  const up = Number(pct) >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono font-semibold ${up ? "text-[#16A34A]" : "text-destructive"}`}>
      {up ? <TrendUp size={13} weight="bold" /> : <TrendDown size={13} weight="bold" />}{up ? "+" : ""}{Number(pct).toFixed(1)}%
    </span>
  );
}

export default function Reports() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/reports/sales").then((r) => setData(r.data)).catch(() => {}); }, []);

  if (!data) return <div className="p-8 text-muted-foreground">Loading…</div>;
  const k = data.kpis;
  const chart = data.months.map((m, i) => ({
    month: m,
    [`${data.year}`]: data.current_year_sales[i],
    [`${data.prev_year}`]: data.prev_year_sales[i],
  }));

  return (
    <div data-testid="reports-page">
      <PageHeader overline="Analytics" title="Sales & Performance" />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <div className="border border-border p-5 bg-card" data-testid="kpi-ytd">
          <div className="overline text-muted-foreground">Year to date ({data.year})</div>
          <div className="text-3xl font-display mt-2">{currency(k.ytd)}</div>
          <div className="mt-2 flex items-center gap-2"><Delta pct={k.ytd_change_pct} /><span className="text-xs text-muted-foreground">vs {currency(k.prev_ytd)} in {data.prev_year} YTD</span></div>
        </div>
        <div className="border border-border p-5 bg-card" data-testid="kpi-month">
          <div className="overline text-muted-foreground">This month ({k.this_month_label})</div>
          <div className="text-3xl font-display mt-2">{currency(k.this_month)}</div>
          <div className="mt-2 flex items-center gap-2"><Delta pct={k.mom_change_pct} /><span className="text-xs text-muted-foreground">vs {currency(k.last_month)} last month</span></div>
        </div>
        <div className="border border-border p-5 bg-card" data-testid="kpi-yoy-month">
          <div className="overline text-muted-foreground">Month vs last year</div>
          <div className="text-3xl font-display mt-2"><Delta pct={k.yoy_month_change_pct} /></div>
          <div className="mt-2 text-xs text-muted-foreground">{k.this_month_label}: {currency(k.this_month)} vs {currency(k.this_month_ly)} a year ago</div>
        </div>
        <div className="border border-border p-5 bg-card" data-testid="kpi-year-total">
          <div className="overline text-muted-foreground">{data.prev_year} full year</div>
          <div className="text-3xl font-display mt-2">{currency(k.prev_year_full)}</div>
          <div className="mt-2 text-xs text-muted-foreground">{data.year} so far: {currency(k.current_year_total)} · {k.invoice_count_ytd} invoices YTD</div>
        </div>
      </div>

      <div className="border border-border bg-card p-5" data-testid="reports-chart">
        <div className="overline text-muted-foreground mb-4">Month-to-month sales · {data.year} vs {data.prev_year}</div>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => currency(v)} />
            <Legend />
            <Bar dataKey={`${data.prev_year}`} fill="#94A3B8" radius={[2, 2, 0, 0]} />
            <Bar dataKey={`${data.year}`} fill="#06B6D4" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="border border-border bg-card mt-6 overflow-x-auto" data-testid="reports-table">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-left overline text-muted-foreground">
            <th className="px-4 py-3">Month</th>
            <th className="px-4 py-3 text-right font-mono">{data.year} Sales</th>
            <th className="px-4 py-3 text-right font-mono">{data.prev_year} Sales</th>
            <th className="px-4 py-3 text-right font-mono">YoY</th>
            <th className="px-4 py-3 text-right font-mono">Collected {data.year}</th>
          </tr></thead>
          <tbody>
            {data.months.map((m, i) => {
              const c = data.current_year_sales[i]; const p = data.prev_year_sales[i];
              const pct = p ? ((c - p) / p * 100) : (c ? 100 : 0);
              return (
                <tr key={m} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{m} {data.year}</td>
                  <td className="px-4 py-2 text-right font-mono">{currency(c)}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{currency(p)}</td>
                  <td className="px-4 py-2 text-right font-mono">{(c || p) ? <Delta pct={pct} /> : "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-[#16A34A]">{currency(data.current_year_paid[i])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
