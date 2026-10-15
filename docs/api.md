# Fumigadora API

REST JSON under `/api`. Conventions:

- Money is always an **integer number of cents** (`amountCents: 15000000` = `$ 150.000,00`). Format on the client with `formatMoney` from `@fumigadora/shared`.
- Dates are ISO strings `YYYY-MM-DD`; months are `YYYY-MM`; visit times are `HH:MM`.
- "Today" is the calendar date in `America/Argentina/Buenos_Aires`.
- Auth: two roles. The **owner** (`admin`) logs in with the shared `ADMIN_PASSWORD` (no username); **employees** log in with `username` + `password` (stored as scrypt hashes). `POST /api/auth/login` sets an httpOnly `fumigadora_session` cookie (SameSite=Lax, Secure in production) whose signed payload carries role and user id. Every route except `/api/health` and `/api/auth/*` answers `401` without a session. `/api/me/*` is open to employees; **every other route requires role `admin` and answers `403 forbidden` to employees**. Send requests with `credentials: 'same-origin'`.
- Errors: `{ "error": { "code": string, "message": string (Spanish, user-facing), "details"?: any } }`.
  Status codes: `400` validation (`code: "validation"`, `details.issues[{path,message}]`) or business rule, `401` unauthorized, `403` forbidden (role), `404` not found, `409` conflict / duplicate, `429` login throttled, `500` internal.
- Request bodies are JSON (`content-type: application/json`). In the "Body" columns `?` means optional and `x | null` accepts null.
- Derived values (balances, invoice status, aging) are computed on every read; never stored.

Environment: `ADMIN_PASSWORD` (owner login; employees are created in the app), `SESSION_SECRET` (required when `NODE_ENV=production`; insecure dev defaults with a console warning otherwise), `DATABASE_URL` (Postgres; unset = embedded PGlite at `PGLITE_DIR`, default `./.data/pglite` relative to `server/`), `PORT` (default 3000).

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
  paidCents, balanceCents, isPartial: boolean, daysOverdue
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
| POST | `/api/auth/login` | owner: `{ password }`; employee: `{ username, password }` (username is case-insensitive) | `{ authenticated: true, role: 'admin'\|'employee', userId?, name }` + cookie. `401 invalid_credentials` (also for deactivated users); `429` after 8 failures per IP / 10 min (shared by both logins) |
| POST | `/api/auth/logout` | - | `{ authenticated: false }` |
| GET | `/api/auth/me` | - | `{ authenticated: true, role, userId?, name }` or `401`. The owner login has no `userId` and name `Dueño`. Deactivated employees get `401` immediately |

Sessions issued before employee accounts existed (no role in the cookie) are rejected: log in again.

## Users (owner only)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/users` | - | `{ id, name, phone, username, role: 'admin'\|'employee', active, createdAt }[]` by name. Password hashes are never returned |
| POST | `/api/users` | `{ name, phone?, username (3-40: a-z 0-9 . _ -, lowercased), password (>= 6), role?='employee' }` | `201` user; `409 duplicate` if the username exists |
| PATCH | `/api/users/:id` | `{ name?, phone?, username?, role?, active? }` | user. `active: false` deactivates: the employee can no longer log in and existing sessions stop working at once |
| POST | `/api/users/:id/password` | `{ password (>= 6) }` | `{ ok: true }` |

## Employee routes (`/api/me`, employees and admin)

An employee always acts as themselves. The owner may pass `?userId=` to act as an employee (testing); without it `400`.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/me/visits` | query `date?=today` | `{ date, visits: (Visit & { clientBalanceCents, cashCollectedCents })[], cashPending: { cents, count } }`. Only visits assigned to the caller, cancelled hidden, ordered by time. `cashCollectedCents` = cash this employee registered for that visit; `cashPending` = all cash of the caller not yet confirmed by the owner |
| POST | `/api/me/visits/:id/done` | `{ cashCollectedCents? (> 0), notes? }` | `{ visit, invoice, certificate, nextVisit, payment: <POST /api/payments response>\|null }`. `404` if the visit is not assigned to the caller (same answer as unknown id); `409` if not `scheduled`. One transaction |

Completion defaults (same engine as `POST /api/visits/:id/complete`): invoice only when the visit has its own price > 0, next visit when the visit has a frequency (same assignee), certificate when the service type issues one. With `cashCollectedCents` a `cash` payment is registered for the visit's client (FIFO allocation) with `collectedByUserId`, `visitId` and `handedOverAt = null` ("a rendir").

## Cash to hand over (owner only)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/cash-handover` | - | `{ pendingCents, pendingCount, employees: { userId, name, pendingCents, count, items: { paymentId, date, clientId, clientName, amountCents, visitId }[] }[] (largest first), recent: { paymentId, date, clientId, clientName, amountCents, visitId, userId, userName, handedOverAt }[] (last 30 confirmed) }` |
| POST | `/api/cash-handover/confirm` | `{ paymentIds: number[] (1-500) }` | `{ confirmed, handedOverAt }`; sets `handedOverAt = now`. All-or-nothing: `400` if any id is unknown, not collected by an employee, or already confirmed |

## Clients

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/clients` | query `search?` (name, address, phone, contact), `filter?=debt\|overdue\|all` (default all), `sort?=name\|balance\|overdue` (default name; `overdue` = most days overdue, then amount), `archived?=true\|false` (default false) | `Client[]`: all client columns (`id, name, kind: 'business'\|'home'\|'building', contactName, phone, email, address, area, notes, taxId, monthlyFeeCents, serviceFrequency, defaultServiceTypeId, archivedAt, createdAt`) + `archived` + `BalanceFields` + `nextVisit: {id,date,time,serviceTypeId,serviceTypeName}\|null` + `lastVisitDate: string\|null` |
| POST | `/api/clients` | `{ name, kind?='business', contactName?, phone?, email?, address?, area?, notes?, taxId?, monthlyFeeCents?, serviceFrequency?='none', defaultServiceTypeId? }` (empty strings become null; `area` is the zone; `serviceFrequency` + `defaultServiceTypeId` are the service plan used by `/api/tracking`; unknown service type -> `404`) | `201` client row |
| GET | `/api/clients/:id` | - | client columns + `archived` + `summary: BalanceFields & { nextVisits: NextVisit[] (up to 5), lastVisitDate, lastFrequency (frequency of latest visit; default for scheduling), counts: { doneVisits, invoices, payments, certificates } }` |
| GET | `/api/clients/:id/statement` | - | `{ client, summary (same as above), ledger, invoices, payments, visits, certificates }` (below) |
| PATCH | `/api/clients/:id` | any subset of the create body | updated client row |
| POST | `/api/clients/:id/archive` | - | client row (soft archive; archived clients drop out of lists, batch billing, search) |
| POST | `/api/clients/:id/unarchive` | - | client row |

Statement:
- `ledger[]`: chronological `{ date, type: 'invoice'\|'payment', id, reference (invoice number or payment method), description, debitCents, creditCents, balanceCents (running; positive = owes) }`. Voided invoices are excluded. Same day: invoices before payments.
- `invoices[]`: `Invoice` newest first (including voided, flagged `voided`).
- `payments[]`: `{ id, clientId, paidOn, amountCents, method, notes, createdAt, allocations: Allocation[], unallocatedCents }` newest first.
- `visits[]`: `Visit` newest first. `certificates[]`: `Certificate` by expiry desc.

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
`{ completedOn? (default today), priceCents? (default: visit price, then service default), createInvoice, issueCertificate, certificateNumber? (auto-increment numeric if omitted), scheduleNext, nextDate? (default: completedOn + visit frequency), nextTime? (default: same time), notes? }`.
One DB transaction: visit -> `done` (its `date` becomes `completedOn`), invoice (`visitId` link, `dueOn` = issue + 10 days, description = service name), certificate (`expiresOn` = issuedOn + `certificateValidityDays`), next visit (same client, service, frequency). Response: `{ visit: Visit, invoice: Invoice|null, certificate: {id,clientId,visitId,number,issuedOn,expiresOn,createdAt}|null, nextVisit: Visit|null }`.
Errors (`400`): price <= 0 when invoicing, service does not issue certificates, `scheduleNext` without a frequency or `nextDate`. `409`: visit not `scheduled`, or duplicate certificate number (nothing is persisted).

## Monthly service tracking

A client has a **service plan**: `serviceFrequency` (`none` = no plan, not tracked) and `defaultServiceTypeId` (null = any service counts). Archived clients are never tracked.

Expected services per month: `weekly` = number of Mondays in the month (4 or 5); `biweekly` = 2; `monthly` = 1; `bimonthly`/`quarterly`/`semiannual`/`yearly` = 1 only when due (never done, or last done before the month + interval <= last day of the month), else 0. Done = visits with status `done` dated in the month (capped at expected); scheduled = `scheduled` visits dated in the month that cover what is still pending. When the plan has a `defaultServiceTypeId`, only visits of that service count.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/tracking` | query `month?=YYYY-MM` (default current), `zone?` (exact `area`), `status?=pending\|scheduled\|complete` | `{ month, zones: string[] (zones of all tracked clients), totals: { expected, done, scheduled, pendingUnscheduled, clientsTracked }, rows: TrackingRow[] }` |
| POST | `/api/tracking/schedule` | `{ month, items: [{ clientId, date (inside month), time?, serviceTypeId? (default: the plan's), assignedUserId? }] }` (1-300 items) | `201 { created: Visit[] }`; one transaction, visit `frequency` = client plan. `400` if a date is outside the month, the client is archived or has no service to use; `404` unknown client / service |

`TrackingRow = { clientId, name, zone: string|null, frequency, serviceTypeId, serviceTypeName, expected, done, scheduled, pendingUnscheduled, status: 'pending'|'scheduled'|'complete', lastDoneOn: IsoDate|null, daysSinceLast: number|null, nextScheduled: { id, date, time }|null }`. `status`: `pending` = something still to do and not yet scheduled; `scheduled` = everything pending is already scheduled; `complete` = all expected done. Rows are ordered by zone (no zone last) then name; clients not due this month (expected 0) are omitted. `totals` ignores the `status` filter but respects `zone`; `done + scheduled + pendingUnscheduled = expected`. `clientsTracked` counts every client with a plan in the zone filter.

## Invoices and monthly billing

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/invoices` | query `status?=pending\|partial\|overdue\|paid\|void`, `clientId?`, `from?`, `to?` (issue date range) | `(Invoice & { clientName })[]` newest first; voided excluded unless `status=void` |
| POST | `/api/invoices` | `{ clientId, amountCents (>0), issuedOn?=today, dueOn?=issuedOn+10, description?, visitId?, periodMonth? }` | `201` `Invoice`; number auto `YYYY-NNNN` (per issue year) |
| GET | `/api/invoices/:id` | - | `Invoice & { clientName }` |
| POST | `/api/invoices/:id/void` | - | voided invoice; payments allocated to it are released as client credit |
| POST | `/api/invoices/monthly-batch/preview?month=YYYY-MM` | - | `{ month, label, clients: { clientId, name, monthlyFeeCents }[], totalCents, alreadyInvoicedCount }`: active clients with a fee and no non-voided invoice with `periodMonth = month` |
| POST | `/api/invoices/monthly-batch` | `{ month, clientIds[] }` | `201 { month, created: Invoice[], skipped: { clientId, reason }[], totalCents }` in one transaction (issued today, due +10, `periodMonth` set, description `Abono mensual <mes> <año>`); clients already invoiced / without fee / archived are skipped, not errors |

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
| GET | `/api/receivables` | `{ owedCents (sum of positive client balances), overdueCents, openInvoicesCents, overdueInvoicesCents, overdueInvoiceCount, debtorCount, buckets: { bucket, totalCents, invoiceCount, clientCount }[5] (current, 1-30, 31-60, 61-90, 90+; per open invoice, credit not netted), debtors: ({ clientId, name, phone } & BalanceFields)[] }` debtors = clients with `balanceCents > 0`, sorted by `daysOverdue` desc then `balanceCents` desc |
| GET | `/api/certificates?expiringWithinDays=15&clientId=` | `Certificate[]` by expiry asc. With `expiringWithinDays`: only non-superseded certificates of active clients with `expiresOn <= today + N` (already expired included, `daysLeft < 0`). A certificate is superseded when the client has a newer one for the same service type |
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
