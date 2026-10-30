# Fumigadora API

REST JSON under `/api`. Conventions:

- Money is always an **integer number of cents** (`amountCents: 15000000` = `$ 150.000,00`). Format on the client with `formatMoney` from `@fumigadora/shared`.
- Dates are ISO strings `YYYY-MM-DD`; months are `YYYY-MM`; visit times are `HH:MM`.
- "Today" is the calendar date in `America/Argentina/Buenos_Aires`.
- Auth: two roles, `admin` and `employee`. Every user (admin or employee) logs in with `username` + `password` (stored as scrypt hashes). The shared `ADMIN_PASSWORD` (no username) is kept as **emergency owner access**: an admin session with no user id (name `Dueño`) that has no notifications. `POST /api/auth/login` sets an httpOnly `fumigadora_session` cookie (SameSite=Lax, Secure in production) whose signed payload carries role and user id. Every route except `/api/health` and `/api/auth/*` answers `401` without a session. `/api/me/*` is open to every signed-in user; **every other route requires role `admin` and answers `403 forbidden` to employees**. Send requests with `credentials: 'same-origin'`.
- Errors: `{ "error": { "code": string, "message": string (Spanish, user-facing), "details"?: any } }`.
  Status codes: `400` validation (`code: "validation"`, `details.issues[{path,message}]`) or business rule, `401` unauthorized, `403` forbidden (role), `404` not found, `409` conflict / duplicate, `429` login throttled, `500` internal.
- Request bodies are JSON (`content-type: application/json`). In the "Body" columns `?` means optional and `x | null` accepts null.
- Derived values (balances, invoice status, aging) are computed on every read; never stored.

Environment: `ADMIN_PASSWORD` (owner login; employees are created in the app), `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (all three = Web Push on; generate keys with `npm run push:keys`), `SESSION_SECRET` (required when `NODE_ENV=production`; insecure dev defaults with a console warning otherwise), `DATABASE_URL` (Postgres; unset = embedded PGlite at `PGLITE_DIR`, default `./.data/pglite` relative to `server/`), `FILES_DIR` (stored certificate PDFs; default `./.data/files` relative to `server/`; a persistent volume path in production), `PORT` (default 3000), `RESEND_API_KEY` + `MAIL_FROM` (both set = real email through Resend; otherwise emails are only simulated and logged), `MAIL_REPLY_TO` (optional).

Shared shapes used below:

```ts
BalanceFields = {
  balanceCents: number;       // open invoices - credit (negative = client has credit)
  openCents: number;          // sum of open invoice balances
  overdueCents: number;       // past-due part (credit applied oldest-first)
  creditCents: number;        // unallocated payments
  daysOverdue: number;        // today - oldest unpaid dueOn (0 if none)
  agingBucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
  overdueInvoiceCount: number;
}
Invoice = {
  id, clientId, visitId: number|null, number: 'YYYY-NNNN', issuedOn, dueOn,
  amountCents, description, periodMonth: 'YYYY-MM'|null, voided: boolean,
  status: 'pending'|'partial'|'overdue'|'paid'|'void',   // overdue wins over partial
  paidCents, balanceCents, isPartial: boolean, daysOverdue,
  items: { description, quantity, unitPriceCents, amountCents }[]   // invoice lines; amountCents = their sum
}
Visit = {
  id, clientId, serviceTypeId, date, time: 'HH:MM'|null,
  status: 'scheduled'|'done'|'cancelled',
  frequency: 'none'|'weekly'|'biweekly'|'monthly'|'bimonthly'|'quarterly'|'semiannual'|'yearly',
  notes: string|null, completedAt: string|null, priceCents: number|null,
  clientName, clientAddress: string|null, clientPhone: string|null,
  serviceTypeName, issuesCertificate: boolean,
  assignedUserId: number|null, assigneeName: string|null   // employee the visit is assigned to
}
Certificate = {
  id, clientId, clientName, clientPhone, visitId: number|null, number: string,
  issuedOn, expiresOn, daysLeft: number /* negative = expired */,
  serviceTypeId: number|null, serviceTypeName: string|null, superseded: boolean
}
Allocation = { invoiceId, invoiceNumber, amountCents }
```

## Auth and health

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` | - | `{ ok: true }` (public) |
| POST | `/api/auth/login` | users: `{ username, password }` (username is case-insensitive); emergency owner access: `{ password }` | `{ authenticated: true, role: 'admin'\|'employee', userId?, name }` + cookie. `401 invalid_credentials` (also for deactivated users); `429` after 8 failures per IP / 10 min (shared by both logins) |
| POST | `/api/auth/logout` | - | `{ authenticated: false }` |
| GET | `/api/auth/me` | - | `{ authenticated: true, role, userId?, name }` or `401`. The emergency owner login has no `userId` and name `Dueño`. Deactivated users get `401` immediately |

Sessions issued before employee accounts existed (no role in the cookie) are rejected: log in again.

## Client portal (`/api/portal`, role `client`)

Clients sign in with an emailed magic link. The session cookie is the same signed cookie as the staff one, with role `client`, the `clientId` it is bound to and a **30 day** lifetime. A client session is **rejected with `403` by every staff route** (`requireSession` only lets `admin` and `employee` through) and the staff and public routes are the only ones that ignore it; `/api/portal/*` data routes accept only a client session (`401` without one, `403` for staff). Every portal query filters by the session's `clientId`, never by an id from the request.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/portal/login` | `{ email }` | `200 { ok: true, message }`, **identical for known and unknown emails** (the lookup and the mail run after the response). When the email matches an active client (`clients.email` or any `client_contacts.email`, case-insensitive) a link `<base>/portal/entrar?token=...` is emailed (email kind `portal_login`). `429 rate_limited` after 3 requests per email or 10 per IP in 15 minutes (in memory; counted for known and unknown emails alike). `400` for a malformed email. In production the link needs `PUBLIC_BASE_URL`: without it no mail is sent (a spoofed `Host` must not decide where the link points) |
| POST | `/api/portal/verify` | `{ token }` | One matching client: `{ status: 'ok', client: { id, name } }` + session cookie, token spent. Several clients share the email: `{ status: 'choose', clients: { id, name }[] }` (only those that matched this token), no cookie, token **not** spent. `400 invalid_link` for an unknown, expired (30 min) or used token. POST instead of GET so mail scanners that prefetch links cannot burn the token |
| POST | `/api/portal/select` | `{ token, clientId }` | Picker step: same checks as `verify`; `clientId` must be one of the clients that matched the token, else `400 invalid_link` (and the token stays usable). Spends the token and binds the session to that client |
| GET | `/api/portal/me` | - | `{ client: { id, name } }` |
| GET | `/api/portal/summary` | - | `{ balanceCents, openCents, overdueCents, creditCents, daysOverdue, overdueInvoiceCount, months: { month, billedCents, paidCents, owedCents }[] (same rules as `GET /api/clients/:id/months`), nextVisits: { id, date, time, serviceTypeName }[] (5), lastVisitDate, certificate: PortalCertificate\|null }` |
| GET | `/api/portal/visits` | - | `{ id, date, time, status, serviceTypeName }[]`, newest first (no notes, prices, cancel reasons or employee names) |
| GET | `/api/portal/invoices` | - | Non-voided invoices, newest first: `{ id, number, issuedOn, dueOn, description, amountCents, paidCents, balanceCents, status, daysOverdue, items: { description, quantity, unitPriceCents, amountCents }[] }[]` (no ARCA data) |
| GET | `/api/portal/payments` | - | `{ id, paidOn, amountCents, method, allocations: { invoiceNumber, amountCents }[] }[]`, newest first |
| GET | `/api/portal/certificates` | - | `{ id, number, issuedOn, expiresOn, serviceTypeName, hasFile, valid, daysLeft, superseded }[]`, latest expiry first |
| GET | `/api/portal/certificates/:id/file` | - | The PDF (`application/pdf`, inline) of one of the client's own certificates; `404` for anything else, including another client's id |

Logout is `POST /api/auth/logout`; `GET /api/auth/me` answers `{ role: 'client', clientId, name }` for a portal session. Login tokens live in `client_login_tokens` (sha256 only, single use, 30 min).

## Users (owner only)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/users` | - | `{ id, name, phone, username, email, role: 'admin'\|'employee', assignable, active, createdAt }[]` by name. Password hashes are never returned |
| POST | `/api/users` | `{ name, phone?, username (3-40: a-z 0-9 . _ -, lowercased), password (>= 6), email? (lowercased, unique when set), role?='employee', assignable? (default true for employees, false for admins) }` | `201` user; `409 duplicate` if the username or email exists. `assignable` controls whether the user can be picked as the assignee of a visit or route item (others answer `409`) |
| PATCH | `/api/users/:id` | `{ name?, phone?, username?, email? ('' clears), role?, assignable?, active? }` | user. `active: false` deactivates: the user can no longer log in and existing sessions stop working at once |
| POST | `/api/users/:id/password` | `{ password (>= 6) }` | `{ ok: true }` |

## Employee routes (`/api/me`, employees and admin)

An employee always acts as themselves, and so does an admin user. An admin may pass `?userId=` to act as another user (testing); the emergency owner session has no user of its own, so without it `400`.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/me/visits` | query `date?=today` | `{ date, base: { latitude, longitude }\|null, visits: (Visit & { clientBalanceCents, paidCents, cashCollectedCents })[], cashPending: { cents, count } }`. Only visits assigned to the caller, cancelled hidden, in **route order**: pending visits first (timed ones by time, then the untimed ones nearest-neighbour from the company base, clients without coordinates last), then the done ones. `base` is the company location from the settings (null when not configured; the route then starts at the first located visit). `Visit` carries `clientLatitude`/`clientLongitude` (null when unknown). `paidCents` = everything this employee registered as paid at that visit (any method), `cashCollectedCents` = the cash part of it; `cashPending` = all cash of the caller not yet confirmed by the owner |
| GET | `/api/me/extras` | - | Active extras (`{ id, name, priceCents, active, createdAt }[]`) the caller can add when closing a visit |
| POST | `/api/me/visits/:id/done` | `{ paymentStatus?: 'full'\|'partial'\|'none', method?: 'cash'\|'transfer'\|'mercadopago' (default cash), amountCents? (> 0, required for partial), extras?: { extraId, quantity }[], notes?, cashCollectedCents? (legacy: same as partial + cash) }` | `{ visit, invoice, extras, certificate, nextVisit, payment: <POST /api/payments response>\|null, paymentStatus, paymentMethod }`. `404` if the visit is not assigned to the caller (same answer as unknown id); `409` if not `scheduled`. One transaction |

**Client cancelled** (the employee's own `scheduled` visits only; unknown or foreign id `404`, not `scheduled` `409`):

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/me/visits/:id/postpone` | `{ date (>= today), time? }` (`time` omitted keeps the current one, `null` clears it; `400` if neither date nor time changes) | `{ visit, previous: { date, time } }` |
| POST | `/api/me/visits/:id/cancel` | `{ reason }` (required, <= 500) | `{ visit (status cancelled, cancelReason), nextVisit: Visit\|null }`. A recurring visit schedules its next occurrence (same client, service, frequency, price, assignee and time; `date + frequency`, never in the past) in the same transaction |

Both alert the admins (employee sessions only): `visit_postponed` ("Juan pospuso la visita de X al 17/06 a las 09:00.") and `visit_cancelled` ("... canceló la visita de X. Motivo: ..."). `Visit` now also carries `cancelReason`.

**Notifications** (the bell; every signed-in user, always the caller's own). The emergency owner session has no user: it gets an empty list and `404` on a single id.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/me/notifications` | - | `{ unreadCount, items: { id, kind, title, body, link, readAt, createdAt }[] }`, the latest 30 newest first. `kind`: `day_summary`, `visits_overdue`, `client_email_failed`, `visits_today`, `visits_reminder`, `visit_done`, `cash_collected`, `extras_added`, `visit_postponed`, `visit_cancelled`; `link` is an in-app route. The web app polls this every 60 s |
| POST | `/api/me/notifications/:id/read` | - | `{ ok: true }` (repeating it is fine). `404` for an unknown id or one that belongs to someone else |
| GET | `/api/me/push` | - | `{ enabled, publicKey }`. `enabled` is false (and `publicKey` null) until `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all set |
| POST | `/api/me/push/subscribe` | `{ endpoint, keys: { p256dh, auth } }` (a browser `PushSubscription.toJSON()`) | `201 { ok: true }`. Upserts by `endpoint` (the same device signed in as someone else moves to that user). `409 push_disabled` without VAPID; `400` for the emergency session (no user) |
| POST | `/api/me/push/unsubscribe` | `{ endpoint }` | `{ ok: true }`; only removes the caller's own subscription |
| POST | `/api/me/notifications/read-all` | - | `{ ok: true, updated }` |

**Live admin alerts.** When an *employee* (session role `employee`) marks a visit done through `POST /api/me/visits/:id/done`, every active admin user gets a `visit_done` notification right away (bell and push, no email) that states the payment outcome when `paymentStatus` was sent ("Pagó todo ($ 50.000, transferencia)", "Pagó una parte (...)", "No pagó"); a cash payment also raises a `cash_collected` one with the amount (the cash that is now "a rendir"), and extras raise an `extras_added` one with the extras list and amount. Title/body are in Spanish with the employee and client name and link to the client. What the owner or an admin user does (`/api/visits/:id/complete`, `/api/payments`, an admin acting in `/api/me`) never alerts. **Bursts are grouped**: if the same employee triggers another alert of the same kind within 10 minutes (`alertWindowMs`) while the admin's previous one is still unread, that notification is updated instead ("Juan completó 3 visitas", cash totals are summed, `groupCount` grows, it moves back to the top) and pushed again with the same `tag`, so phones replace it instead of stacking. Reading it ends the group. New alert kinds plug into `alertAdmins` / `alertCopy` in `services/adminAlerts.ts`.

**Web Push.** Whenever a notification is created (the single path in `services/notifications.ts`, outside any transaction) it is also sent to every device the user subscribed, as `{ title, body, link, tag }` for the service worker (`/sw.js`), which shows it and opens `link` on tap. Delivery never fails the caller; subscriptions that answer `404`/`410` are deleted. The web app is a PWA (`/manifest.webmanifest`, icons under `/icons`); iOS needs it added to the home screen (16.4+).

Completion defaults (same engine as `POST /api/visits/:id/complete`): invoice only when the visit has its own price > 0, next visit when the visit has a frequency (same assignee), certificate when the service type issues one. **Extras and payment at closing.** `extras` are billed as invoice lines (see "Extras"); a visit without its own price bills only the extras. `paymentStatus` says what the client paid at the visit: `full` = the visit's invoice total (extras included; `400` when there is nothing to charge), `partial` = `amountCents`, `none` = nothing is registered. The payment is registered for the visit's client with `collectedByUserId` and `visitId` and is allocated to **the visit's invoice first**, any remainder FIFO to older debt (credit if there is none). Only `cash` stays "a rendir" (`handedOverAt = null`); `transfer` and `mercadopago` are recorded as already received (`handedOverAt` set), so they never show in `cashPending` or `/api/cash-handover`. Omitting `paymentStatus` (and `cashCollectedCents`) registers no payment.

## Cash to hand over (owner only)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/cash-handover` | - | `{ pendingCents, pendingCount, employees: { userId, name, pendingCents, count, items: { paymentId, date, clientId, clientName, amountCents, visitId }[] }[] (largest first), recent: { paymentId, date, clientId, clientName, amountCents, visitId, userId, userName, handedOverAt }[] (last 30 confirmed) }` |
| POST | `/api/cash-handover/confirm` | `{ paymentIds: number[] (1-500) }` | `{ confirmed, handedOverAt }`; sets `handedOverAt = now`. All-or-nothing: `400` if any id is unknown, not collected by an employee, or already confirmed |

## Clients

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/clients` | query `search?` (name, address, phone, contact), `filter?=debt\|overdue\|all` (default all), `sort?=name\|balance\|overdue` (default name; `overdue` = most days overdue, then amount), `archived?=true\|false` (default false) | `Client[]`: all client columns (`id, name, kind: 'business'\|'home'\|'building', contactName, phone, email, address, area, notes, taxId, monthlyFeeCents, serviceFrequency, defaultServiceTypeId, taxDocType, taxDocNumber, ivaCondition, legalName, archivedAt, createdAt`) + `archived` + `BalanceFields` + `nextVisit: {id,date,time,serviceTypeId,serviceTypeName}\|null` + `lastVisitDate: string\|null` |
| POST | `/api/clients` | `{ name, kind?='business', contactName?, phone?, email?, address?, area?, notes?, taxId?, monthlyFeeCents?, serviceFrequency?='none', defaultServiceTypeId?, taxDocType?='none'\|'cuit'\|'dni', taxDocNumber?, ivaCondition?='consumidor_final'\|'responsable_inscripto'\|'monotributo'\|'exento'\|'no_categorizado', legalName? }` (fiscal data for ARCA: the CUIT checksum / DNI is validated, `400 invalid_cuit`/`invalid_dni`, the number is stored as digits and cleared when `taxDocType='none'`; empty strings become null; `area` is the zone; `serviceFrequency` + `defaultServiceTypeId` are the service plan used by `/api/tracking`; unknown service type -> `404`) | `201` client row |
| GET | `/api/clients/placards` | query `area?` (exact zone) | `{ zones: string[], items: { id, name, address, area, token, url }[] }`: active clients (all, or one zone) with their public link for printing, ordered by zone then name; `zones` = zones with at least one active client. Missing tokens are created |
| GET | `/api/clients/:id` | - | client columns + `archived` + `summary: BalanceFields & { nextVisits: NextVisit[] (up to 5), lastVisitDate, lastFrequency (frequency of latest visit; default for scheduling), counts: { doneVisits, invoices, payments, certificates } }` |
| GET | `/api/clients/:id/months` | - | `DebtByMonth` (below): the client's open debt grouped by month, oldest first. `404` for an unknown client |
| GET | `/api/clients/:id/statement` | - | `{ client, summary (same as above), ledger, invoices, payments, visits, certificates }` (below) |
| PATCH | `/api/clients/:id` | any subset of the create body | updated client row |
| POST | `/api/clients/:id/archive` | - | client row (soft archive; archived clients drop out of lists, batch billing, search) |
| POST | `/api/clients/:id/unarchive` | - | client row |
| GET | `/api/clients/:id/public-link` | - | `{ token, url }`: the client's public link (`<base>/c/<token>`). Every client has a token (created with the client; existing ones were backfilled by migration 0015; a missing one is created on the spot). `<base>` is `PUBLIC_BASE_URL` or, if unset, the origin of the request |
| POST | `/api/clients/:id/public-link/regenerate` | - | `{ token, url }` with a new token; the previous link answers `404` from then on |

### Public link (no login)

| Method | Path | Response |
|---|---|---|
| GET | `/api/public/clients/:token` | `{ name, nextVisit: { date, time, serviceTypeName }\|null, lastVisitDate, certificate: { number, issuedOn, expiresOn, valid, daysLeft }\|null, company: { name, phone } }`. `404 not_found` for an unknown, malformed or archived-client token. `cache-control: no-store`, `x-robots-tag: noindex`. **Deliberately has no amounts, tax id, email, phone, address, notes or employee names**: it is printed on building walls |

The token is 192 random bits (base64url, 32 chars), stored in `clients.public_token` (unique). The SPA page `/c/:token` renders this payload. `company.phone` comes from the setting `companyPhone` (Ajustes > Base de la empresa).

Statement:
- `ledger[]`: chronological `{ date, type: 'invoice'\|'payment', id, reference (invoice number or payment method), description, debitCents, creditCents, balanceCents (running; positive = owes) }`. Voided invoices are excluded. Same day: invoices before payments.
- `invoices[]`: `Invoice` newest first (including voided, flagged `voided`).
- `payments[]`: `{ id, clientId, paidOn, amountCents, method, notes, createdAt, allocations: Allocation[], unallocatedCents }` newest first.
- `visits[]`: `Visit` newest first. `certificates[]`: `Certificate` by expiry desc.

`DebtByMonth`:

```ts
{
  months: {
    month: 'YYYY-MM',           // invoice periodMonth, or the month of issuedOn when it has none
    billedCents, paidCents,     // amounts and allocations of the month's open invoices
    creditAppliedCents,         // unallocated client credit netted here (oldest month first)
    owedCents,                  // billed - paid - creditApplied
    invoices: { id, number, issuedOn, dueOn, description, amountCents, paidCents, balanceCents }[]  // oldest due first
  }[],                          // only months with at least one open (non-voided, unpaid) invoice
  totalOwedCents,               // sum of owedCents = balanceCents whenever the balance is not negative
  creditCents                   // credit left after netting every month
}
```

## Service types and expense categories

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/service-types` | - | `{ id, name, defaultPriceCents, issuesCertificate, certificateValidityDays }[]` by name |
| POST | `/api/service-types` | `{ name, defaultPriceCents?=0, issuesCertificate?=false, certificateValidityDays? }` (days required when issuesCertificate) | `201` row |
| PATCH | `/api/service-types/:id` | subset | row |
| DELETE | `/api/service-types/:id` | - | `{ ok: true }`; `409` if it has visits |
| GET / POST | `/api/expense-categories` | POST `{ name }` | `{ id, name }[]` / `201` row |
| PATCH | `/api/expense-categories/:id` | `{ name }` | row |
| DELETE | `/api/expense-categories/:id` | - | `{ ok: true }`; `409` if used by expenses |

Seeded categories: Nafta, Productos, Herramientas, Mantenimiento, Sueldos, Servicios, Otros.

### Extras (owner only)

Catalog of add-ons the employee (or the owner) bills when closing a visit, e.g. "Cebo" or "Estación cebadera". Employees read the active ones through `GET /api/me/extras`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/extras` | - | `{ id, name, priceCents, active, createdAt }[]` by name (inactive included) |
| POST | `/api/extras` | `{ name, priceCents (>0), active?=true }` | `201` row |
| PATCH | `/api/extras/:id` | subset | row (a price change never touches lines already billed) |
| DELETE | `/api/extras/:id` | - | `{ ok: true }`; `409` once used by a visit (deactivate instead) |

## Visits and agenda

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/visits` | query `from?`, `to?` (inclusive dates), `clientId?`, `status?`, `assignedUserId?` | `Visit[]` ordered by date, time (nulls last), id |
| POST | `/api/visits` | `{ clientId, serviceTypeId, date, time?, frequency?='none', notes?, priceCents?, assignedUserId? }` (assignee must be an active user; `404` unknown, `409` deactivated; `null` unassigns on PATCH) | `201` `Visit` |
| GET | `/api/visits/:id` | - | `Visit` |
| PATCH | `/api/visits/:id` | subset of create body (rescheduling only while `scheduled`) | `Visit` |
| POST | `/api/visits/:id/cancel` | - | `Visit` (`409` unless scheduled) |
| POST | `/api/visits/:id/complete` | see below | see below |
| GET | `/api/agenda/summary` | - | `{ today, tomorrow, thisWeek, overdueScheduled }`: scheduled visit counts; `thisWeek` = today through Sunday of the current Mon-Sun week; `overdueScheduled` = scheduled with date < today |

`POST /api/visits/:id/complete` body (all optional, booleans default false):
`{ completedOn? (default today), priceCents? (default: visit price, then service default), createInvoice, issueCertificate? (default: what the service type does), certificateNumber? (auto-increment numeric if omitted), scheduleNext, nextDate? (default: completedOn + visit frequency), nextTime? (default: same time), notes?, extras?: { extraId, quantity (1-99) }[] }`.
One DB transaction: visit -> `done` (its `date` becomes `completedOn`), invoice (`visitId` link, `dueOn` = issue + 10 days, description = service name), certificate (`expiresOn` = issuedOn + `certificateValidityDays`, 30 days when the type has none), next visit (same client, service, frequency). Response: `{ visit: Visit, invoice: Invoice|null, extras: { extraId, name, quantity, unitPriceCents, amountCents }[], certificate: {id,clientId,visitId,number,issuedOn,expiresOn,createdAt}|null, nextVisit: Visit|null }`.
**Invoice lines and extras.** The invoice gets one line for the base service (when its price is > 0) plus one line per extra at the catalog price of that moment (the same extra twice is merged); `amountCents` is the total of the lines, so ARCA still sees one total. The extras are also stored per visit (`visit_extras`, name and price snapshot). Extras need `createInvoice`; an unknown extra is `404`, an inactive one `400`.
**Oblea rule.** A service type with `issuesCertificate` always issues the oblea on completion (the owner may pass `issueCertificate: false` explicitly; the employee flow cannot). Its base invoice line reads `"<service> (incluye desinfección y oblea)"`.
Errors (`400`): total <= 0 when invoicing, extras without invoice, `issueCertificate: true` for a service that does not issue them, `scheduleNext` without a frequency or `nextDate`. `409`: visit not `scheduled`, or duplicate certificate number (nothing is persisted).

## Monthly service tracking

A client has a **service plan**: `serviceFrequency` (`none` = no plan, not tracked) and `defaultServiceTypeId` (null = any service counts). Archived clients are never tracked.

Expected services per month: `weekly` = number of Mondays in the month (4 or 5); `biweekly` = 2; `monthly` = 1; `bimonthly`/`quarterly`/`semiannual`/`yearly` = 1 only when due (never done, or last done before the month + interval <= last day of the month), else 0. Done = visits with status `done` dated in the month (capped at expected); scheduled = `scheduled` visits dated in the month that cover what is still pending. When the plan has a `defaultServiceTypeId`, only visits of that service count.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/tracking` | query `month?=YYYY-MM` (default current), `zone?` (exact `area`), `status?=pending\|scheduled\|complete` | `{ month, zones: string[] (zones of all tracked clients), totals: { expected, done, scheduled, pendingUnscheduled, clientsTracked }, rows: TrackingRow[] }` |
| POST | `/api/tracking/schedule` | `{ month, items: [{ clientId, date (inside month), time?, serviceTypeId? (default: the plan's), assignedUserId? }] }` (1-300 items) | `201 { created: Visit[] }`; one transaction, visit `frequency` = client plan. `400` if a date is outside the month, the client is archived or has no service to use; `404` unknown client / service |

`TrackingRow = { clientId, name, zone: string|null, frequency, serviceTypeId, serviceTypeName, expected, done, scheduled, pendingUnscheduled, status: 'pending'|'scheduled'|'complete', lastDoneOn: IsoDate|null, daysSinceLast: number|null, nextScheduled: { id, date, time }|null }`. `status`: `pending` = something still to do and not yet scheduled; `scheduled` = everything pending is already scheduled; `complete` = all expected done. Rows are ordered by zone (no zone last) then name; clients not due this month (expected 0) are omitted. `totals` ignores the `status` filter but respects `zone`; `done + scheduled + pendingUnscheduled = expected`. `clientsTracked` counts every client with a plan in the zone filter.

## Emails, month route, settings and reminders (owner only)

Email is sent through an adapter: **Resend** when `RESEND_API_KEY` and `MAIL_FROM` are set, **simulated** otherwise (logged to the console and to `email_log`, nothing leaves the server). Every attempt is stored; a provider failure is recorded as `failed` and never raised to the caller.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/email/status` | - | `{ mode: 'resend'\|'simulated', from }` |
| GET | `/api/email/log` | query `kind?=service_notice\|debt_reminder\|test\|owner_notification\|portal_login`, `clientId?`, `page?=1` (25 per page) | `{ page, pageSize, total, items: { id, kind, clientId, clientName, to, subject, status: 'sent'\|'simulated'\|'failed', error, providerId, refType, refId, sentOn, createdAt }[] }` newest first (no html) |
| GET | `/api/email/log/:id` | - | same item plus `html` |
| POST | `/api/email/test` | `{ to }` | `201` log item (kind `test`) |
| GET / PUT | `/api/settings` | PUT partial `{ debtRemindersEnabled?, debtReminderEveryDays? (>=1), debtReminderMinDaysOverdue? (>=0), noticeMode?: 'on_approve'\|'days_before', noticeDaysBefore? (1-60), arcaAutoEmit?: boolean, companyAddress?: string\|null, companyLatitude?: number\|null (-90..90), companyLongitude?: number\|null (-180..180), companyPhone?: string\|null }` | `AppSettings`; defaults `false, 15, 10, 'on_approve', 7, false, null, null, null, null`. `null` clears a company field (the company base is where the employees' day route starts; no geocoding, the owner types the coordinates) |

**Month route** (`/api/routes`). A `route_plan` per month (`draft` -> `approved`) holds items (client, date, time, service, assignee, zone). Zone = client `area`.
Generation takes every client with a service plan whose month still has pending services not yet scheduled (same rule as `/api/tracking`; clients with a visit already scheduled or done are excluded) and proposes dates: weekly = one per week, biweekly = weeks 1 and 3, longer plans = one. Each zone gets one weekday (zones balanced across Mon-Fri, heaviest first), capped at 12 visits per day; see `planMonthRoute` in `shared/src/routePlan.ts`. For the current month only dates after today are proposed; past months answer `400`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/routes/:month` | - | `{ month, noticeMode, noticeDaysBefore, plan: { id, month, status, approvedAt, notifiedAt } \| null, totals: { visits, clients, withEmail, withoutEmail, notices, noticesSent, noticesSimulated, noticesFailed, noticesScheduled }, zones: { zone: string\|null, count, dates: { date, items: RouteItem[] }[] }[] }`; `RouteItem = { id, clientId, clientName, hasEmail, email, address, date, time, serviceTypeId, serviceTypeName, frequency, assignedUserId, assigneeName, zone, visitId, notice: { state: 'no_email'\|'pending'\|'scheduled'\|'sent'\|'simulated'\|'failed', dueOn, emailLogId } }` |
| POST | `/api/routes/:month/generate` | - | route view plus `skipped: { clientId, name, reason }[]` (plans without a habitual service). Replaces a draft; `409 route_approved` once approved |
| PATCH | `/api/routes/items/:id` | `{ date? (inside the month), time? \| null, assignedUserId? \| null }` | route view. Draft only (`409` after approval) |
| DELETE | `/api/routes/items/:id` | - | route view. Draft only |
| POST | `/api/routes/:month/items` | `{ clientId, date, time?, serviceTypeId?, assignedUserId? }` | `201` route view (creates the draft if needed) |
| POST | `/api/routes/:month/approve` | - | route view plus `notices: { sent, simulated, failed }`. One transaction creates a `scheduled` visit per item (frequency = client plan, assignee), then notices go out outside it: `on_approve` sends now; `days_before` sends when `visit date - N <= today` (already-due ones go now, the rest wait for the daily job). Clients without email get no notice. Failed sends do not undo visits and are retried by the daily job while the visit is still ahead |

**Debt reminders and the daily job.** A client gets a reminder when reminders are enabled, it has an email, its overdue balance is positive, its oldest overdue invoice is at least `debtReminderMinDaysOverdue` days late and no `debt_reminder` was sent or simulated to it in the last `debtReminderEveryDays` days (business date stored in `email_log.sentOn`). The email lists overdue invoices (number, due date, balance) and the total.

| Method | Path | Response |
|---|---|---|
| GET | `/api/reminders/preview` | `{ today, enabled, everyDays, minDaysOverdue, recipients: { clientId, name, email, overdueCents, daysOverdue, overdueInvoiceCount, lastReminderOn }[], skipped: { disabled, no_email, not_overdue, not_late_enough, too_recent } }`; computed as if enabled |
| POST | `/api/reminders/send` | `{ sent, simulated, failed }`. Manual "send now": ignores the on/off switch, keeps the interval rule |
| POST | `/api/jobs/run-daily` | `{ date, notices: {sent,simulated,failed}, reminders: {sent,simulated,failed} }`. Runs due service notices then debt reminders; idempotent |

An in-process scheduler checks hourly and runs the daily job once per Buenos Aires day, from 09:00 on, guarded by a `job_runs` row (unique per job and day) so restarts never double-run. Single instance only.

**Notification jobs.** The same hourly tick runs three time-slotted jobs, each claimed once per Buenos Aires day in `job_runs` (a restart later in the day catches up) and idempotent through the notification dedupe key (`userId:kind:ref:day`):

| Job (`job_runs.job`) | Window | Who | What |
|---|---|---|---|
| `notify_morning` | from 09:00 | assignees; admins | `visits_today` to each active user with `scheduled` visits today (count and first time); `visits_overdue` to every active admin when visits from earlier days are still `scheduled` |
| `notify_afternoon` | 17:00 to 20:00 | assignees | `visits_reminder` to users that still have unmarked visits today |
| `notify_evening` | from 20:00 | admins | `day_summary`: visits done / pending today, collected today (all payments by `paidOn`) and cash employees still have to hand over (`/api/cash-handover`). Skipped on a day with nothing to report |

Admin notifications (`visits_overdue`, `day_summary`, `client_email_failed`) go to every **active admin user** in the bell and, when the admin has an `email`, by email too (`email_log.kind = 'owner_notification'`, no client). A client email that ends `failed` (service notice or debt reminder, where `sendLogged` records it) creates one `client_email_failed` notification per client, email kind and day; a failing admin copy is logged but never notifies again. Employees only get bell notifications.

## Invoices and monthly billing

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/invoices` | query `status?=pending\|partial\|overdue\|paid\|void`, `clientId?`, `from?`, `to?` (issue date range) | `(Invoice & { clientName })[]` newest first; voided excluded unless `status=void` |
| POST | `/api/invoices` | `{ clientId, amountCents (>0), issuedOn?=today, dueOn?=issuedOn+10, description?, visitId?, periodMonth? }` | `201` `Invoice`; number auto `YYYY-NNNN` (per issue year) |
| GET | `/api/invoices/:id` | - | `Invoice & { clientName }` |
| POST | `/api/invoices/:id/void` | - | voided invoice; payments allocated to it are released as client credit |
| POST | `/api/invoices/monthly-batch/preview?month=YYYY-MM` | - | `{ month, label, clients: { clientId, name, monthlyFeeCents }[], totalCents, alreadyInvoicedCount }`: active clients with a fee and no non-voided invoice with `periodMonth = month` |
| POST | `/api/invoices/monthly-batch` | `{ month, clientIds[] }` | `201 { month, created: Invoice[], skipped: { clientId, reason }[], totalCents }` in one transaction (issued today, due +10, `periodMonth` set, description `Abono mensual <mes> <año>`); clients already invoiced / without fee / archived are skipped, not errors |

Every invoice also carries its ARCA state (see "ARCA" below): `arcaStatus: 'not_sent'\|'authorized'\|'rejected'\|'error'`, `cbteType` (1 A, 6 B, 11 C), `ptoVta`, `cbteNumber`, `cae`, `caeDueOn`, `arcaObservations: { observations, errors, message? } \| null`, `arcaAttemptedAt`. The internal `number` is never changed.

## ARCA electronic invoicing (owner only)

Inactive until `ARCA_ENV`, `ARCA_CUIT`, `ARCA_CERT`, `ARCA_KEY`, `ARCA_PTO_VTA` and `ARCA_TAX_CONDITION` are all set and valid; nothing in the invoicing flow changes before that. Details, sources and unverified points in [arca.md](arca.md).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/arca/status` | - | `{ configured, env: 'homologacion'\|'produccion'\|null, cuit (masked, `20-****5678-6`), ptoVta, taxCondition, missing: string[] (variable names) }`. Never returns certificate, key or tokens |
| POST | `/api/arca/check` | - | `{ ok, steps: { name: 'dummy'\|'login'\|'last_authorized', ok, detail }[] }`: FEDummy, WSAA login, FECompUltimoAutorizado. `409 arca_not_configured` when inactive |
| POST | `/api/invoices/:id/arca` | - | `200` invoice (`authorized` with CAE, or `rejected`/`error` with `arcaObservations`; the failure is stored, retry with the same call). `409 arca_not_configured`, `409 already_authorized`, `409` voided, `400 arca_invalid_data` (e.g. Factura A without a valid client CUIT; nothing is sent) |

Emissions are serialized in-process (numbering is sequential per point of sale and type). A retry after an unknown outcome reconciles with `FECompUltimoAutorizado`/`FECompConsultar` before asking for a new number. With setting `arcaAutoEmit` on, invoices created by `POST /api/invoices`, visit completion (owner and employee) and the monthly batch are emitted in the background after they are saved; failures leave the invoice in `error`/`rejected` and never fail the creation.

## Payments

| Method | Path | Body / query | Response |
|---|---|---|---|
| POST | `/api/payments` | `{ clientId, amountCents (>0), paidOn?=today, method?='cash' ('cash'\|'transfer'\|'mercadopago'\|'check'\|'other'), notes?, invoiceId? }` | `201 { payment, allocations: Allocation[], creditCents (unallocated part), client: { id } & BalanceFields }`. FIFO by due date over the client's open invoices; with `invoiceId` that invoice is paid first, then FIFO; any remainder is credit. `400` if `invoiceId` is not an open invoice of the client |
| GET | `/api/payments` | query `from?`, `to?`, `clientId?` | `{ ...payment, clientName, allocations, unallocatedCents }[]` newest first |
| DELETE | `/api/payments/:id` | - | `{ ok: true, client: { id } & BalanceFields }` (allocations removed; invoices reopen) |

"Cobrar todo" = `amountCents` equal to the client's `balanceCents`.

## Cash entries and finance

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/cash-entries` | query `month?` (default current), `kind?=expense\|income` | `{ id, kind, date, amountCents, categoryId, categoryName, description, method }[]` newest first |
| POST | `/api/cash-entries` | `{ kind: 'expense'\|'income', amountCents (>0), date?=today, categoryId (required for expense), description?, method?='cash' }` | `201` entry (manual entries only; client payments are NOT copied here) |
| PATCH | `/api/cash-entries/:id` | `{ date?, amountCents?, categoryId?, description?, method? }` | entry |
| DELETE | `/api/cash-entries/:id` | - | `{ ok: true }` |
| GET | `/api/finance/summary?month=YYYY-MM` (default current) | - | `{ month, incomeCents, paymentsCents, otherIncomeCents, expensesCents, balanceCents, byCategory: { categoryId, name, totalCents, share (percent, 1 decimal) }[] (desc), previous: { month, ...same figures }, series: { month, incomeCents, paymentsCents, otherIncomeCents, expensesCents, balanceCents }[6] (oldest first, ending at month) }` |
| GET | `/api/finance/movements?month=` | - | `{ month, movements: { type: 'payment'\|'income'\|'expense', id, date, direction: 'in'\|'out', amountCents (positive), method, description, clientId, clientName, categoryId, categoryName }[] }` date desc. Ids are per type (payment id vs cash entry id) |

Income = payments (by `paidOn`) + manual incomes; balance = income - expenses.

## Receivables, certificates, dashboard, search

| Method | Path | Response |
|---|---|---|
| GET | `/api/receivables` | `{ owedCents (sum of positive client balances), overdueCents, openInvoicesCents, overdueInvoicesCents, overdueInvoiceCount, debtorCount, buckets: { bucket, totalCents, invoiceCount, clientCount }[5] (current, 1-30, 31-60, 61-90, 90+; per open invoice, credit not netted), debtors: ({ clientId, name, phone, overdueSince, oldestOwedMonth: 'YYYY-MM'\|null, owedMonthCount } & BalanceFields)[] }` (`oldestOwedMonth`/`owedMonthCount`: months that still owe after netting credit, see `DebtByMonth`) debtors = clients with `balanceCents > 0`, sorted by `daysOverdue` desc then `balanceCents` desc |
| GET | `/api/certificates?expiringWithinDays=15&clientId=` | `Certificate[]` by expiry asc. With `expiringWithinDays`: only non-superseded certificates of active clients with `expiresOn <= today + N` (already expired included, `daysLeft < 0`). A certificate is superseded when the client has a newer one for the same service type. Each item has `hasFile` (a PDF is stored) |
| GET | `/api/certificates/:id/file` | - | The certificate PDF (`application/pdf`, `Content-Disposition: inline; filename="oblea-<number>.pdf"`). `404` when the certificate has no stored file. Owner only (`401` without session, `403` for employees) |
| GET | `/api/dashboard` | see below |
| GET | `/api/search?q=` | `{ clients: { id, name, kind, address, phone }[] }` max 10, active clients, matches name/address/phone/contact (case-insensitive). `q` is required (1-100 chars) |

`GET /api/dashboard`:

```ts
{
  today: IsoDate,
  month: { month, incomeCents, expensesCents, balanceCents,
           previous: { month, incomeCents, expensesCents, balanceCents } },
  receivables: { owedCents, overdueCents, debtorCount, overdueInvoiceCount },
  agenda: { today, tomorrow, thisWeek, overdueScheduled },
  todayVisits: Visit[],                       // non-cancelled, by time
  topDebtors: { clientId, name, phone, balanceCents, overdueCents, daysOverdue, agingBucket }[],  // max 8
  expiringCertificates: Certificate[],        // <= 15 days (or expired), not superseded
  services: { doneThisMonth, doneLastMonth }, // done visits by visit date
  clientsWithoutNextVisit: number,            // active clients with a visit in the last 120 days and nothing scheduled from today on
  tracking: { month, expected, done, scheduled, pendingUnscheduled, clientsTracked },  // current month, same rules as GET /api/tracking
  cashPendingCents: number, cashPendingCount: number   // employee cash not yet confirmed by the owner
}
```

## Notes and known limits

- Client credit (unallocated payment remainder) is netted in `balanceCents`/`overdueCents` but is not auto-applied to invoices created later; it stays visible as `creditCents`.
- List endpoints are not paginated (single-operator data volumes).
- `POST /api/auth/login` throttling is in-memory per process.
