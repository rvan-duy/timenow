import { useState } from "react";
import { Archive, Plus, RotateCcw } from "lucide-react";
import { money } from "../lib/model";
import { useWorkspace } from "../lib/useWorkspace";
import { Field, Button, Modal } from "../components/ui";

export function Settings() {
  const { workspace, mutate, pending, notify } = useWorkspace();
  const [tab, setTab] = useState<"customers" | "projects">("customers");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [customer, setCustomer] = useState("acme");
  const [error, setError] = useState("");
  function show(id?: string) {
    const existing = id ? workspace[tab].find((item) => item.id === id) : undefined;
    setEditing(id);
    setName(existing?.name || "");
    setRate(existing?.rate?.toString() || "");
    setCustomer(
      (tab === "projects" && id
        ? workspace.projects.find((p) => p.id === id)?.customerId
        : workspace.customers.find((c) => c.active)?.id) || "",
    );
    setError("");
    setOpen(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const amount = rate.trim() === "" ? null : Number(rate);
    if (
      !name.trim() ||
      (amount !== null && (!Number.isFinite(amount) || amount < 0))
    ) {
      setError("Enter a name and a valid non-negative hourly rate.");
      return;
    }
    if (tab === "projects" && !customer) {
      setError("Add an active customer first.");
      return;
    }
    try {
      await mutate(editing ? "PATCH" : "POST", `/${tab}${editing ? `/${editing}` : ""}`, {
        name: name.trim(), rate: amount,
        ...(tab === "projects" ? { customerId: customer } : {}),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the record.");
      return;
    }
    setOpen(false);
    notify(`${tab === "customers" ? "Customer" : "Project"} saved`);
  }
  async function toggle(id: string) {
    const item = workspace[tab].find((item) => item.id === id)!;
    try {
      await mutate("PATCH", `/${tab}/${id}`, { active: !item.active });
      notify(`${item.name} ${item.active ? "archived" : "restored"}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save the record.");
    }
  }
  return (
    <>
      <div className="settings-toolbar">
        <div className="local-tabs" aria-label="Settings section">
          {(["customers", "projects"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === tab}
              onClick={() => setTab(t)}
            >
              {t === "customers" ? "Customers" : "Projects"}
              <span>{workspace[t].length}</span>
            </button>
          ))}
        </div>
        <Button onClick={() => show()}>
          <Plus size={16} />
          Add {tab === "customers" ? "customer" : "project"}
        </Button>
      </div>
      <div className="settings-list">
        {workspace[tab].map((item) => (
          <div
            className={`settings-row ${!item.active ? "archived" : ""}`}
            key={item.id}
          >
            <span className="customer-avatar blue">{item.name.charAt(0)}</span>
            <div className="settings-name">
              <strong>{item.name}</strong>
              <span>
                {"customerId" in item
                  ? workspace.customers.find((c) => c.id === item.customerId)?.name
                  : "EUR · Customer"}
                {!item.active ? " · Archived" : ""}
              </span>
            </div>
            <span className="settings-rate">
              {item.rate === null
                ? tab === "projects"
                  ? "Customer rate"
                  : "Rate missing"
                : `${money(item.rate)} / h`}
            </span>
            <Button secondary onClick={() => show(item.id)}>
              Edit
            </Button>
            <button
              className="icon-button"
              type="button"
              disabled={pending}
              onClick={() => toggle(item.id)}
              aria-label={`${item.active ? "Archive" : "Restore"} ${item.name}`}
            >
              {item.active ? <Archive size={17} /> : <RotateCcw size={17} />}
            </button>
          </div>
        ))}
      </div>
      <p className="history-note">
        Archive customers and projects to keep their time records intact.
      </p>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${editing ? "Edit" : "Add"} ${tab === "customers" ? "customer" : "project"}`}
      >
        <form className="settings-form" onSubmit={save}>
          <Field
            id="setting-name"
            label="Name"
            value={name}
            onChange={setName}
            placeholder={tab === "customers" ? "Customer name" : "Project name"}
            required
          />
          {tab === "projects" && (
            <Field
              id="setting-customer"
              label="Customer"
              value={customer}
              onChange={setCustomer}
              options={workspace.customers
                .filter((c) => editing ? c.id === customer : c.active)
                .map((c) => ({ value: c.id, label: c.name }))}
              required
            />
          )}
          <Field
            id="setting-rate"
            label={
              tab === "customers"
                ? "Default hourly rate (EUR)"
                : "Hourly rate override (EUR)"
            }
            value={rate}
            onChange={setRate}
            placeholder={
              tab === "projects"
                ? "Leave empty to use customer rate"
                : "e.g. 125"
            }
            type="number"
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button secondary onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save {tab === "customers" ? "customer" : "project"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
