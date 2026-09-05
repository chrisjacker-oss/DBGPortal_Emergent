import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import api, { currency } from "@/lib/api";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
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
  const [team, setTeam] = useState(null);
  const [tFrom, setTFrom] = useState("");
  const [tTo, setTTo] = useState("");
  const loadTeam = (from, to) => {
    const q = [];
    if (from) q.push(`start=${from}`);
    if (to) q.push(`end=${to}`);
    api.get(`/reports/salespeople${q.length ? `?${q.join("&")}` : ""}`).then((r) => setTeam(r.data)).catch(() => {});
  };
  useEffect(() => { api.get("/reports/sales").then((r) => setData(r.data)).catch(() => {}); }, []);
  useEffect(() => { loadTeam(); }, []);

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

      {team && (
        <div className="mt-10" data-testid="salesperson-report">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div className="overline text-muted-foreground">Sales by salesperson · {team.period_label}</div>
            <div className="flex items-end gap-2">
              <label className="block"><span className="overline text-muted-foreground">From</span>
                <input type="date" value={tFrom} onChange={(e) => setTFrom(e.target.value)} data-testid="salesperson-from"
                  className="mt-1 block border border-input bg-card px-3 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
              </label>
              <label className="block"><span className="overline text-muted-foreground">To</span>
                <input type="date" value={tTo} onChange={(e) => setTTo(e.target.value)} data-testid="salesperson-to"
                  className="mt-1 block border border-input bg-card px-3 py-1.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
              </label>
              <Btn variant="solid" onClick={() => loadTeam(tFrom, tTo)} data-testid="salesperson-apply">Apply</Btn>
              <Btn variant="outline" onClick={() => { setTFrom(""); setTTo(""); loadTeam(); }} data-testid="salesperson-reset">YTD</Btn>
            </div>
          </div>

          {team.salespeople.length === 0 ? (
            <div className="border border-border bg-card p-8 text-center text-muted-foreground" data-testid="salesperson-empty">No sales in this period.</div>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-border bg-card p-5" data-testid="salesperson-chart">
              <ResponsiveContainer width="100%" height={Math.max(220, team.salespeople.length * 54)}>
                <BarChart data={team.salespeople} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="salesman_name" tick={{ fontSize: 12 }} width={110} />
                  <Tooltip formatter={(v) => currency(v)} />
                  <Legend />
                  <Bar dataKey="ytd_sales" name="Sales" fill="#06B6D4" radius={[0, 2, 2, 0]} />
                  <Bar dataKey="ytd_commission" name="Commission" fill="#F59E0B" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="border border-border bg-card overflow-x-auto" data-testid="salesperson-table">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left overline text-muted-foreground">
                  <th className="px-4 py-3">Salesperson</th>
                  <th className="px-4 py-3 text-right font-mono">Invoices</th>
                  <th className="px-4 py-3 text-right font-mono">Sales</th>
                  <th className="px-4 py-3 text-right font-mono">Collected</th>
                  <th className="px-4 py-3 text-right font-mono">Commission</th>
                </tr></thead>
                <tbody>
                  {team.salespeople.map((s) => (
                    <tr key={s.salesman_name} className="border-b border-border last:border-0" data-testid={`salesperson-row-${s.salesman_name}`}>
                      <td className="px-4 py-2 font-medium">{s.salesman_name}</td>
                      <td className="px-4 py-2 text-right font-mono">{s.invoice_count}</td>
                      <td className="px-4 py-2 text-right font-mono">{currency(s.ytd_sales)}</td>
                      <td className="px-4 py-2 text-right font-mono text-[#16A34A]">{currency(s.ytd_collected)}</td>
                      <td className="px-4 py-2 text-right font-mono text-[#B45309]">{currency(s.ytd_commission)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-border font-semibold">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right font-mono">{team.totals.invoice_count}</td>
                  <td className="px-4 py-3 text-right font-mono">{currency(team.totals.sales)}</td>
                  <td className="px-4 py-3 text-right font-mono text-[#16A34A]">{currency(team.totals.collected)}</td>
                  <td className="px-4 py-3 text-right font-mono text-[#B45309]">{currency(team.totals.commission)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
