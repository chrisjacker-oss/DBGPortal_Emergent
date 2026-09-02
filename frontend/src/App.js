import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Customers from "@/pages/Customers";
import Materials from "@/pages/Materials";
import Estimates from "@/pages/Estimates";
import SalesOrders from "@/pages/SalesOrders";
import Invoices from "@/pages/Invoices";
import Payables from "@/pages/Payables";
import Receivables from "@/pages/Receivables";
import Reorders from "@/pages/Reorders";
import Commissions from "@/pages/Commissions";
import Team from "@/pages/Team";
import Settings from "@/pages/Settings";
import Portal from "@/pages/Portal";
import PortalAccounts from "@/pages/PortalAccounts";

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="overline text-muted-foreground animate-pulse">Loading workspace…</div>
    </div>
  );
}

function Protected({ children, staffOnly, adminOnly }) {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (user === false) return <Navigate to="/login" replace />;
  if (user.role === "customer" && (staffOnly || adminOnly)) return <Navigate to="/portal" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function Root() {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (user === false) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "customer" ? "/portal" : "/dashboard"} replace />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <Toaster position="top-right" richColors />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login variant="staff" />} />
            <Route path="/portal-login" element={<Login variant="customer" />} />
            <Route path="/" element={<Root />} />
            <Route
              path="/portal"
              element={
                <Protected>
                  <Layout>
                    <Portal />
                  </Layout>
                </Protected>
              }
            />
            {[
              ["/dashboard", <Dashboard />, false],
              ["/customers", <Customers />, false],
              ["/portal-accounts", <PortalAccounts />, true],
              ["/materials", <Materials />, true],
              ["/estimates", <Estimates />, false],
              ["/sales-orders", <SalesOrders />, false],
              ["/invoices", <Invoices />, false],
              ["/payables", <Payables />, true],
              ["/receivables", <Receivables />, false],
              ["/reorders", <Reorders />, true],
              ["/commissions", <Commissions />, false],
              ["/team", <Team />, true],
              ["/settings", <Settings />, true],
            ].map(([path, el, adminOnly]) => (
              <Route
                key={path}
                path={path}
                element={
                  <Protected staffOnly adminOnly={adminOnly}>
                    <Layout>{el}</Layout>
                  </Protected>
                }
              />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
