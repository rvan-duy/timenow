import { useId, useState } from "react";
import { Check, CornerDownLeft } from "lucide-react";
import { useWorkspace } from "../lib/useWorkspace";
import {
  duration,
  parseDuration,
  projectLabel,
  TODAY,
} from "../lib/model";
import type { Entry } from "../lib/model";
import { Field, Button } from "./ui";

function rememberedProject() {
  try {
    return sessionStorage.getItem("timenow-last-project") || "platform";
  } catch {
    return "platform";
  }
}
export function TimeForm({
  entry,
  onDone,
}: {
  entry?: Entry;
  onDone?: () => void;
}) {
  const { workspace, mutate, pending, notify } = useWorkspace();
  const prefix = useId();
  const [project, setProject] = useState(entry?.projectId || rememberedProject);
  const [date, setDate] = useState(entry?.date || TODAY);
  const [time, setTime] = useState(entry ? duration(entry.minutes) : "");
  const [description, setDescription] = useState(entry?.description || "");
  const [error, setError] = useState("");
  const active = workspace.projects.filter(
    (p) =>
      p.id === entry?.projectId ||
      (p.active &&
        workspace.customers.some((c) => c.id === p.customerId && c.active)),
  );
  const projectId = active.some((p) => p.id === project)
    ? project
    : active[0]?.id || "";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const minutes = parseDuration(time);
    if (!minutes) {
      setError("Use 30m, 1h or 1h30. Maximum 24 hours per entry.");
      return;
    }
    if (!projectId || !date || !description.trim()) {
      setError("Choose a project, date and description.");
      return;
    }
    try {
      await mutate(entry ? "PATCH" : "POST", entry ? `/time-entries/${entry.id}` : "/time-entries", {
        projectId, date, minutes, description: description.trim(),
        ...(entry ? { version: entry.version } : {}),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the entry.");
      return;
    }
    try {
      sessionStorage.setItem("timenow-last-project", projectId);
    } catch {
      /* Optional preference. */
    }
    setError("");
    setTime("");
    setDescription("");
    notify(
      entry
        ? "Entry updated"
        : `Saved ${duration(minutes)} to ${projectLabel(workspace, projectId)}`,
    );
    onDone?.();
  }
  async function voidEntry() {
    if (!entry) return;
    try {
      await mutate("POST", `/time-entries/${entry.id}/void`, { version: entry.version });
      notify("Entry voided. Its history is preserved.");
      onDone?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not void the entry.");
    }
  }
  return (
    <form
      className={`time-form ${entry ? "edit-form" : ""}`}
      onSubmit={submit}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
    >
      {!entry && <h2>Add time</h2>}
      <div className="form-fields">
        <div className="field-project">
          <Field
            id={`${prefix}-project`}
            label="Project"
            value={projectId}
            onChange={setProject}
            options={active.map((p) => ({
              value: p.id,
              label: projectLabel(workspace, p.id),
            }))}
            required
          />
        </div>
        <div className="field-date">
          <Field
            id={`${prefix}-date`}
            label="Date"
            type="date"
            value={date}
            onChange={setDate}
            required
          />
        </div>
        <div className="field-duration">
          <Field
            id={`${prefix}-duration`}
            label="Duration"
            value={time}
            onChange={(v) => {
              setTime(v);
              setError("");
            }}
            placeholder="e.g. 1h 30m"
            required
            error={error}
          />
          <div className="duration-shortcuts">
            {["30m", "1h", "2h"].map((value) => (
              <Button
                key={value}
                secondary
                onClick={() => {
                  setTime(value);
                  setError("");
                }}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>
        <div className="field-description">
          <Field
            id={`${prefix}-description`}
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="What did you work on?"
            multiline
            required
          />
        </div>
      </div>
      {!active.length && (
        <p className="form-error" role="alert">
          Add an active customer and project in Settings first.
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={pending || !active.length}>
          <Check size={16} />
          {pending ? "Saving…" : entry ? "Save changes" : "Save entry"}
        </Button>
        {entry && (
          <Button secondary disabled={pending} onClick={voidEntry}>
            Void entry
          </Button>
        )}
      </div>
      {!entry && (
        <span className="keyboard-hint">
          <CornerDownLeft size={12} /> Ctrl / ⌘ + Enter to save
        </span>
      )}
    </form>
  );
}
