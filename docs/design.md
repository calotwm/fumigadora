# Fumigadora — Product & Technical Design

Management system for a pest-control company. Single owner/operator uses it daily on PC and phone.
The legacy system ("Plagamix") is a functional reference only.

## 1. Legacy UX problems (from screenshots)

| # | Problem | Consequence | Fix in new design |
|---|---------|-------------|-------------------|
| 1 | Debt total renders `$1.2462.508,719999999` (float math + broken thousands format) | Owner cannot trust money figures | Money stored as integer cents; single `formatMoney` (es-AR) everywhere |
| 2 | Two cards titled "Deuda" (108 clients / amount) | Ambiguous, duplicated headline | One "Te deben" block: amount + clients + overdue split |
| 3 | Debtors list sorted alphabetically, no age | Cannot see who to chase first | Sorted by overdue days × amount; aging buckets 0–30/31–60/61–90/90+ |
| 4 | Empty "Citas de hoy" panel takes half the screen | Wasted prime space | Empty states are one line + action; space goes to next items |
| 5 | Only action per row is an eye icon | Every task needs navigation | Inline actions: Cobrar, WhatsApp, Ver |
| 6 | Cash flow incomes typed as free text ("Pago Plaza Agosto") | Double entry; account balance never updates | Payments are linked to client (and allocated to invoices); they feed cash flow automatically |
| 7 | Payment-method tags illegible / empty | Lost information | Method is a required enum, rendered as plain text label |
| 8 | Row actions hidden in kebab menu | Discoverability | Primary action visible; secondary in detail view |
| 9 | Month balance is a single number | No comparison or category insight | Monthly summary, month-over-month delta, expense categories breakdown |
| 10 | Calendario / Citas / Hoja de ruta are 3 nav items for one dataset | Navigation overhead | One "Agenda" module with Day (route) / Week / Month / Upcoming views |
| 11 | "Obleas por vencer" exists but hidden in a stat | Legal certificate renewals missed | Certificates are an entity with expiry alerts and one-tap renewal visit |

## 2. Architecture

- Single Railway service. Node 22+ server (Hono) serves the JSON API under `/api` and the built SPA.
- Database: PostgreSQL (Railway plugin, `DATABASE_URL`). Local dev and tests use PGlite (embedded Postgres) when `DATABASE_URL` is unset — no Docker needed.
- ORM: Drizzle (schema in TS, SQL migrations committed).
- Frontend: Vite + React + TypeScript, React Router, TanStack Query, Tailwind CSS v4. No component library.
- Auth: users with username + password and role `admin` or `employee` (optional unique email; `assignable` flag = can receive visits, on by default for employees, off for admins). Login sets an HMAC-signed httpOnly cookie (`SESSION_SECRET`). `ADMIN_PASSWORD` stays as emergency owner access (password only, no user row, no notifications); the admin shell nudges the owner to create an admin user while none is active.
- Client portal: a third role, `client`, signs in with a magic link emailed to the client's (or a contact's) address. The session is the same signed cookie, valid 30 days, carrying the `clientId`; `/api/portal/*` is the only API it reaches and every query is scoped to that id. The staff guard is deny-by-default, so a client session gets `403` on every admin and employee route. Web: `/portal` (login and account), `/portal/entrar` (spends the link, shows a picker when an email belongs to several clients).
- Domain rules (money, invoice status, allocation, aging, recurrence) live in a pure `shared/domain` module used by server and covered by unit tests (Vitest).
- Derived values are computed, never stored twice: invoice status and balances derive from invoices + allocations; monthly income derives from payments + manual incomes.

```
repo/
  shared/     pure domain: money, dates, invoice status, allocation, aging, recurrence (+ tests)
  server/     Hono app, Drizzle schema, migrations, services, routes, seed
  web/        Vite React SPA
  docs/
```

## 3. Entities

All money columns are integer cents (`bigint`). Dates are `date`; visit time is `time`.

- **Client**: id, name, kind (`business` | `home` | `building`), contactName, phone, email, address, area, notes, taxId, monthlyFeeCents (nullable — recurring "abono"), archivedAt, createdAt.
- **ServiceType**: id, name (Desinsectación, Desratización, Desinfección, Control de palomas, Limpieza de tanque…), defaultPriceCents, issuesCertificate (bool), certificateValidityDays.
- **Extra**: id, name, priceCents, active. Add-ons (bait, bait stations...) billed when a visit is closed; deactivated, never deleted, once used. **VisitExtra**: visitId, extraId, name/quantity/unitPriceCents snapshot.
- **Visit**: id, clientId, serviceTypeId, date, time (nullable), status (`scheduled` | `done` | `cancelled`), frequency (`none` | `weekly` | `biweekly` | `monthly` | `bimonthly` | `quarterly` | `semiannual` | `yearly`), notes, completedAt, cancelReason (set when the employee cancels), priceCents (nullable).
- **Certificate** (oblea): id, clientId, visitId, number, issuedOn, expiresOn.
- **ClientLoginToken**: tokenHash (sha256, unique), email, expiresAt (30 min), usedAt. Magic link of the client portal; single use. Email kind `portal_login`.
- **Client.publicToken**: unguessable token (192 bits) of the public page `/c/<token>` that the QR placard opens. Shows next visit and oblea validity only; regenerating it invalidates the old link.
- **Invoice**: id, clientId, visitId (nullable), number (auto, per-year sequence), issuedOn, dueOn, amountCents, description, voidedAt. **InvoiceItem**: invoiceId, position, description, quantity, unitPriceCents, amountCents, extraId (null for the base service). `amountCents` is always the sum of the lines; invoices without rows (legacy, manual, monthly fee) render as one line from description and amount.
- **Payment**: id, clientId, paidOn, amountCents, method (`cash` | `transfer` | `mercadopago` | `check` | `other`), notes.
- **Allocation**: id, paymentId, invoiceId, amountCents. Payments auto-allocate FIFO to oldest open invoices unless a specific invoice is chosen. Unallocated remainder = client credit.
- **Notification**: id, userId (cascade), kind, title, body, link (in-app route), refType/refId, dedupeKey (unique: `userId:kind:refType:refId:businessDate`, so a job rerun never repeats one), groupKey/groupCount/groupAmountCents (live alerts: a burst of the same employee and kind updates one unread notification), readAt, createdAt. Addressed to one user and shown in the bell (admin shell and employee app, polled every 60 s); the emergency owner session has none.
- **PushSubscription**: id, userId (cascade), endpoint (unique), p256dh, auth, userAgent, createdAt, lastUsedAt. One row per device; notifications are also delivered through Web Push (VAPID) and dead endpoints are pruned. The web app is an installable PWA whose service worker only handles push.
- **EmailLog** kinds: `service_notice`, `debt_reminder`, `test` (to clients), `portal_login` (magic link of the client portal) and `owner_notification` (copy of an admin notification, no client).
- **ExpenseCategory**: id, name (Nafta, Productos, Herramientas, Mantenimiento, Sueldos, Servicios, Otros).
- **CashEntry**: id, kind (`expense` | `income`), date, amountCents, categoryId (expense only), description, method. Manual entries only; client payments are NOT copied here.

### Derived rules (shared/domain)
- Invoice paid = sum(allocations). Status: `paid` if paid ≥ amount; `partial` if 0 < paid < amount; `overdue` if unpaid balance > 0 and today > dueOn; else `pending`. (`overdue` wins over `partial` for listing, with a `partial` flag kept.)
- Client balance = sum(open invoice balances) − unallocated credit.
- Days overdue = today − oldest unpaid dueOn.
- Aging bucket by days overdue: current, 1–30, 31–60, 61–90, 90+.
- Next visit date = date + frequency.
- Monthly income = payments in month + manual incomes; expenses = manual expenses; balance = income − expenses.

## 4. Key flows (minimum steps)

1. **Cobrar** (from dashboard debtor row, client list, or client sheet): modal pre-filled with client balance → confirm. One tap for "pays everything". Auto-allocates, updates invoice status, account, month income.
2. **Facturar**: from client sheet; amount pre-filled from monthlyFee or service price; dueOn defaults issuedOn + 10 days.
3. **Facturar abonos del mes** (batch): lists all clients with monthlyFee and no invoice this month → one confirm generates all invoices.
4. **Completar visita** (from agenda/today): one sheet with checkboxes, all on by default when applicable:
   - mark done, - create invoice for price (base service line plus one line per extra picked from the catalog), - issue certificate (always, when the service type issues one: the base service includes disinfection and oblea; number + expiry auto), - schedule next visit per frequency.
5. **Agendar visita**: from client sheet or agenda empty slot; client autocomplete; frequency defaults to client's last frequency.
6. **Registrar gasto**: global quick-add (`+` button / `N` key) → amount, category chips, date defaults today.
7. **Recordatorio WhatsApp**: `wa.me` link with prefilled text (debt reminder or visit reminder). No external API.
8. **Cerrar visita (empleado, celular)**: "Marcar hecho" opens one sheet: extras from the catalog (+/- steppers), live total, "Pagó todo / Pagó una parte / No pagó", method chips (efectivo, transferencia, Mercado Pago) and the amount for a partial payment. The payment goes to this visit's invoice first, then to older debt; only cash is "a rendir". Admins get one alert with the payment outcome and, if any, another with the extras.
9. **El cliente canceló (empleado)**: secondary action on each pending visit. Posponer (new date, default the next Mon-Sat day, optional time) or Cancelar (reason required; a recurring visit schedules its next occurrence). Admins are alerted either way.
10. **Recorrido del día (empleado)**: the day list is the route. Timed visits by time, then the rest nearest-neighbour (haversine, `shared/dayRoute.ts`) from the company base (Ajustes > Base de la empresa; without it, from the first visit that has coordinates), clients without coordinates last. The first pending visit is highlighted, a progress bar reads "3 de 7 hechas", done visits collapse at the bottom, and "Abrir recorrido en Google Maps" opens directions with the stops in order (links of up to 10 stops: "Recorrido 1/2", "2/2"). Each card: Marcar hecho (primary), Llamar, WhatsApp, Mapa, El cliente canceló.

## 5. Navigation

Desktop: left rail. Mobile: bottom bar (5 items) + floating `+`.
- **Hoy** (dashboard)
- **Agenda** (Día/ruta, Semana, Mes, Próximas)
- **Clientes** (list + client sheet)
- **Cobranzas** (receivables: aging board, invoices list, batch billing)
- **Finanzas** (month summary, compare, categories, movements)
- Ajustes (service types, categories) — in rail footer / overflow on mobile.

Global: command palette `Ctrl+K` (search client, quick actions).

## 6. Dashboard ("Hoy")

Order = priority. Asymmetric 12-col grid.
1. Top strip (big numerals): Ingresó este mes · Gastos · Balance · Te deben (with overdue part).
2. Left (8 cols): **Agenda** — Hoy N / Mañana N / Esta semana N counters, then today's visits list with "Completar" action.
3. Right (4 cols): **Cobrar primero** — top debtors by days overdue, each with amount, "vencido hace X días", Cobrar + WhatsApp.
4. Alerts row: facturas vencidas count, obleas por vencer (≤15 days), clientes sin visita programada.
5. Month stats: servicios realizados este mes vs mes anterior.

## 7. Visual language (Swiss / International Typographic Style)

- Inter (400/500/700/800), tabular numerals for all money.
- Palette: `--ink #0a0a0a`, `--paper #ffffff`, `--paper-2 #f4f4f2`, `--rule #d9d9d6`, `--red #e10600` (only for: overdue/debt, primary action, active nav marker). No gradients.
- 8px base grid; 12-column layout; radius 0–2px; 1px rules as dividers; heavy 4px black top rule on section headers.
- Subtle texture: CSS dot/line grid pattern on page background and empty states (low opacity).
- Type scale: 12 / 14 / 16 / 20 / 28 / 40 / 64. Big numerals for KPIs. Uppercase tracked labels at 11–12px.
- Focus states visible (2px red outline). Touch targets ≥ 44px on mobile.
- UI copy in Spanish (es-AR locale formatting); code and identifiers in English.
