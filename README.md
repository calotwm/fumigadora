# Fumigadora

Management app for a pest-control company: clients and their account statements, receivables and aging,
invoicing (including monthly fees), visit scheduling with certificates ("obleas"), cash flow and a daily
dashboard. One admin user, used daily on desktop and phone. The UI is in Spanish (es-AR); code and docs are in English.

## Stack

- `shared/`: pure domain logic (money in integer cents, invoice status, FIFO allocation, aging, recurrence), unit tested.
- `server/`: Hono REST API, Drizzle ORM, PostgreSQL (PGlite when `DATABASE_URL` is unset), single-admin cookie auth. Serves the built SPA.
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

Open http://localhost:5173. In development the password is `admin` unless `ADMIN_PASSWORD` is set (a warning is logged).

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
| `ADMIN_PASSWORD` | in production | The server refuses to start in production without it |
| `SESSION_SECRET` | in production | Signs the session cookie; the server refuses to start in production without it |
| `DATABASE_URL` | in production | Postgres connection string; unset = embedded PGlite |
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
4. Deploy. Migrations run automatically on start.
5. Optional demo data: `railway run npm run db:seed` runs the seed against the service `DATABASE_URL`. Skip it for a real installation.

The session cookie is `Secure` in production, so use the Railway HTTPS domain.

## Architecture notes

- Money is stored and transferred as integer cents; `formatMoney`/`parseMoney` live in `shared` and are the only formatting path.
- Balances, invoice status, aging and monthly income are derived on every read from invoices, payments and allocations; they are never stored twice.
- Payments auto-allocate FIFO to the oldest open invoices; the remainder becomes client credit.
- Completing a visit can create the invoice, issue the certificate and schedule the next visit in one transaction.
- Every web mutation invalidates all derived queries, so dashboard, client account, receivables and finance stay consistent.
