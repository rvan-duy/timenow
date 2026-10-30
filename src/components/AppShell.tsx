import {
  CalendarDays,
  Clock3,
  FileText,
  History,
  Settings2,
  LogOut,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import type { Page } from "../lib/model";
import { duration, effectiveRate, longDate, money, TODAY } from "../lib/model";
import { useWorkspace } from "../lib/useWorkspace";
import { TimeForm } from "./TimeForm";
import { Entries } from "./Entries";
import { Unbilled } from "../pages/Unbilled";
import { History as HistoryPage } from "../pages/History";
import { Settings } from "../pages/Settings";

const navigation = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "unbilled", label: "Unbilled", icon: FileText },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
function Summary() {
  const { workspace } = useWorkspace();
  const todayMinutes = workspace.entries
    .filter((e) => e.date === TODAY && e.status !== "void")
    .reduce((sum, e) => sum + e.minutes, 0);
  const start = new Date(`${TODAY}T12:00:00`);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weekMinutes = workspace.entries
    .filter(
      (e) =>
        e.status !== "void" &&
        new Date(`${e.date}T12:00:00`) >= start &&
        e.date <= TODAY,
    )
    .reduce((sum, e) => sum + e.minutes, 0);
  const unbilled = workspace.entries.filter((e) => e.status === "unbilled");
  const amount = unbilled.reduce(
    (sum, e) => sum + (e.minutes / 60) * (effectiveRate(workspace, e) ?? 0),
    0,
  );
  return (
    <div className="summary" aria-label="Time overview">
      <div>
        <strong>{duration(todayMinutes)}</strong>
        <span>Time today</span>
      </div>
      <div>
        <strong>{duration(weekMinutes)}</strong>
        <span>This week</span>
      </div>
      <div>
        <strong>{money(amount)}</strong>
        <span>
          Unbilled
          {unbilled.some((e) => effectiveRate(workspace, e) === null)
            ? " · rates missing"
            : ""}
        </span>
      </div>
    </div>
  );
}
export function AppShell({ page }: { page: Page }) {
  const { signOut } = useAuth();
  const { notify } = useWorkspace();
  const [signingOut, setSigningOut] = useState(false);
  async function logout() {
    setSigningOut(true);
    try { await signOut(); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not sign out."); }
    finally { setSigningOut(false); }
  }
  const title = navigation.find((n) => n.id === page)!.label;
  const subtitle = {
    today: longDate,
    unbilled: "Review your work, ready for invoicing.",
    history: "Every entry. Every change. Always preserved.",
    settings: "A small workspace, set up your way.",
  }[page];
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#/today" aria-label="timenow home">
          <Clock3 size={29} strokeWidth={2.2} />
          <span>timenow</span>
        </a>
        <nav className="app-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              href={`#/${id}`}
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="profile">
          <span className="profile-avatar">R</span>
          <div>
            <strong>Ruben</strong>
            <span>Personal workspace</span>
          </div>
          <button className="icon-button sign-out" type="button" aria-label="Sign out" title="Sign out" disabled={signingOut} onClick={() => void logout()}><LogOut size={18} /></button>
        </div>
      </header>
      <main
        className={`main-content page-${page}`}
        id="main-content"
        tabIndex={-1}
      >
        <div className="page-top">
          <div className="page-heading">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {page === "today" && <Summary />}
        </div>
        {page === "today" ? (
          <div className="today-layout">
            <section className="compose-panel" aria-label="Add a time entry">
              <TimeForm />
            </section>
            <Entries />
          </div>
        ) : (
          <div className="secondary-content">
            {page === "unbilled" ? (
              <Unbilled />
            ) : page === "history" ? (
              <HistoryPage />
            ) : (
              <Settings />
            )}
          </div>
        )}
        <footer className="app-footer">
          <span className="sample-dot" />
          Your workspace <span>·</span> Saved to PostgreSQL.
        </footer>
      </main>
    </div>
  );
}
