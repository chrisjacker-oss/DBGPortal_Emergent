import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { IdleWarning } from "@/components/IdleWarning";

const AuthContext = createContext(null);

const WARN_MS = 60 * 1000; // show a warning 1 minute before sign-out

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=checking, false=anon, obj=auth
  const [warnOpen, setWarnOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const warnRef = useRef(null);
  const finalRef = useRef(null);
  const cdRef = useRef(null);
  const lastReset = useRef(0);
  const warnOpenRef = useRef(false);
  const resetRef = useRef(null);

  useEffect(() => {
    api
      .get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setUser(false));
  }, []);

  const idleLogout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* cookie may already be gone */ }
    try { sessionStorage.setItem("idle_logout", "1"); } catch { /* ignore */ }
    setUser(false);
  }, []);

  const setWarn = useCallback((v) => { warnOpenRef.current = v; setWarnOpen(v); }, []);

  // Sign the user out automatically after N minutes of inactivity, warning 1 min before.
  useEffect(() => {
    if (!user) return; // only track while authenticated
    const limitMs = Math.max(2, Number(user.idle_timeout_min) || 90) * 60 * 1000;
    const warnAt = Math.max(limitMs - WARN_MS, 3000);

    const startWarning = () => {
      setWarn(true);
      let left = 60;
      setSecondsLeft(left);
      cdRef.current = setInterval(() => {
        left -= 1;
        setSecondsLeft(left >= 0 ? left : 0);
        if (left <= 0) clearInterval(cdRef.current);
      }, 1000);
      finalRef.current = setTimeout(() => { clearInterval(cdRef.current); idleLogout(); }, WARN_MS);
    };
    const reset = () => {
      clearTimeout(warnRef.current);
      clearTimeout(finalRef.current);
      clearInterval(cdRef.current);
      setWarn(false);
      warnRef.current = setTimeout(startWarning, warnAt);
    };
    resetRef.current = reset;
    const onActivity = () => {
      if (warnOpenRef.current) return; // while warning is up, only the button dismisses it
      const now = Date.now();
      if (now - lastReset.current < 1000) return; // throttle
      lastReset.current = now;
      reset();
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click", "wheel"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    reset();
    return () => {
      clearTimeout(warnRef.current);
      clearTimeout(finalRef.current);
      clearInterval(cdRef.current);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [user, idleLogout, setWarn]);

  const stayActive = useCallback(async () => {
    try { await api.post("/auth/refresh"); } catch { /* ignore */ }
    if (resetRef.current) resetRef.current();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
    return data;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    setUser(data);
    return data;
  };

  const changePassword = async (current_password, new_password) => {
    await api.post("/auth/change-password", { current_password, new_password });
    setUser((u) => (u ? { ...u, must_change_password: false } : u));
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, register, changePassword, logout, idleWarnOpen: warnOpen, idleSecondsLeft: secondsLeft, stayActive }}>
      {children}
      <IdleWarning />
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
