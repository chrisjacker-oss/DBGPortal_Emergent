import { currency, carrierInfo } from "@/lib/api";
import { PaperPlaneTilt, CheckCircle } from "@phosphor-icons/react";

export function TrackingLink({ value, shipType, shippedDate, testid }) {
  if (!value && !shipType && !shippedDate) return <span className="text-xs text-muted-foreground" data-testid={testid}>—</span>;
  const info = value ? carrierInfo(value) : null;
  return (
    <span className="inline-flex flex-col gap-0.5" data-testid={testid}>
      {shipType ? <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{shipType}</span> : null}
      {value ? (
        <a href={info.url} target="_blank" rel="noopener noreferrer" title={`Track with ${info.carrier}`} onClick={(e) => e.stopPropagation()}
          className="text-[#0E7490] hover:underline font-mono text-sm">{value}</a>
      ) : <span className="text-xs text-muted-foreground">—</span>}
      {shippedDate ? <span className="text-[10px] text-muted-foreground">Shipped {shippedDate}</span> : null}
    </span>
  );
}

export function ReceiptBadge({ doc }) {
  if (!doc?.email_sent_at) return <span className="text-xs text-muted-foreground" data-testid="receipt-none">—</span>;
  const receipts = Array.isArray(doc.email_receipts) ? doc.email_receipts : [];
  const recipients = receipts.length
    ? receipts.map((r) => r.email)
    : (Array.isArray(doc.email_recipients) && doc.email_recipients.length
        ? doc.email_recipients
        : (doc.email_to ? String(doc.email_to).split(",").map((s) => s.trim()).filter(Boolean) : []));
  const n = recipients.length || 1;
  const openedCount = receipts.length ? receipts.filter((r) => r.opened_at).length : (doc.email_opened_at ? 1 : 0);
  const anyOpened = openedCount > 0;
  const sentWhen = new Date(doc.email_sent_at).toLocaleString();
  const label = anyOpened ? `Opened ${openedCount}/${n}` : (n > 1 ? `Emailed to ${n} people` : `Emailed to ${n}`);
  const tip = receipts.length
    ? receipts.map((r) => `${r.email} — ${r.opened_at ? "opened " + new Date(r.opened_at).toLocaleString() : "not opened yet"}`).join("\n")
    : `Sent ${sentWhen}${recipients.length ? " · " + recipients.join(", ") : ""}`;
  return (
    <span data-testid="receipt-badge" title={tip}
      className={`inline-flex items-center gap-1 text-xs font-mono ${anyOpened ? "text-[#16A34A]" : "text-[#B45309]"}`}>
      {anyOpened ? <CheckCircle size={14} weight="bold" /> : <PaperPlaneTilt size={14} weight="bold" />}
      {label}
    </span>
  );
}

export function StatCard({ label, value, accent, testid, sub }) {
  return (
    <div className="bg-card border border-border p-6 relative" data-testid={testid}>
      <div className="absolute top-0 left-0 h-1 w-full" style={{ background: accent || "transparent" }} />
      <div className="overline text-muted-foreground">{label}</div>
      <div className="font-display font-bold tracking-tight text-3xl mt-3">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export function Money({ children }) {
  return <span className="font-mono">{currency(children)}</span>;
}

export function Btn({ children, variant = "solid", className = "", ...props }) {
  const base =
    "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-none transition-colors duration-150 disabled:opacity-50";
  const styles = {
    solid: "bg-foreground text-primary-foreground hover:bg-foreground/90",
    outline: "border border-border bg-card hover:bg-foreground hover:text-primary-foreground",
    ghost: "hover:bg-secondary text-muted-foreground hover:text-foreground",
    danger: "border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground",
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

const statusColors = {
  paid: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/30",
  unpaid: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30",
  overdue: "bg-destructive/10 text-destructive border-destructive/30",
  partial: "bg-[#06B6D4]/10 text-[#0E7490] border-[#06B6D4]/30",
  draft: "bg-muted text-muted-foreground border-border",
  sent: "bg-[#06B6D4]/10 text-[#0E7490] border-[#06B6D4]/30",
  approved: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  requested: "bg-[#D946EF]/10 text-[#A21CAF] border-[#D946EF]/30",
  processing: "bg-[#06B6D4]/10 text-[#0E7490] border-[#06B6D4]/30",
  completed: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/30",
};

export function StatusBadge({ status }) {
  const cls = statusColors[status] || "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-block border px-2 py-0.5 text-xs font-mono uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}

export const WORK_STATUS = [
  { value: "", label: "— Not set —" },
  { value: "approved", label: "Approved" },
  { value: "in_production", label: "In Production" },
  { value: "in_finishing", label: "In Finishing" },
  { value: "ready", label: "Pickup / Shipping" },
];

export function WorkStatusSelect({ value, onChange, disabled, testid }) {
  const current = WORK_STATUS.find((w) => w.value === (value || ""));
  if (disabled) {
    return <span className="text-xs font-mono text-muted-foreground" data-testid={testid}>{current?.label || "—"}</span>;
  }
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}
      className="border border-input bg-card px-2 py-1.5 text-xs rounded-none focus:outline-none focus:ring-1 focus:ring-ring">
      {WORK_STATUS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
    </select>
  );
}

const workStatusColors = {
  approved: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/30",
  in_production: "bg-[#06B6D4]/10 text-[#0E7490] border-[#06B6D4]/30",
  in_finishing: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30",
  ready: "bg-[#D946EF]/10 text-[#A21CAF] border-[#D946EF]/30",
};

export function WorkStatusBadge({ status, testid }) {
  const label = WORK_STATUS.find((w) => w.value === status)?.label;
  if (!label || !status) return <span className="text-xs text-muted-foreground" data-testid={testid}>—</span>;
  const cls = workStatusColors[status] || "bg-muted text-muted-foreground border-border";
  return <span className={`inline-block border px-2 py-0.5 text-xs font-mono uppercase tracking-wider ${cls}`} data-testid={testid}>{label}</span>;
}
