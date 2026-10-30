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
| `MAIL_FROM` | no | Sender, e.g. `Plagamix <avisos@your-domain.com>` (domain verified in Resend). With SMTP it defaults to `Plagamix <SMTP_USER>` |
| `SMTP_USER`, `SMTP_PASS` | no | Real email through an SMTP account when Resend is not configured, e.g. a Gmail address and an app password (Google account > Security > 2-Step Verification > App passwords). Gmail allows about 500 emails a day |
| `SMTP_HOST`, `SMTP_PORT` | no | Default to `smtp.gmail.com` and `465` (TLS) |
| `MAIL_REPLY_TO` | no | Optional reply-to address |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no | Turn on push notifications on phones (Web Push). All three are needed; without them push stays off and nothing else changes. Generate the pair with `npm run push:keys`; the subject is a contact like `mailto:owner@your-domain.com`. Keep the private key secret and do not rotate it casually: devices subscribed with the old key must subscribe again |
| `PUBLIC_BASE_URL` | production | Public origin of the site, e.g. `https://app.your-domain.com`. Used for the QR/public links and the client-portal magic links. Without it the links fall back to the request origin, except the magic links in production, which are not sent (a forged `Host` header must not decide where they point) |
| `FILES_DIR` | no | Directory for stored files (certificate PDFs). Defaults to `server/.data/files`; in production point it at a persistent volume (see below) |
| `PORT` | no | Defaults to 3000; the server binds to `0.0.0.0` |

## Install on the phone (PWA) and push notifications

Plagamix can be installed as an app from the browser; there is nothing to download from a store.

- **Android (Chrome):** open the site, menu (three dots) > "Instalar app" / "Agregar a la pantalla principal".
- **iPhone (Safari):** open the site, Share > "Agregar a inicio". **iOS 16.4 or newer is required**, and push notifications only work from the app opened from the home screen, not from a Safari tab.

Then tap the bell inside the app and "Activar notificaciones" (once per device). Admins and employees are sent to their own screen after logging in. Push needs the `VAPID_*` variables above on the server and HTTPS (Railway provides it; `localhost` also works for testing). The service worker (`/sw.js`) only handles notifications and caches nothing, so deploys are picked up immediately.

## Public link, QR placards and client portal

- **Public link.** Every client has `/c/<token>`: next visit and oblea validity, no amounts or contact data, no login. In the client sheet, **Link público** copies it or generates a new one (the old link and any printed QR stop working at once).
- **QR placards.** **Imprimir QR** (client sheet) prints one placard; **Carteles QR** (clients list) prints many, optionally one zone, one placard per page. Pick A5 (default) or A4 portrait and use the browser's print dialog with margins set to "None" and background graphics on. The QR encodes `PUBLIC_BASE_URL` (or the origin of the page you printed from, so print from the production URL).
- **Client portal.** Clients sign in at `/portal` with the email stored on the client (or on one of its contacts) and receive a one-time link (30 minutes). They see next visits, balance, invoices, payments and their own oblea PDFs for 30 days. Set `PUBLIC_BASE_URL` in production: the links are not sent without it. Without a mail provider the link is only stored in the mail log (**Ajustes > Mails**), which is handy for testing.
- Set the company phone/WhatsApp shown on the public page in **Ajustes > Base de la empresa**.

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
5a. Set `PUBLIC_BASE_URL` = the public HTTPS origin of the service (e.g. `https://your-app.up.railway.app`): QR links and client-portal magic links are built from it.
5b. Optional push notifications: run `npm run push:keys` locally and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` on the service.
6. Optional demo data: `railway run npm run db:seed` runs the seed against the service `DATABASE_URL`. Skip it for a real installation.
7. Legacy data: `npm run db:import-legacy -- --file <export.json> --files <files-bundle.json>` (add `--dry-run` first) imports the legacy system export and writes the certificate PDFs into `FILES_DIR`. It is idempotent.

The session cookie is `Secure` in production, so use the Railway HTTPS domain.

## Architecture notes

- Money is stored and transferred as integer cents; `formatMoney`/`parseMoney` live in `shared` and are the only formatting path.
- Balances, invoice status, aging and monthly income are derived on every read from invoices, payments and allocations; they are never stored twice.
- Payments auto-allocate FIFO to the oldest open invoices; the remainder becomes client credit.
- Completing a visit can create the invoice, issue the certificate and schedule the next visit in one transaction.
- Every web mutation invalidates all derived queries, so dashboard, client account, receivables and finance stay consistent.
