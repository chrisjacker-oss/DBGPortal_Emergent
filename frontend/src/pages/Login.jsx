import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/lib/api";
import { toast } from "sonner";

const HERO =
  "https://images.unsplash.com/photo-1631660975301-b2b65e80c98a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1ODR8MHwxfHNlYXJjaHwzfHxEYWxsYXMlMjBUZXhhcyUyMHNreWxpbmV8ZW58MHx8fHwxNzg4MjkyNzg1fDA&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", company: "", phone: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u =
        mode === "login"
          ? await login(form.email, form.password)
          : await register(form);
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
      {/* Left form */}
      <div className="flex flex-col justify-center px-8 sm:px-16 py-12 max-w-xl w-full mx-auto">
        <div className="flex items-center gap-2 mb-12">
          <div className="h-8 w-8 bg-foreground flex items-center justify-center">
            <span className="text-primary-foreground font-mono font-bold text-xs">DBG</span>
          </div>
          <div className="font-display font-bold tracking-tight text-lg">DBG Signs, Inc.</div>
        </div>

        <div className="overline text-muted-foreground">{mode === "login" ? "Sign in" : "Create account"}</div>
        <h1 className="font-display font-bold tracking-tight text-4xl mt-2 mb-8 leading-none">
          {mode === "login" ? "Image Is Everything" : "Join the portal."}
        </h1>

        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && (
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

          <button
            type="submit"
            disabled={loading}
            data-testid="login-submit"
            className="w-full bg-foreground text-primary-foreground py-3 text-sm font-medium hover:bg-foreground/90 transition-colors duration-150 rounded-none disabled:opacity-50"
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
          data-testid="toggle-mode"
          className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
        >
          {mode === "login" ? "New customer? Create a portal account →" : "Already have an account? Sign in →"}
        </button>
      </div>

      {/* Right hero */}
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
      <input
        {...props}
        data-testid={testid}
        className="mt-1.5 w-full border border-input bg-card px-3 py-2.5 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
