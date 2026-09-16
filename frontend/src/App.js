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
import PurchaseOrders from "@/pages/PurchaseOrders";
import Team from "@/pages/Team";
import Settings from "@/pages/Settings";
import Portal from "@/pages/Portal";
import PortalAccounts from "@/pages/PortalAccounts";
import WorkOrders from "@/pages/WorkOrders";
import ForcePasswordChange from "@/pages/ForcePasswordChange";
import PublicPay from "@/pages/PublicPay";
import PublicApprove from "@/pages/PublicApprove";
import PublicProof from "@/pages/PublicProof";
import Proofs from "@/pages/Proofs";
import Reports from "@/pages/Reports";
import TimeClock from "@/pages/TimeClock";
import Installs from "@/pages/Installs";

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="overline text-muted-foreground animate-pulse">Loading workspace…</div>
    </div>
  );
}

const HOME = { admin: "/dashboard", salesman: "/estimates", installer: "/work-orders", customer: "/portal" };
const homeFor = (role) => HOME[role] || "/login";

function Protected({ children, roles }) {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (user === false) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <ForcePasswordChange />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function Root() {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (user === false) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
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
            <Route path="/pay/:token" element={<PublicPay />} />
            <Route path="/approve/:token" element={<PublicApprove />} />
            <Route path="/proof/:token" element={<PublicProof />} />
            <Route path="/" element={<Root />} />
            <Route
              path="/portal"
              element={
                <Protected roles={["customer"]}>
                  <Layout>
                    <Portal />
                  </Layout>
                </Protected>
              }
            />
            {(() => { const A = ["admin"], AS = ["admin", "salesman"], ASI = ["admin", "salesman", "installer"]; return [
              ["/dashboard", <Dashboard />, A],
              ["/reports", <Reports />, A],
              ["/customers", <Customers />, AS],
              ["/work-orders", <WorkOrders />, ["admin", "installer"]],
              ["/install-calendar", <Installs />, A],
              ["/time-clock", <TimeClock />, ASI],
              ["/portal-accounts", <PortalAccounts />, A],
              ["/materials", <Materials />, A],
              ["/estimates", <Estimates />, AS],
              ["/sales-orders", <SalesOrders />, AS],
              ["/invoices", <Invoices />, AS],
              ["/artwork-proofs", <Proofs />, AS],
              ["/payables", <Payables />, A],
              ["/receivables", <Receivables />, A],
              ["/reorders", <Reorders />, A],
              ["/commissions", <Commissions />, AS],
              ["/purchase-orders", <PurchaseOrders />, A],
              ["/team", <Team />, A],
              ["/settings", <Settings />, A],
            ]; })().map(([path, el, roles]) => (
              <Route
                key={path}
                path={path}
                element={
                  <Protected roles={roles}>
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
