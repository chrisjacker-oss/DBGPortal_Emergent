import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

const IDLE_LIMIT_MS = 90 * 60 * 1000; // auto sign-out after 90 minutes of inactivity

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=checking, false=anon, obj=auth
  const idleTimer = useRef(null);
  const lastReset = useRef(0);

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

  // Sign the user out automatically after 90 minutes with no activity.
  useEffect(() => {
    if (!user) return; // only track while authenticated
    const reset = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(idleLogout, IDLE_LIMIT_MS);
    };
    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset.current < 1000) return; // throttle
      lastReset.current = now;
      reset();
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click", "wheel"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    reset();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [user, idleLogout]);

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
    <AuthContext.Provider value={{ user, setUser, login, register, changePassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
