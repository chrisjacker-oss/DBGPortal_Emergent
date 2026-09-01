import { currency } from "@/lib/api";

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
