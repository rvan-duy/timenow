# timenow

A small time-tracking workspace using the selected **Studio** design: white and indigo, an open ledger, and a compact entry form. Built with React, TypeScript, Vite, Radix Themes, a Node.js API, and PostgreSQL.

## Run

```sh
npm ci
colima start
docker --context colima start timenow-postgres
npm run dev
```

Open [localhost:5173](http://localhost:5173). Node 26 is used for development. `npm run dev` starts the API on loopback port 3001 and Vite on loopback port 5173; Vite proxies `/api` to the backend. Database migrations run automatically before the API starts. Configure `.env`, create the database container, and run the account setup below first on a fresh machine. Existing installations only need `npm run dev`.

```sh
npm run build
npm run test:integration
```

`npm run build` checks and bundles the frontend. `npm run preview` serves only that static bundle; use `npm run dev` for the connected app. Integration tests create and remove their own temporary database schema, leaving workspace records untouched.

## Screens

- **Today** — add time using `30m`, `1h`, `1h30`, or `90m`, duration shortcuts, or Ctrl/Command + Enter. Edit or void entries while retaining their history.
- **Unbilled** — review entries by customer/project, filter by customer and dates, and mark a billing batch invoiced elsewhere with an optional invoice reference.
- **History** — inspect changes attributed to you or an agent, with actor/customer/date filters.
- **Settings** — add, edit, archive, or restore customers and projects.

Desktop uses a side rail and a ledger beside the form. Mobile puts the form first and moves navigation to the bottom. Routes are `#/today`, `#/unbilled`, `#/history`, and `#/settings`. Existing Studio preview links resolve to the matching screen.

All four screens now read and write PostgreSQL through the local API. A new database starts empty: add a customer and project in Settings, then log time. Browser-local prototype records are left untouched and are not imported automatically.

This is a local development app with self-hosted Better Auth. Your password login and the agent API key both resolve to server-owned audit identities. Accounts and sessions live in PostgreSQL; no external account service is configured, and Better Auth telemetry is explicitly disabled. The server still binds to loopback and refuses production mode until Railway hosting is configured. Invoice creation stays in the external invoicing tool. See the [app spec](time-tracking-app-spec.md) for the agreed scope.

## Local database

PostgreSQL 17 runs in Docker through Colima, without Compose. The Node API uses `DATABASE_URL` from the private `.env` file. Credentials are never bundled into the frontend.

Start Colima with `colima start`. For a fresh setup, copy `.env.example` to `.env`, set a local password, and use its URL-encoded value in `DATABASE_URL`. Keep `.env` private; it is ignored by Git. Database credentials must never use a `VITE_` prefix.

Create the container once, from the project directory:

```sh
docker --context colima run -d --name timenow-postgres \
  --restart unless-stopped \
  --env-file .env \
  -e POSTGRES_USER=timenow -e POSTGRES_DB=timenow \
  -p 127.0.0.1:5432:5432 \
  -v timenow-postgres-data:/var/lib/postgresql/data \
  --health-cmd='pg_isready -U timenow -d timenow' \
  --health-interval=5s --health-timeout=3s --health-retries=10 \
  postgres:17
```

For later sessions, use `colima start` and `docker --context colima start timenow-postgres`. Stop the database with `docker --context colima stop timenow-postgres`. Data persists in the named volume across container restarts. Changing `.env` does not change the password of an initialized database.

Open a SQL shell with `docker --context colima exec -it timenow-postgres psql -U timenow -d timenow`. Railway will supply a separate production `DATABASE_URL` when deployed.

## Authentication

The fixed identities are `ruben` (browser password login) and `agent` (API key only). Both share the same workspace and domain operations. Public signup, email login, social providers, account editing, email-based password reset, and HTTP API-key management are unavailable. The `.invalid` email addresses in the auth tables are internal placeholders; no email service is configured.

On first setup, supply a private file containing the exact login password (12–128 characters, with no added newline):

```sh
npm run auth:setup -- --password-file /absolute/path/to/private-password-file
```

The command applies migrations, generates `BETTER_AUTH_SECRET` in the ignored `.env` if absent, provisions the accounts, and writes a generated agent key into ignored `.env.agent`. Both files are owner-readable/writable only. It never prints credentials. Re-running setup preserves the existing password and valid agent key. Provisioning runs only in the operator command; the running HTTP server always has signup disabled. Remove a temporary password file when finished; the app does not need it at runtime.

Sign in at [localhost:5173](http://localhost:5173) with username `ruben`. Both local loopback hostnames work. Better Auth handles password hashing using its default scrypt implementation and session cookie signing/verification. Sessions expire after seven days, are checked against PostgreSQL on every request, and are revoked on logout. Cookies are HttpOnly and SameSite=Lax, with Secure enabled for HTTPS. No browser token storage or session cookie cache is used. Session expiry returns the UI to login.

All workspace APIs require a valid browser session or `Authorization: Bearer <agent-key>`. Only `/api/health` is public. Browser mutations require a trusted Origin. The HTTP auth surface is limited to username sign-in, session inspection, and sign-out; key creation/rotation remain operator commands. Login is limited to five attempts per minute per connecting IP with counters in PostgreSQL. Incoming IP headers are replaced with the direct socket address, so clients cannot spoof that limiter. Agent keys expire after one year and allow 120 requests per minute. The agent has no password credential or browser session access.

Use a trusted operator shell to reset the password or rotate the agent key:

```sh
npm run auth:reset-password -- --password-file /absolute/path/to/private-password-file
npm run auth:rotate-agent-key
```

Password reset revokes all browser sessions. Key rotation writes the replacement to `.env.agent` and disables prior agent keys. The generated key is hashed in PostgreSQL; the private file is its local handoff copy. Load it into the agent's secret store rather than committing it or placing it in a URL. Database credentials and auth secrets must never have a `VITE_` prefix.

Railway deployment remains separate work: configure a production HTTPS origin, a separate signing secret, production database/accounts, trusted proxy handling, and app hosting before lifting the local-only startup restriction.

## Backend behavior

- SQL migrations live in `db/migrations/`. Run `npm run db:migrate` explicitly if needed; applied migrations are tracked and startup is safe to repeat.
- Customers and projects can be created, edited, archived, and restored. Projects retain their original customer.
- Time entries store integer minutes. Updates and voids require the entry version, so a stale client cannot overwrite a later change. Billed and voided records are read-only.
- Every mutation writes before/after audit data in the same transaction. Audit records cannot be edited or deleted through the API; database triggers also reject those changes and time-entry deletion.
- Billing batches accept a single customer's unbilled entry IDs and an optional external invoice reference. Row locks prevent concurrent double billing. Rates are optional.
- The frontend shows loading, saving, validation, and connection errors, and confirms success only after the API mutation completes. No browser-storage fallback is used.

API routes currently used by the app:

```text
GET    /api/health
GET    /api/me
POST   /api/auth/sign-in/username
GET    /api/auth/get-session
POST   /api/auth/sign-out
GET    /api/workspace
GET    /api/customers, /api/projects, /api/time-entries, /api/history
POST   /api/customers, /api/projects, /api/time-entries
PATCH  /api/customers/:id, /api/projects/:id, /api/time-entries/:id
POST   /api/time-entries/:id/void
POST   /api/time-entries/bulk
GET    /api/billing-batches
POST   /api/billing-batches
```

`GET /api/workspace` returns a consistent snapshot for the small workspace. Time-entry list filters include `status`, `customerId`, `projectId`, `from`, and `to`. History supports actor/customer/project/date filters. Bulk creation is atomic. Authenticated agent access uses this same API surface; pagination can follow.

## Structure

- `src/components/AppShell.tsx` — the Studio app shell, navigation, and summary.
- `src/components/ui.tsx` — shared Radix form controls, buttons, and dialogs.
- `src/components/TimeForm.tsx` and `Entries.tsx` — time-entry workflow.
- `src/pages/` — Unbilled, History, and Settings.
- `src/lib/` — shared types, calculations, and API-backed workspace state.
- `server/` — local HTTP API, database connections, domain operations, and integration tests.
- `db/migrations/` — versioned PostgreSQL schema.

The selected visual reference is [Studio](docs/concepts/studio.png). Current rendered previews and verification details are in [design and QA notes](docs/design-and-qa.md).
