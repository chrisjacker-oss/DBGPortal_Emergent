import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  Gauge,
  Users,
  Stack,
  FileText,
  Receipt,
  ArrowsClockwise,
  ArrowCircleUp,
  ArrowCircleDown,
  SignOut,
} from "@phosphor-icons/react";

const staffLinks = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/estimates", label: "Estimates", icon: FileText },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/materials", label: "Materials", icon: Stack },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/receivables", label: "Receivable", icon: ArrowCircleDown },
  { to: "/payables", label: "Payable", icon: ArrowCircleUp },
  { to: "/reorders", label: "Reorders", icon: ArrowsClockwise },
];

export const Navigation = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isCustomer = user?.role === "customer";
  const links = isCustomer ? [{ to: "/portal", label: "My Orders", icon: ArrowsClockwise }] : staffLinks;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col h-screen sticky top-0" data-testid="sidebar">
      <div className="px-6 py-6 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 bg-foreground flex items-center justify-center">
            <span className="text-primary-foreground font-mono font-bold text-[10px]">DBG</span>
          </div>
          <div>
            <div className="font-display font-bold tracking-tight leading-none text-[15px]">DBG SIGNS</div>
            <div className="overline text-muted-foreground mt-1">Image Is Everything</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4 overflow-y-auto">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            data-testid={`nav-${label.toLowerCase().replace(/\s/g, "-")}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-6 py-2.5 text-sm border-l-2 transition-colors duration-150 ${
                isActive
                  ? "border-[#06B6D4] bg-secondary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`
            }
          >
            <Icon size={18} weight="bold" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-4">
        <div className="mb-3">
          <div className="text-sm font-medium truncate">{user?.name}</div>
          <div className="overline text-muted-foreground mt-0.5">{user?.role}</div>
        </div>
        <button
          onClick={handleLogout}
          data-testid="logout-btn"
          className="w-full flex items-center justify-center gap-2 text-sm py-2 border border-border hover:bg-foreground hover:text-primary-foreground transition-colors duration-150 rounded-none"
        >
          <SignOut size={16} weight="bold" /> Sign out
        </button>
      </div>
    </aside>
  );
};
