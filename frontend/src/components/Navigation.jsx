import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { SearchBar } from "@/components/SearchBar";

const LOGO_URL = `${process.env.REACT_APP_BACKEND_URL}/api/pub/logo`;
import {
  Gauge,
  ChartBar,
  Users,
  Stack,
  FileText,
  Receipt,
  ClipboardText,
  ArrowsClockwise,
  ArrowCircleUp,
  ArrowCircleDown,
  Percent,
  UsersThree,
  IdentificationBadge,
  Wrench,
  Timer,
  CalendarCheck,
  Gear,
  SignOut,
} from "@phosphor-icons/react";

const adminLinks = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/reports", label: "Reports", icon: ChartBar },
  { to: "/estimates", label: "Estimates", icon: FileText },
  { to: "/sales-orders", label: "Sales Orders", icon: ClipboardText },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/install-calendar", label: "Install Calendar", icon: CalendarCheck },
  { to: "/reorders", label: "Reorders", icon: ArrowsClockwise },
  { to: "/work-orders", label: "Work Orders", icon: Wrench },
  { to: "/time-clock", label: "Time Clock", icon: Timer },
  { to: "/materials", label: "Materials", icon: Stack },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/portal-accounts", label: "Portal Accounts", icon: IdentificationBadge },
  { to: "/receivables", label: "Receivable", icon: ArrowCircleDown },
  { to: "/payables", label: "Payable", icon: ArrowCircleUp },
  { to: "/commissions", label: "Commissions", icon: Percent },
  { to: "/purchase-orders", label: "Purchase Orders", icon: Receipt },
  { to: "/team", label: "Team", icon: UsersThree },
  { to: "/settings", label: "Settings", icon: Gear },
];

const salesmanLinks = [
  { to: "/estimates", label: "Estimates", icon: FileText },
  { to: "/sales-orders", label: "Sales Orders", icon: ClipboardText },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/commissions", label: "Commissions", icon: Percent },
  { to: "/time-clock", label: "Time Clock", icon: Timer },
];

const installerLinks = [
  { to: "/work-orders", label: "Work Orders", icon: Wrench },
  { to: "/time-clock", label: "Time Clock", icon: Timer },
];

export const Navigation = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isCustomer = user?.role === "customer";
  const links = isCustomer
    ? [{ to: "/portal", label: "My Orders", icon: ArrowsClockwise }]
    : user?.role === "admin"
    ? adminLinks
    : user?.role === "installer"
    ? installerLinks
    : salesmanLinks;

  const handleLogout = async () => {
    if (isCustomer) {
      navigate("/portal-login");
      await logout();
    } else {
      await logout();
      navigate("/login");
    }
  };

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col h-screen sticky top-0" data-testid="sidebar">
      <div className="px-6 py-6 border-b border-border">
        <img src={LOGO_URL} alt="DBG Signs, Inc." className="h-16 w-auto max-w-[260px] object-contain" data-testid="sidebar-logo" />
        <div className="overline text-muted-foreground mt-2">Image Is Everything</div>
      </div>

      {!isCustomer && (
        <div className="px-3 py-3 border-b border-border">
          <SearchBar />
        </div>
      )}

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
