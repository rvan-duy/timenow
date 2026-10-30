import { useState } from "react";
import { ArrowUpRight, CheckCheck, Inbox } from "lucide-react";
import { duration, effectiveRate, money, shortDate } from "../lib/model";
import type { Entry } from "../lib/model";
import { useWorkspace } from "../lib/useWorkspace";
import { Field, Button, Modal } from "../components/ui";
import { EntryEditor, EntryRow } from "../components/Entries";

export function Unbilled() {
  const { workspace, mutate, pending, notify } = useWorkspace();
  const [customer, setCustomer] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<Entry>();
  const [batch, setBatch] = useState<string[]>([]);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const entries = workspace.entries.filter(
    (e) =>
      e.status === "unbilled" &&
      (!from || e.date >= from) &&
      (!to || e.date <= to) &&
      (customer === "all" ||
        workspace.projects.some(
          (p) => p.id === e.projectId && p.customerId === customer,
        )),
  );
  const selected = workspace.entries.filter(
    (e) => batch.includes(e.id) && e.status === "unbilled",
  );
  const total = selected.reduce(
    (sum, e) => sum + (e.minutes / 60) * (effectiveRate(workspace, e) || 0),
    0,
  );
  async function finalize(event: React.FormEvent) {
    event.preventDefault();
    if (!selected.length) return;
    try {
      await mutate("POST", "/billing-batches", { entryIds: batch, externalInvoiceReference: reference.trim() });
      setBatch([]);
      setReference("");
      setError("");
      notify(`${selected.length} entries marked billed`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not mark entries billed.");
    }
  }
  return (
    <>
      <div className="filters">
        <Field
          id="billing-customer"
          label="Customer"
          value={customer}
          onChange={setCustomer}
          options={[
            { value: "all", label: "All customers" },
            ...workspace.customers.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Field
          id="billing-from"
          label="From"
          type="date"
          value={from}
          onChange={setFrom}
        />
        <Field
          id="billing-to"
          label="To"
          type="date"
          value={to}
          onChange={setTo}
        />
      </div>
      {from && to && from > to && (
        <p role="alert" className="form-error">
          The end date must be on or after the start date.
        </p>
      )}
      <div className="billing-groups">
        {workspace.customers.map((c) => {
          const grouped = entries.filter((e) =>
            workspace.projects.some(
              (p) => p.id === e.projectId && p.customerId === c.id,
            ),
          );
          if (!grouped.length) return null;
          const amount = grouped.reduce(
            (sum, e) => sum + (e.minutes / 60) * (effectiveRate(workspace, e) || 0),
            0,
          );
          return (
            <section className="billing-group" key={c.id}>
              <div className="billing-heading">
                <div>
                  <h2>{c.name}</h2>
                  <p>
                    {duration(grouped.reduce((sum, e) => sum + e.minutes, 0))}{" "}
                    <span>·</span> {money(amount)} <span>·</span>{" "}
                    {shortDate(grouped.map((e) => e.date).sort()[0])} –{" "}
                    {shortDate(
                      grouped
                        .map((e) => e.date)
                        .sort()
                        .at(-1)!,
                    )}
                  </p>
                </div>
                <Button
                  secondary
                  onClick={() => { setError(""); setBatch(grouped.map((e) => e.id)); }}
                >
                  Review batch <ArrowUpRight size={15} />
                </Button>
              </div>
              {workspace.projects
                .filter((p) => p.customerId === c.id)
                .map((p) => {
                  const items = grouped.filter((e) => e.projectId === p.id);
                  if (!items.length) return null;
                  return (
                    <div className="billing-project" key={p.id}>
                      <div className="project-heading">
                        <strong>{p.name}</strong>
                        <span>
                          {(p.rate ?? c.rate) === null
                            ? "Rate missing"
                            : `${money((p.rate ?? c.rate)!)} / hour`}
                        </span>
                      </div>
                      {items
                        .toSorted((a, b) => b.date.localeCompare(a.date))
                        .map((e) => (
                          <EntryRow
                            key={e.id}
                            entry={e}
                            onEdit={setEditing}
                            showDate
                          />
                        ))}
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>
      {!entries.length && (
        <div className="empty-state">
          <Inbox size={28} />
          <h3>All caught up</h3>
          <p>No unbilled entries match these filters.</p>
        </div>
      )}
      <EntryEditor entry={editing} close={() => setEditing(undefined)} />
      <Modal
        open={batch.length > 0}
        onClose={() => setBatch([])}
        title="Review billing batch"
      >
        <form className="batch-form" onSubmit={finalize}>
          <p className="muted">
            Record that these entries were invoiced in your other tool. Their history is preserved.
          </p>
          <div className="batch-total">
            <span>
              {selected.length} entries ·{" "}
              {duration(selected.reduce((sum, e) => sum + e.minutes, 0))}
            </span>
            <strong>{money(total)}</strong>
          </div>
          {selected.some((e) => effectiveRate(workspace, e) === null) && (
            <p className="form-error">
              Some rates are missing. The amount includes only entries with a
              rate.
            </p>
          )}
          <Field
            id="invoice-reference"
            label="Invoice reference (optional)"
            value={reference}
            onChange={setReference}
          />
          <p className="helper-text">
            WorkspaceData only. No invoice is sent or generated.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <Button secondary onClick={() => setBatch([])}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !selected.length}>
              <CheckCheck size={16} />
              {pending ? "Saving…" : "Mark billed"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
