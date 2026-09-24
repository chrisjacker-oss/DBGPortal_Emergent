import { NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
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
  Image,
  Gear,
  List,
  CaretLeft,
  CaretRight,
  SignOut,
  X,
} from "@phosphor-icons/react";

const adminLinks = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/reports", label: "Reports", icon: ChartBar },
  { to: "/estimates", label: "Estimates", icon: FileText },
  { to: "/sales-orders", label: "Sales Orders", icon: ClipboardText },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/artwork-proofs", label: "Artwork Proofs", icon: Image },
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
  { to: "/artwork-proofs", label: "Artwork Proofs", icon: Image },
  { to: "/install-calendar", label: "Install Calendar", icon: CalendarCheck },
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isCustomer = user?.role === "customer";
  const links = isCustomer
    ? [{ to: "/portal", label: "My Orders", icon: ArrowsClockwise }]
    : user?.role === "admin"
    ? adminLinks
    : user?.role === "installer"
    ? installerLinks
    : salesmanLinks;

  const handleLogout = async () => {
    setMobileOpen(false);
    if (isCustomer) {
      navigate("/portal-login");
      await logout();
    } else {
      await logout();
      navigate("/login");
    }
  };

  const linkBaseClass = "flex items-center gap-3 py-2.5 text-sm border-l-2 transition-colors";
  const activeLinkClass = "border-[#06B6D4] bg-secondary text-foreground font-medium";
  const inactiveLinkClass = [
    "border-transparent text-muted-foreground",
    "hover:text-foreground hover:bg-secondary/60",
  ].join(" ");
  const mobileHeaderClass = [
    "fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3",
    "border-b border-border bg-card px-4 text-left md:hidden",
  ].join(" ");
  const desktopSidebarClass = [
    "sticky top-0 hidden h-screen shrink-0 flex-col transition-[width] duration-200",
    collapsed ? "w-16" : "w-60",
    "border-r border-border bg-card md:flex",
  ].join(" ");
  const logoutClass = [
    "w-full flex items-center justify-center gap-2 text-sm py-2 border border-border",
    "hover:bg-foreground hover:text-primary-foreground transition-colors duration-150 rounded-none",
  ].join(" ");

  const linksNav = (mobile = false) => (
    <nav className="flex-1 py-4 overflow-y-auto">
      {links.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={() => mobile && setMobileOpen(false)}
          data-testid={`${mobile ? "mobile-" : ""}nav-${label.toLowerCase().replace(
            /\s/g,
            "-"
          )}`}
          title={!mobile && collapsed ? label : undefined}
          className={({ isActive }) => {
            const compact = !mobile && collapsed;
            return `${linkBaseClass} ${compact ? "justify-center px-2" : "px-6"} ${
              isActive ? activeLinkClass : inactiveLinkClass
            }`;
          }}
        >
          <Icon size={18} weight="bold" />
          {(mobile || !collapsed) && label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        data-testid="open-mobile-navigation-btn"
        className={mobileHeaderClass}
      >
        <List size={22} weight="bold" />
        <img
          src={LOGO_URL}
          alt="DBG Signs, Inc."
          className="h-8 w-auto max-w-[140px] object-contain"
        />
      </button>

      <aside
        className={desktopSidebarClass}
        data-testid="sidebar"
      >
        <div className={`${collapsed ? "px-2" : "px-6"} py-5 border-b border-border`}>
          <div
            className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}
          >
            <img
              src={LOGO_URL}
              alt="DBG Signs, Inc."
              className={
                collapsed ? "h-8 w-8 object-contain" : "h-16 w-auto max-w-[260px] object-contain"
              }
              data-testid="sidebar-logo"
            />
            {!collapsed && (
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                data-testid="collapse-sidebar-btn"
                aria-label="Collapse sidebar"
                className="p-2 text-muted-foreground hover:text-foreground"
              >
                <CaretLeft size={18} weight="bold" />
              </button>
            )}
          </div>
          {!collapsed && (
            <div className="overline text-muted-foreground mt-2">Image Is Everything</div>
          )}
          {collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              data-testid="expand-sidebar-btn"
              aria-label="Expand sidebar"
              className="mt-3 w-full p-2 text-muted-foreground hover:text-foreground"
            >
              <CaretRight size={18} weight="bold" />
            </button>
          )}
        </div>
        {!isCustomer && !collapsed && (
          <div className="px-3 py-3 border-b border-border">
            <SearchBar />
          </div>
        )}
        {linksNav()}
        <div className={`${collapsed ? "p-2" : "p-4"} border-t border-border`}>
          {!collapsed && <div className="mb-3">
            <div className="text-sm font-medium truncate">{user?.name}</div>
            <div className="overline text-muted-foreground mt-0.5">{user?.role}</div>
          </div>}
          <button
            onClick={handleLogout}
            data-testid="logout-btn"
            title={collapsed ? "Sign out" : undefined}
            className={logoutClass}
          >
            <SignOut size={16} weight="bold" /> {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden" data-testid="mobile-navigation-drawer">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            data-testid="close-mobile-navigation-backdrop"
            className="flex-1 bg-black/30"
          />
          <aside
            className={[
              "flex h-full w-72 max-w-[85vw] flex-col",
              "border-l border-border bg-card shadow-xl",
            ].join(" ")}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <img
                src={LOGO_URL}
                alt="DBG Signs, Inc."
                className="h-10 w-auto max-w-[170px] object-contain"
              />
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
                data-testid="close-mobile-navigation-btn"
                className="p-2 text-muted-foreground hover:text-foreground"
              >
                <X size={20} weight="bold" />
              </button>
            </div>
            {!isCustomer && (
              <div className="px-3 py-3 border-b border-border">
                <SearchBar />
              </div>
            )}
            {linksNav(true)}
            <div className="border-t border-border p-4">
              <div className="mb-3">
                <div className="text-sm font-medium truncate">{user?.name}</div>
                <div className="overline text-muted-foreground mt-0.5">{user?.role}</div>
              </div>
              <button
                onClick={handleLogout}
                data-testid="mobile-logout-btn"
                className={logoutClass}
              >
                <SignOut size={16} weight="bold" /> Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
