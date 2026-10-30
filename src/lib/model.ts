export type Page = "today" | "unbilled" | "history" | "settings";
export type Customer = {
  id: string;
  name: string;
  rate: number | null;
  active: boolean;
};
export type Project = {
  id: string;
  customerId: string;
  name: string;
  rate: number | null;
  active: boolean;
};
export type Entry = {
  id: string;
  projectId: string;
  date: string;
  minutes: number;
  description: string;
  status: "unbilled" | "billed" | "void";
  actor: string;
  invoice?: string;
  billingBatchId?: string;
  version: number;
};
export type Audit = {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
  customerId?: string;
  projectId?: string;
};
export type WorkspaceData = {
  customers: Customer[];
  projects: Project[];
  entries: Entry[];
  history: Audit[];
};

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const TODAY = localDate();
export function parseDuration(input: string): number | null {
  const value = input.trim().toLowerCase().replace(/\s+/g, "");
  let minutes: number;
  if (/^\d+m?$/.test(value)) minutes = Number.parseInt(value);
  else {
    const match = /^(\d+)h(?:(\d{1,2})m?)?$/.exec(value);
    if (!match || (match[2] && Number(match[2]) >= 60)) return null;
    minutes = Number(match[1]) * 60 + Number(match[2] || 0);
  }
  return Number.isSafeInteger(minutes) && minutes > 0 && minutes <= 1440
    ? minutes
    : null;
}
export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${String(m).padStart(2, "0")}m` : " 00m"}` : `${m}m`;
}
export const money = (amount: number) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
export const longDate = new Date(`${TODAY}T12:00:00`).toLocaleDateString(
  "en-GB",
  { weekday: "long", day: "numeric", month: "long", year: "numeric" },
);
export function effectiveRate(workspace: WorkspaceData, entry: Entry) {
  const project = workspace.projects.find((p) => p.id === entry.projectId);
  return (
    project?.rate ??
    workspace.customers.find((c) => c.id === project?.customerId)?.rate ??
    null
  );
}
export function projectLabel(workspace: WorkspaceData, projectId: string) {
  const p = workspace.projects.find((p) => p.id === projectId);
  return `${workspace.customers.find((c) => c.id === p?.customerId)?.name ?? "Unknown"} / ${p?.name ?? "Unknown"}`;
}
