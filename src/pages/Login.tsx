import { useEffect, useState } from "react";
import { Clock3, LogIn } from "lucide-react";
import { Field, Button } from "../components/ui";

export function Login({ onSignIn }: { onSignIn: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("ruben");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { document.title = "timenow · Sign in"; }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try { await onSignIn(username.trim(), password); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not sign in. Please try again."); }
    finally { setPending(false); }
  }
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand"><Clock3 size={29} /><span>timenow</span></div>
        <h1 id="login-title">Welcome back</h1>
        <p className="muted">Sign in to your time-tracking workspace.</p>
        <form onSubmit={submit} className="login-form">
          <Field id="login-username" label="Username" value={username} onChange={setUsername} autoComplete="username" required />
          <Field id="login-password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" disabled={pending}><LogIn size={16} />{pending ? "Signing in…" : "Sign in"}</Button>
        </form>
      </section>
    </main>
  );
}
