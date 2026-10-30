import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspaceData } from "./model";
import { WorkspaceContext } from "./useWorkspace";

async function request(path: string, options?: RequestInit) {
  let response: Response;
  try { response = await fetch(`/api${path}`, options); }
  catch { throw new Error("Cannot reach the server. Check the connection and reload before retrying."); }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event("timenow:unauthorized"));
  if (!response.ok) throw new Error(data.error || "The server could not complete the request.");
  return data;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    request("/workspace", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setData(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);
  async function mutate(method: "POST" | "PATCH", path: string, data: unknown) {
    if (saving.current) throw new Error("A change is already being saved.");
    saving.current = true;
    setPending(true);
    try {
      await request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      try { setData(await request("/workspace")); }
      catch { setError("Your change was saved, but the workspace could not refresh. Reload to see the latest records."); }
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  if (error || !workspace) return (
    <main className="connection-state" aria-live="polite">
      <h1>timenow</h1>
      {error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry connection</button></> : <p>Loading your workspace…</p>}
    </main>
  );
  return (
    <WorkspaceContext.Provider value={{ workspace, pending, mutate, notify: setMessage }}>
      {children}
      <div className={`toast ${message ? "visible" : ""}`} role="status" aria-live="polite">{message}</div>
    </WorkspaceContext.Provider>
  );
}
