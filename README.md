# Fumigadora

Management app for a pest-control company: clients and their account statements, receivables and aging,
invoicing (including monthly fees), visit scheduling with certificates ("obleas"), cash flow and a daily
dashboard. Used daily on desktop and phone by the owner (admin users); employees get a phone-first screen for their own visits. The UI is in Spanish (es-AR); code and docs are in English.

## Stack

- `shared/`: pure domain logic (money in integer cents, invoice status, FIFO allocation, aging, recurrence), unit tested.
- `server/`: Hono REST API, Drizzle ORM, PostgreSQL (PGlite when `DATABASE_URL` is unset), cookie auth for admin and employee users (username + password). Serves the built SPA.
- `web/`: Vite + React 19 + TypeScript, React Router, TanStack Query, Tailwind CSS v4 (no component library).
- `docs/`: [product and technical design](docs/design.md), [REST API reference](docs/api.md).

## Local development

Requires Node 22 or newer. No Docker or external database needed: without `DATABASE_URL` the server uses an embedded
PGlite database stored in `server/.data/pglite`.

```bash
npm install
npm run db:migrate        # optional: the server also migrates on start
npm run db:seed           # optional: realistic demo data (idempotent)
npm run dev               # API on :3000 and Vite on :5173 (proxies /api)
```

Open http://localhost:5173. Log in with a username and password (demo seed: `lucas` / `lucas1234`; employees `juan`, `pablo`, `marcos` / `empleado`). `ADMIN_PASSWORD` (in development `admin` unless set, a warning is logged) is emergency owner access only: use the "Acceso de emergencia" link on the login page, then create an admin user in Ajustes > Empleados.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Server (watch mode) and web dev server together |
| `npm run build` | Builds `web/dist`, then bundles the server to `server/dist` |
| `npm start` | Runs the built server; it also serves `web/dist` |
| `npm test` | Vitest for shared, server (API integration) and web unit tests |
| `npm run typecheck` | `tsc` for all workspaces |
| `npm run db:generate` | Generates a Drizzle migration after schema changes |
| `npm run db:migrate` / `npm run db:seed` | Apply migrations / load demo data |

## Environment

See `.env.example`.

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | in production | Emergency owner login (password only). The server refuses to start in production without it |
| `SESSION_SECRET` | in production | Signs the session cookie; the server refuses to start in production without it |
| `DATABASE_URL` | in production | Postgres connection string; unset = embedded PGlite |
| `RESEND_API_KEY` | no | With `MAIL_FROM`, enables real email through Resend. Without them emails are simulated: stored in the mail log, not sent |
| `MAIL_FROM` | no | Sender, e.g. `Plagamix <avisos@your-domain.com>` (domain verified in Resend) |
| `MAIL_REPLY_TO` | no | Optional reply-to address |
| `FILES_DIR` | no | Directory for stored files (certificate PDFs). Defaults to `server/.data/files`; in production point it at a persistent volume (see below) |
| `PORT` | no | Defaults to 3000; the server binds to `0.0.0.0` |

## Deploy on Railway

One service builds and serves both the API and the SPA. `railway.json` sets the build to `npm run build` (Railpack installs dependencies first),
the start command to `npm start` and the health check to `/api/health`.

1. Create a Railway project from this repository (a single service at the repo root).
2. Add the **PostgreSQL** plugin to the project.
3. In the service variables set:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference to the plugin)
   - `ADMIN_PASSWORD` = a strong password
   - `SESSION_SECRET` = a long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `NODE_ENV` = `production` (set it explicitly if the builder does not)
4. Stored files (certificate PDFs): create a **volume** on the service in the Railway UI (volumes are not configurable in `railway.json`), mount it at `/data`, and set `FILES_DIR` = `/data/files`. Without a volume the container disk is ephemeral and the PDFs are lost on every deploy.
5. Deploy. Migrations run automatically on start.
6. Optional demo data: `railway run npm run db:seed` runs the seed against the service `DATABASE_URL`. Skip it for a real installation.
7. Legacy data: `npm run db:import-legacy -- --file <export.json> --files <files-bundle.json>` (add `--dry-run` first) imports the legacy system export and writes the certificate PDFs into `FILES_DIR`. It is idempotent.

The session cookie is `Secure` in production, so use the Railway HTTPS domain.

## Architecture notes

- Money is stored and transferred as integer cents; `formatMoney`/`parseMoney` live in `shared` and are the only formatting path.
- Balances, invoice status, aging and monthly income are derived on every read from invoices, payments and allocations; they are never stored twice.
- Payments auto-allocate FIFO to the oldest open invoices; the remainder becomes client credit.
- Completing a visit can create the invoice, issue the certificate and schedule the next visit in one transaction.
- Every web mutation invalidates all derived queries, so dashboard, client account, receivables and finance stay consistent.
