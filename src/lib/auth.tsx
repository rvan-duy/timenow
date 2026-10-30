import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Login } from "../pages/Login";

type Identity = { actor: string; kind: "human" | "agent" };
type AuthState = {
  identity: Identity;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
export async function authRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/auth/${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Too many attempts. Please wait a minute and try again.");
    if (response.status >= 500) throw new Error("Sign-in service unavailable. Please try again shortly.");
    throw new Error(path === "sign-out" ? "Could not sign out. Please try again." : "Username or password is incorrect.");
  }
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function refresh(signal?: AbortSignal) {
    try {
      const response = await fetch("/api/me", { signal });
      if (response.status === 401) { setIdentity(null); setError(""); return; }
      if (!response.ok) throw new Error("Could not load your account. Please retry.");
      setIdentity(await response.json());
      setError("");
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : "Could not connect.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const expired = () => { setIdentity(null); setError(""); };
    window.addEventListener("timenow:unauthorized", expired);
    return () => { controller.abort(); window.removeEventListener("timenow:unauthorized", expired); };
  }, []);
  async function signIn(username: string, password: string) {
    await authRequest("sign-in/username", { username, password, rememberMe: true });
    await refresh();
  }
  async function signOut() {
    await authRequest("sign-out", {});
    setIdentity(null);
  }
  if (loading) return <main className="connection-state" role="status">Loading your account…</main>;
  if (error) return <main className="connection-state"><h1>timenow</h1><p role="alert">{error}</p><button onClick={() => void refresh()}>Retry connection</button></main>;
  if (!identity) return <Login onSignIn={signIn} />;
  return <AuthContext.Provider value={{ identity, signOut }}>{children}</AuthContext.Provider>;
}
