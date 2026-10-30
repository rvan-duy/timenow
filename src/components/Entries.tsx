import { useState } from "react";
import { Inbox, LockKeyhole, Pencil } from "lucide-react";
import { duration, projectLabel, shortDate, TODAY } from "../lib/model";
import type { Entry } from "../lib/model";
import { useWorkspace } from "../lib/useWorkspace";
import { Modal } from "./ui";
import { TimeForm } from "./TimeForm";

export function EntryEditor({
  entry,
  close,
}: {
  entry?: Entry;
  close: () => void;
}) {
  const { workspace } = useWorkspace();
  return (
    <Modal
      open={!!entry}
      onClose={close}
      title={entry?.status === "unbilled" ? "Edit time entry" : "Time entry"}
    >
      {entry &&
        (entry.status === "unbilled" ? (
          <TimeForm key={entry.id} entry={entry} onDone={close} />
        ) : (
          <div className="record-detail">
            <p>{entry.description}</p>
            <dl>
              <dt>Project</dt>
              <dd>{projectLabel(workspace, entry.projectId)}</dd>
              <dt>Duration</dt>
              <dd>{duration(entry.minutes)}</dd>
              <dt>Date</dt>
              <dd>{shortDate(entry.date)}</dd>
              <dt>Status</dt>
              <dd>{entry.status}</dd>
              {entry.invoice && (
                <>
                  <dt>Invoice</dt>
                  <dd>{entry.invoice}</dd>
                </>
              )}
              <dt>Created by</dt>
              <dd>{entry.actor}</dd>
            </dl>
            <p className="muted">
              This historical record is preserved and read-only.
            </p>
          </div>
        ))}
    </Modal>
  );
}
export function EntryRow({
  entry,
  showDate = false,
  onEdit,
}: {
  entry: Entry;
  showDate?: boolean;
  onEdit: (entry: Entry) => void;
}) {
  const { workspace } = useWorkspace();
  const p = workspace.projects.find((p) => p.id === entry.projectId);
  const customer = workspace.customers.find((c) => c.id === p?.customerId);
  const color =
    customer?.id === "foo"
      ? "rose"
      : customer?.id === "northstar"
        ? "sand"
        : "blue";
  return (
    <div className={`entry-row ${entry.status === "void" ? "is-void" : ""}`}>
      <span className={`customer-avatar ${color}`} aria-hidden="true">
        {customer?.name.charAt(0)}
      </span>
      <div className="entry-description">
        <strong>{entry.description}</strong>
        <span>
          {showDate && `${shortDate(entry.date)} · `}
          {projectLabel(workspace, entry.projectId)}
        </span>
      </div>
      <span className="entry-duration">{duration(entry.minutes)}</span>
      <span className={`entry-status status-${entry.status}`}>
        <i />
        {entry.status === "unbilled"
          ? "Unbilled"
          : entry.status === "billed"
            ? "Billed"
            : "Void"}
      </span>
      <button
        className="icon-button edit-entry"
        type="button"
        aria-label={`${entry.status === "unbilled" ? "Edit" : "View"} ${entry.description}`}
        onClick={() => onEdit(entry)}
      >
        {entry.status === "unbilled" ? (
          <Pencil size={16} />
        ) : (
          <LockKeyhole size={15} />
        )}
      </button>
    </div>
  );
}
export function Entries() {
  const { workspace } = useWorkspace();
  const [scope, setScope] = useState("today");
  const [editing, setEditing] = useState<Entry>();
  const entries = workspace.entries
    .filter(
      (e) =>
        scope === "all" ||
        (scope === "today" && e.date === TODAY) ||
        (scope === "recent" && e.status === "unbilled"),
    )
    .toSorted((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="entries-section" aria-labelledby="entries-title">
      <div className="section-heading">
        <h2 id="entries-title">Your entries</h2>
        <select
          className="scope-select"
          aria-label="Entry period"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="today">Today</option>
          <option value="recent">Unbilled</option>
          <option value="all">All entries</option>
        </select>
      </div>
      <div className="ledger-head" aria-hidden="true">
        <span>Description / project</span>
        <span>Duration</span>
        <span>Status</span>
        <span />
      </div>
      <div className="entries-list">
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            showDate={scope !== "today"}
            onEdit={setEditing}
          />
        ))}
      </div>
      {!entries.length && (
        <div className="empty-state">
          <Inbox size={25} />
          <h3>A fresh page</h3>
          <p>Add your first entry for today.</p>
        </div>
      )}
      <EntryEditor entry={editing} close={() => setEditing(undefined)} />
    </section>
  );
}
