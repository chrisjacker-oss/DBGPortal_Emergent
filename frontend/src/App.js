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
import Invoices from "@/pages/Invoices";
import Payables from "@/pages/Payables";
import Receivables from "@/pages/Receivables";
import Reorders from "@/pages/Reorders";
import Portal from "@/pages/Portal";

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="overline text-muted-foreground animate-pulse">Loading workspace…</div>
    </div>
  );
}

function Protected({ children, staffOnly }) {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (user === false) return <Navigate to="/login" replace />;
  if (user.role === "customer" && staffOnly) return <Navigate to="/portal" replace />;
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
            <Route path="/login" element={<Login />} />
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
              ["/dashboard", <Dashboard />],
              ["/customers", <Customers />],
              ["/materials", <Materials />],
              ["/estimates", <Estimates />],
              ["/invoices", <Invoices />],
              ["/payables", <Payables />],
              ["/receivables", <Receivables />],
              ["/reorders", <Reorders />],
            ].map(([path, el]) => (
              <Route
                key={path}
                path={path}
                element={
                  <Protected staffOnly>
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
