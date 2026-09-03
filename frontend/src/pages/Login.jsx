import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/lib/api";
import { toast } from "sonner";

const HERO =
  "https://images.unsplash.com/photo-1631660975301-b2b65e80c98a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1ODR8MHwxfHNlYXJjaHwzfHxEYWxsYXMlMjBUZXhhcyUyMHNreWxpbmV8ZW58MHx8fHwxNzg4MjkyNzg1fDA&ixlib=rb-4.1.0&q=85";

const LOGO_URL = `${process.env.REACT_APP_BACKEND_URL}/api/pub/logo`;

export default function Login({ variant = "staff" }) {
  const isCustomer = variant === "customer";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login"); // login | register (customer only)
  const [form, setForm] = useState({ email: "", password: "", name: "", company: "", phone: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u = mode === "register" ? await register(form) : await login(form.email, form.password);
      toast.success(`Welcome, ${u.name}`);
      navigate(u.role === "customer" ? "/portal" : "/dashboard");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="flex flex-col justify-center px-8 sm:px-16 py-12 max-w-xl w-full mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <img src={LOGO_URL} alt="DBG Signs, Inc." className="h-64 w-auto max-w-[560px] object-contain" data-testid="login-logo" />
        </div>

        <div className="overline text-muted-foreground" data-testid="login-variant-label">
          {isCustomer ? "Customer Portal" : "Staff Access"}
        </div>
        <h1 className="font-display font-bold tracking-tight text-4xl mt-2 mb-2 leading-none">
          {isCustomer ? (mode === "register" ? "Create your account" : "Image Is Everything") : "Shop Console"}
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          {isCustomer ? "Track your orders and request reorders." : "Admin & sales team sign in."}
        </p>

        <form onSubmit={submit} className="space-y-4">
          {isCustomer && mode === "register" && (
            <>
              <Field label="Full name" value={form.name} onChange={set("name")} testid="reg-name" required />
              <Field label="Company" value={form.company} onChange={set("company")} testid="reg-company" />
              <Field label="Phone" value={form.phone} onChange={set("phone")} testid="reg-phone" />
            </>
          )}
          <Field label="Email" type="email" value={form.email} onChange={set("email")} testid="login-email" required />
          <Field label="Password" type="password" value={form.password} onChange={set("password")} testid="login-password" required />

          {error && (
            <div className="text-sm text-destructive border border-destructive/40 bg-destructive/5 px-3 py-2" data-testid="login-error">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} data-testid="login-submit"
            className="w-full bg-foreground text-primary-foreground py-3 text-sm font-medium hover:bg-foreground/90 transition-colors duration-150 rounded-none disabled:opacity-50">
            {loading ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>

        {isCustomer && (
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} data-testid="toggle-mode"
            className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150">
            {mode === "login" ? "New customer? Create a portal account →" : "Already have an account? Sign in →"}
          </button>
        )}

        <div className="mt-10 pt-6 border-t border-border text-sm">
          {isCustomer ? (
            <Link to="/login" data-testid="go-staff-login" className="text-muted-foreground hover:text-foreground transition-colors duration-150">Staff member? Sign in to the console →</Link>
          ) : (
            <Link to="/portal-login" data-testid="go-customer-login" className="text-muted-foreground hover:text-foreground transition-colors duration-150">Are you a customer? Go to the portal →</Link>
          )}
        </div>
      </div>

      <div className="hidden lg:block relative border-l border-border">
        <img src={HERO} alt="Dallas, Texas skyline" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-foreground/40" />
      </div>
    </div>
  );
}

function Field({ label, testid, ...props }) {
  return (
    <label className="block">
      <span className="overline text-muted-foreground">{label}</span>
      <input {...props} data-testid={testid}
        className="mt-1.5 w-full border border-input bg-card px-3 py-2.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
    </label>
  );
}
