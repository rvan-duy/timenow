import { useState } from "react";
import {
  Bot,
  CheckCheck,
  CirclePlus,
  History as HistoryIcon,
  Pencil,
  UserRound,
} from "lucide-react";
import { shortDate } from "../lib/model";
import { useWorkspace } from "../lib/useWorkspace";
import { Field } from "../components/ui";

export function History() {
  const { workspace } = useWorkspace();
  const [actor, setActor] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [from, setFrom] = useState("");
  const events = workspace.history.filter(
    (e) =>
      (actor === "all" || e.actor === actor) &&
      (customer === "all" || e.customerId === customer) &&
      (!from || e.at.slice(0, 10) >= from),
  );
  return (
    <>
      <div className="filters">
        <Field
          id="history-actor"
          label="Actor"
          value={actor}
          onChange={setActor}
          options={[
            { value: "all", label: "Everyone" },
            ...Array.from(new Set(workspace.history.map((e) => e.actor))).map(
              (a) => ({ value: a, label: a }),
            ),
          ]}
        />
        <Field
          id="history-customer"
          label="Customer"
          value={customer}
          onChange={setCustomer}
          options={[
            { value: "all", label: "All customers" },
            ...workspace.customers.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Field
          id="history-from"
          label="From"
          type="date"
          value={from}
          onChange={setFrom}
        />
      </div>
      <div className="audit-list">
        {events.map((event) => {
          const Icon = event.action.startsWith("Created")
            ? CirclePlus
            : event.action.startsWith("Finalized")
              ? CheckCheck
              : Pencil;
          return (
            <article className="audit-event" key={event.id}>
              <span className="audit-icon">
                <Icon size={18} />
              </span>
              <div className="audit-content">
                <h3>{event.action}</h3>
                <p>{event.detail}</p>
                <span className="audit-actor">
                  {event.actor.includes("agent") ? (
                    <Bot size={13} />
                  ) : (
                    <UserRound size={13} />
                  )}
                  {event.actor}
                </span>
              </div>
              <time dateTime={event.at}>
                <strong>
                  {new Date(event.at).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
                <span>{shortDate(event.at.slice(0, 10))}</span>
              </time>
            </article>
          );
        })}
      </div>
      {!events.length && (
        <div className="empty-state">
          <HistoryIcon size={28} />
          <h3>No changes here</h3>
          <p>Try a different actor, customer or date.</p>
        </div>
      )}
      <p className="history-note">
        An append-only record of changes by you and your agents.
      </p>
    </>
  );
}
