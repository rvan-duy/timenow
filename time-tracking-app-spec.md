# Time Tracking App

A small internal web app for tracking billable hours across customers and projects, with a clean API for both human and agent use.

The goal is to replace the current workflow where hours are tracked in a separate mobile-only tool, manually reviewed in a poor UI, copied into invoices, and then deleted.

This app is the source of truth for tracked hours. The external invoicing tool is the source of truth for invoices. A future agent integration can connect the two.

## Goals

- Track billable hours by customer and project.
- Allow both a human user and agents to create and update time entries.
- Make unbilled hours easy to review before invoicing.
- Preserve historical records instead of deleting entries after invoicing.
- Expose a simple API that invoice-generation agents can use directly.
- Keep the UI and architecture intentionally small.
- Host the app in a personal Railway environment.

## Non-goals

At least initially, this is not intended to become a full time-tracking or accounting platform.

Out of scope for the first version:

- Payroll
- Employee scheduling
- Complex permissions or organizations
- Invoice creation, invoice numbering, tax calculation, and payment status
- Full accounting functionality
- Payment processing
- Advanced reporting
- Native mobile apps
- Calendar integrations

## Core Principle

Time entries are durable records of work.

Once created, they should remain part of the system history. Entries may be corrected, voided, or marked as billed, but should not normally be deleted after invoicing.

## Agreed Domain Boundaries

Use lightweight domain-driven design within a single application. Time tracking is the core domain; customers and projects provide its structure. Billing is a small supporting capability.

| Area | Owns | Rules |
| --- | --- | --- |
| Customers and projects | Customer and project records, optional rate metadata | Each project belongs to one customer; archive records while preserving their history |
| Time tracking | Time entries, corrections, voiding | Store positive integer minutes; preserve actor attribution and history |
| Billing records | Groups of entries marked billed, optional external invoice references | Mark entries billed atomically; prevent an entry from being billed twice |

The UI and agent API call the same application operations, such as `LogTime`, `UpdateTimeEntry`, `VoidEntry`, and `MarkEntriesBilled`. Authentication supplies actor identity. Every mutation writes its audit record in the same database transaction.

Billed entries are locked against ordinary edits and voiding. A future explicit correction workflow must preserve the original billed record; automatic reopening is outside the initial scope.

Rates are optional metadata for estimates. Missing rates must never prevent tracking or marking hours billed. Historical rate snapshots and accounting calculations are deferred until an integration needs them.

Separate services and event infrastructure are not required for this scope.

## Suggested Stack

The implementation should stay close to a standard, boring web stack.

Suggested default:

- Next.js
- TypeScript
- shadcn/ui
- PostgreSQL
- Drizzle ORM or Prisma
- Railway

The exact stack is flexible as long as the resulting app remains simple to host and maintain.

## Data Model

### Customer

Represents the entity that will eventually receive an invoice.

Suggested fields:

```ts
Customer {
  id: string
  name: string
  invoiceName?: string
  defaultHourlyRate?: number
  currency: string
  active: boolean
  createdAt: Date
  updatedAt: Date
}
```

### Project

A project belongs to a customer and groups related time entries.

Suggested fields:

```ts
Project {
  id: string
  customerId: string
  name: string
  description?: string
  hourlyRate?: number
  active: boolean
  createdAt: Date
  updatedAt: Date
}
```

The project hourly rate can override the customer's default rate.

### Time Entry

The main record in the application.

Suggested fields:

```ts
TimeEntry {
  id: string
  projectId: string
  date: Date
  durationMinutes: number
  description: string

  hourlyRateOverride?: number

  status: "unbilled" | "billed" | "void"
  billingBatchId?: string

  createdBy: string
  createdAt: Date
  updatedAt: Date
}
```

Important behavior:

- Duration should be stored as integer minutes rather than floating-point hours.
- An entry should normally start as `unbilled`.
- Once marked billed, it stores the corresponding billing batch ID. The batch may reference an invoice created in another tool.
- Incorrect entries should preferably be corrected or marked `void` instead of permanently deleted.
- The actor that created the entry should be stored.

Examples for `createdBy`:

```text
ruben
invoice-agent
coding-agent
api
```

### Billing Batch

A billing batch records a set of entries marked as invoiced elsewhere. It is not an invoice and has no invoice creation or payment lifecycle.

Suggested fields:

```ts
BillingBatch {
  id: string
  customerId: string
  externalInvoiceReference?: string
  totalMinutes: number
  createdBy: string
  createdAt: Date
}
```

Creating a batch associates its selected entries and marks them billed in the same transaction. The external invoice reference is optional. Draft batches, financial totals, and invoice finalization are not required for the initial version.

### Audit Log

Maintain an append-only history of meaningful changes.

Suggested fields:

```ts
AuditLog {
  id: string
  timestamp: Date
  actor: string
  entityType: string
  entityId: string
  action: string
  before?: Json
  after?: Json
}
```

Example events:

```text
09:42  ruben          created   2h Acme / API work
10:13  invoice-agent  updated   status: unbilled -> billed
10:13  invoice-agent  linked    INV-2026-041
14:55  ruben          updated   duration: 120 -> 150 minutes
```

The audit log should not itself be editable from the application UI.

## Authentication

### Human UI

For the initial version, simple password protection is sufficient.

Recommended behavior:

1. User enters the app password.
2. Server creates an authenticated session cookie.
3. All app pages and mutation endpoints require an authenticated session.

Do not expose the password directly to browser JavaScript after login.

### Agent API Access

Agents should use API keys rather than sharing the human UI password.

Example:

```http
Authorization: Bearer <agent-specific-api-key>
```

Each API key should have its own identity so audit events can attribute actions correctly.

Example configuration:

```text
TIME_TRACKER_PASSWORD=...
AGENT_API_KEY_INVOICE=...
AGENT_API_KEY_CODING=...
```

Keys should be stored in environment variables and never committed to the repository.

## API

The web UI should ideally use the same application API exposed to agents.

This keeps behavior consistent and avoids creating two separate systems.

### Customers

```http
GET    /api/customers
POST   /api/customers
GET    /api/customers/:id
PATCH  /api/customers/:id
```

### Projects

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
```

Useful filters:

```text
GET /api/projects?customerId=...
GET /api/projects?active=true
```

### Time Entries

```http
GET    /api/time-entries
POST   /api/time-entries
GET    /api/time-entries/:id
PATCH  /api/time-entries/:id
```

Useful filters:

```text
GET /api/time-entries?status=unbilled
GET /api/time-entries?customerId=...
GET /api/time-entries?projectId=...
GET /api/time-entries?from=2026-10-01&to=2026-10-31
```

### Bulk Time Entry Creation

Agents should be able to create multiple entries atomically.

```http
POST /api/time-entries/bulk
```

Example body:

```json
{
  "entries": [
    {
      "projectId": "project_acme",
      "date": "2026-10-25",
      "durationMinutes": 120,
      "description": "Railway debugging"
    },
    {
      "projectId": "project_foo",
      "date": "2026-10-24",
      "durationMinutes": 45,
      "description": "Architecture call"
    }
  ]
}
```

The entire request should either succeed or fail as one transaction.

### Billing Batches

```http
GET   /api/billing-batches
POST  /api/billing-batches
GET   /api/billing-batches/:id
```

Creating a batch accepts selected entry IDs and an optional external invoice reference. It should:

1. Validate all selected entries are unbilled and belong to the same customer.
2. Create the batch and associate its entries.
3. Mark the entries billed.
4. Write audit log entries.
5. Perform all changes in one database transaction, preventing concurrent double billing.

There is no separate invoice draft or finalize endpoint in the initial scope.

### History

```http
GET /api/history
```

Useful filters:

```text
GET /api/history?entityType=time_entry
GET /api/history?actor=invoice-agent
GET /api/history?entityId=...
```

## UI

Keep the UI intentionally small.

The first version only needs a few screens.

### Today / Add Time

Primary screen for fast entry creation.

Fields:

- Date
- Customer / project
- Duration
- Description

Useful shortcuts:

- Default date to today.
- Remember the last selected project during the session.
- Support keyboard submission.
- Allow duration input such as `30m`, `1h`, `1h30`, or `90m`, but normalize to minutes before saving.

### Unbilled

The main review screen before invoicing.

Group entries by customer and project.

Example:

```text
Acme
  Platform work
    Oct 20    2h 30m    Fix deployment pipeline
    Oct 21    1h 15m    Customer meeting
    Oct 22    4h 00m    Kubernetes migration

  Total: 7h 45m
```

Useful information:

- Total duration
- Optional effective hourly rate
- Optional estimated billable amount
- Date range
- Entry descriptions

Entries should be editable directly from this view.

### History

Chronological audit log.

Useful filters:

- Actor
- Customer
- Project
- Entity type
- Date range

This screen is mainly for answering questions such as:

- Who changed this entry?
- Why is this item already billed?
- What did the invoice agent change?
- What was the previous duration?

### Settings

Minimal CRUD pages for:

- Customers
- Projects
- API keys, if key management is implemented in-app later

## Agent Workflows

### Adding Time

A user should be able to tell an agent:

```text
Add 2h to Acme today for Railway debugging and 45m to Foo Corp yesterday for the architecture call.
```

The agent should:

1. Resolve the relevant projects.
2. Create the entries through the API.
3. Return the entries that were created.

It should not interact with the web UI unless there is no API equivalent.

### Recording an External Invoice

Invoices are created in the external tool. A future agent integration can use this flow:

```text
Invoice agent
    |
    | GET unbilled hours
    v
Time Tracker API
    |
    | grouped hours + rates
    v
Invoice Agent
    |
    | creates invoice in accounting system
    v
Accounting System
    |
    | returns invoice number
    v
Invoice Agent
    |
    | records billing batch
    v
Time Tracker API
```

Conceptually:

```http
GET /api/time-entries?customerId=acme&status=unbilled
```

After the invoice is created externally, the agent records its selected entries and optional invoice reference:

```http
POST /api/billing-batches
```

Creating the billing batch marks the selected time entries billed. Manual recording uses the same operation; agent integration is a later improvement.

## Business Rules

### Time entries

- `durationMinutes` must be greater than zero.
- A project must exist and be active when creating a new entry.
- Billed entries should not silently become unbilled again.
- Ordinary edits and voiding of billed entries are rejected. Any future correction workflow must explicitly preserve the original billed record.
- All mutations should create appropriate audit events.

### Rates

Rates are optional and support estimates only. When present, effective hourly rate should resolve in this order:

```text
TimeEntry.hourlyRateOverride
    ↓
Project.hourlyRate
    ↓
Customer.defaultHourlyRate
```

If no rate exists, the entry can still be tracked and marked billed. Estimates should indicate that the rate is missing. Rate snapshots are deferred until an integration needs them.

### Deletion

Prefer soft deletion / voiding over hard deletion.

Hard deletion is outside the initial scope; accidental unbilled entries can be voided with an audit record.

## Database Integrity

The database should enforce important invariants where practical.

Examples:

- Foreign keys between projects, customers, time entries, and billing batches.
- Positive duration constraint.
- Valid status enums.
- Billing batch creation, entry status changes, and audit writes in one transaction.
- Prevent a time entry from belonging to multiple billing batches.

Application-level validation alone should not be relied on for billing-critical state transitions.

## Suggested Repository Structure

```text
app/
  api/
    customers/
    projects/
    time-entries/
    billing-batches/
    history/
  history/
  projects/
  settings/
  unbilled/
  page.tsx

components/
  time-entry-form.tsx
  time-entry-table.tsx
  project-selector.tsx
  customer-selector.tsx

lib/
  auth.ts
  db.ts
  audit.ts
  billing.ts
  api-auth.ts

db/
  schema.ts
  migrations/
```

This is illustrative rather than mandatory.

## MVP

The first usable version should include:

- Password-protected web UI
- PostgreSQL database
- Customer CRUD
- Project CRUD
- Time-entry CRUD
- Agent API authentication
- API for creating and querying entries
- Unbilled-hours screen
- History / audit log
- Ability to mark a group of entries as billed with an optional external invoice reference
- Railway deployment

## Later Improvements

Potential follow-up work:

- Direct integration with the invoice-generation agent
- Direct integration with an accounting provider
- Historical rate snapshots if an integration requires them
- Retainers / fixed-price work
- Recurring projects
- CSV export
- Monthly summaries
- Search
- Agent-specific API scopes
- API key rotation from the UI
- Attach invoice PDFs or external invoice URLs
- Webhooks when entries are billed
- MCP server or agent tool wrapper around the API

## Security Notes

This is a small private app, but it contains billing data and agent credentials.

Minimum requirements:

- HTTPS only in production.
- Passwords and API keys stored only as secrets/environment variables.
- Secure, HTTP-only session cookies.
- API keys compared server-side.
- Rate-limit authentication endpoints.
- Never expose database credentials to the client.
- Validate all agent-generated API input server-side.
- Audit all billing state transitions.

## Design Philosophy

Keep the system deliberately boring.

The app exists to provide one reliable source of truth for billable time, regardless of whether the entry was created from a phone, desktop browser, coding agent, or invoice agent.

The UI should optimize for quick manual entry and reviewing unbilled work.

The API should optimize for deterministic agent interaction.

The database should preserve enough history that invoice generation never depends on deleting or manually reconstructing previous state.
