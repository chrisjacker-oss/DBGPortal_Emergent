import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/lib/api";
import { toast } from "sonner";
import { ShieldCheck } from "@phosphor-icons/react";

const LOGO_URL = `${process.env.REACT_APP_BACKEND_URL}/api/pub/logo`;

export default function ForcePasswordChange() {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (next.length < 6) { setError("New password must be at least 6 characters."); return; }
    if (next !== confirm) { setError("New passwords don't match."); return; }
    setLoading(true);
    try {
      await changePassword(current, next);
      toast.success("Password updated — welcome aboard!");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6" data-testid="force-password-change">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-10">
          <img src={LOGO_URL} alt="DBG Signs, Inc." className="h-11 w-auto max-w-[200px] object-contain" />
        </div>
        <div className="flex items-center gap-2 overline text-[#0E7490] mb-2">
          <ShieldCheck size={16} weight="bold" /> Security · First sign-in
        </div>
        <h1 className="font-display font-bold tracking-tight text-3xl mb-2 leading-none">Set a new password</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Welcome, {user?.name}. For your security, please replace the temporary password you were emailed before you continue.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Temporary password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} testid="fpc-current" required />
          <Field label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} testid="fpc-new" required />
          <Field label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} testid="fpc-confirm" required />

          {error && (
            <div className="text-sm text-destructive border border-destructive/40 bg-destructive/5 px-3 py-2" data-testid="fpc-error">{error}</div>
          )}

          <button type="submit" disabled={loading} data-testid="fpc-submit"
            className="w-full bg-foreground text-primary-foreground py-3 text-sm font-medium hover:bg-foreground/90 transition-colors duration-150 rounded-none disabled:opacity-50">
            {loading ? "Saving…" : "Update password & continue"}
          </button>
        </form>

        <button onClick={logout} data-testid="fpc-logout"
          className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150">
          Sign out instead →
        </button>
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
