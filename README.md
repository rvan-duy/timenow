# timenow

A small time-tracking workspace using the selected **Studio** design: white and indigo, an open ledger, and a compact entry form. Built with React, TypeScript, Vite, Radix Themes, a Node.js API, and PostgreSQL.

## Run

```sh
npm ci
colima start
docker --context colima start timenow-postgres
npm run dev
```

Open [localhost:5173](http://localhost:5173). Node 26 is used for development. `npm run dev` starts the API on loopback port 3001 and Vite on loopback port 5173; Vite proxies `/api` to the backend. Database migrations run automatically before the API starts. Configure `.env` and create the database container first on a fresh machine (see below).

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

This is a local development app. Password sessions and agent API keys are not implemented yet; the backend uses the server-configured local actor (`ruben` by default), binds only to loopback, rejects cross-site requests, and refuses to start with `NODE_ENV=production`. Authentication and production hosting remain prerequisites for Railway deployment. Invoice creation stays in the external invoicing tool. See the [app spec](time-tracking-app-spec.md) for the agreed scope.

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
GET    /api/workspace
GET    /api/customers, /api/projects, /api/time-entries, /api/history
POST   /api/customers, /api/projects, /api/time-entries
PATCH  /api/customers/:id, /api/projects/:id, /api/time-entries/:id
POST   /api/time-entries/:id/void
POST   /api/time-entries/bulk
GET    /api/billing-batches
POST   /api/billing-batches
```

`GET /api/workspace` returns a consistent snapshot for the small workspace. Time-entry list filters include `status`, `customerId`, `projectId`, `from`, and `to`. History supports actor/customer/project/date filters. Bulk creation is atomic. This is the initial API surface; authenticated agent access and pagination can follow.

## Structure

- `src/components/AppShell.tsx` — the Studio app shell, navigation, and summary.
- `src/components/ui.tsx` — shared Radix form controls, buttons, and dialogs.
- `src/components/TimeForm.tsx` and `Entries.tsx` — time-entry workflow.
- `src/pages/` — Unbilled, History, and Settings.
- `src/lib/` — shared types, calculations, and API-backed workspace state.
- `server/` — local HTTP API, database connections, domain operations, and integration tests.
- `db/migrations/` — versioned PostgreSQL schema.

The selected visual reference is [Studio](docs/concepts/studio.png). Current rendered previews and verification details are in [design and QA notes](docs/design-and-qa.md).
