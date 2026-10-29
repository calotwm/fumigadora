# Feature: employee-app

## Objective
Make the employee PWA the daily tool in the field: ordered route, extras with their own prices billed on the invoice, payment status when closing a visit, postpone/cancel when the client cancels, a simpler UI, and live alerts to admins for each of these (meeting items 6, 7, 8, 9, 10).

## Problem / why
Today the employee can only mark a visit done with cash yes/no. Extras (e.g. bait) are not recorded or billed, partial payments and transfers can't be expressed, a client cancellation must go through the owner, and the day's list is ordered only by time.

## Current state (mapped 2026-10-29)
- Web: `web/src/features/employee/EmployeeApp.tsx` (day nav, list of `VisitItem`, "Efectivo a rendir"), `DoneSheet.tsx` ("¿Cobró en efectivo?" + amount; sends `{cashCollectedCents}` to `POST /api/me/visits/:id/done` via `useMarkMyVisitDone`).
- Server: `server/src/routes/me.ts`; `services/employee.ts` `myVisits` (filters cancelled, order from `services/visits.ts` `selectVisits`: date, time nulls last, id) and `markMyVisitDone` (one tx: `completeVisit` with createInvoice if price > 0, scheduleNext if frequency, issueCertificate if `certificateValidityDays`; cash -> `createPayment` method cash, `collectedByUserId`, FIFO allocation). Route then `queueAutoEmit` and `alertVisitDone` (employee role only).
- Admin completion: `POST /api/visits/:id/complete` same `completeVisit`; admin form defaults oblea from `serviceType.issuesCertificate` (inconsistent with employee flow).
- `completeVisit` (`services/visits.ts`): price = input ?? visit ?? service default; invoice `description = serviceType.name`, single `amountCents`; certificate number = max + 1; next visit copies type/frequency/price/assignee/time.
- No invoice line items, no extras/products. `services/catalog.ts` exists (check scope).
- Reschedule/cancel admin-only (`PATCH /api/visits/:id`, `POST /api/visits/:id/cancel`, only while scheduled; cancel creates no next visit).
- `shared/src/routePlan.ts` is monthly planning only; clients have `latitude`/`longitude` (legacy import), unused.
- ARCA (`shared/src/arca.ts` `mapInvoiceToArca`) uses only invoice total/dates + client fiscal data: line items don't affect it as long as `amountCents` is the sum.
- Alerts: `services/adminAlerts.ts` (`AlertKind`, `alertCopy`, `alertAdmins`, grouping 10 min); new kinds need `NOTIFICATION_KINDS` enum migration.
- Tests: `employees.test.ts`, `adminAlerts.test.ts`.

## Scope / decisions (accepted by the user 2026-10-29)
- Extras catalog (Ajustes): name, price, active. Employee adds extras with quantity when closing a visit.
- Invoices get line items: base service line + one line per extra; `amountCents` stays the total (ARCA unchanged). Admin completion form can add extras too. Existing invoices without items keep working (render as one line from description/amount).
- Base service includes oblea + disinfection: a completed service whose type issues certificates always issues the oblea; unify the rule on `serviceType.issuesCertificate` (validity from `certificateValidityDays`, default 30 when null); invoice base line reads "<service> (incluye desinfección y oblea)" when the type issues certificates.
- Payment when closing: "Pagó todo" / "Pagó una parte" (amount) / "No pagó", method efectivo / transferencia / Mercado Pago. Only cash is "a rendir" (`collectedByUserId` + `handedOverAt` null); other methods are recorded as received (handed over). Payment allocates first to this visit's invoice, remainder FIFO.
- "El cliente canceló": postpone (new date, default next business day, optional time) or cancel with a reason. Cancel of a recurring visit schedules the next occurrence. Both alert admins.
- Daily route order: visits with time by time; untimed visits ordered nearest-neighbor from the company base (new setting: base address + lat/lng; fallback to first visit) using client coordinates; clients without coordinates last. "Abrir recorrido en Google Maps" button (directions URL with waypoints, Maps limit ~10 stops: split if more).
- Simpler UI: large cards, day progress bar, next pending visit highlighted, actions reachable with one thumb.
- Admin alerts (bell + push, grouped as today): `extras_added` (with amount), payment status in the visit-done copy (pagó / parcial / no pagó), `visit_postponed`, `visit_cancelled`.
- Out of scope: shifts (item 11), fuel OCR (13), stock (24), geocoding new clients.

## TDD
Mode: off (project convention). Runner: Vitest (`npm test`). Ordinary functional checks per task.

## Delivery
Branch `feat/employee-app` (from main a5f0718). Strategy: ask-on-risk; forecast above 400 lines; single PR with work-unit commits (accepted for previous features). RDD disabled globally by user.

## Tasks
- [ ] E1 Extras + invoice line items: `extras` catalog + Ajustes section, `invoice_items` (+ backfill-free rendering of legacy invoices), `visit_extras`, `completeVisit` builds lines, admin completion form supports extras, invoice views show lines, unified oblea rule + base line copy, tests. Route: delegated (one writer for E1-E4, 2+ non-trivial files).
- [ ] E2 Payment status at closing: `myDoneInput` with `paymentStatus`, `amountCents`, `method`, `extras[]`; allocation to the visit's invoice first; only cash a rendir; DoneSheet redesign; alert copy with payment status + `extras_added` (enum migration); tests. Route: delegated.
- [ ] E3 Postpone / cancel by employee: `/api/me/visits/:id/postpone` and `/cancel` (reason), recurring cancel schedules next, admin alerts `visit_postponed` / `visit_cancelled`, employee UI sheet, tests. Route: delegated.
- [ ] E4 Ordered route + simpler UI: company base setting, shared pure `orderDayRoute` (time first, nearest-neighbor, no-coords last) with tests, Google Maps directions link(s), EmployeeApp redesign (progress, next visit highlighted). Route: delegated.

## Acceptance criteria
- Employee closes a visit adding 2 extras and "Pagó una parte" by transfer: invoice has 3 lines and the right total, payment allocated to that invoice, nothing "a rendir", admin gets one grouped alert with payment status and extras.
- Employee postpones a visit: it moves to the new date; cancelling a monthly visit creates next month's visit; admins are alerted.
- Day list order: timed visits by time, then nearest-neighbor; Maps link opens with the stops.
- ARCA emission unchanged for invoices with items (total = sum of lines). Existing tests pass.

## Checks
`npm run typecheck`, `npm test`, `npm run build`, browser QA of the employee app (mobile viewport) and admin alerts on a seeded throwaway DB.

## Progress / evidence
- Mapping: delegated explorer (employee web/server flow, completeVisit, invoices, reschedule/cancel, route, ARCA, tests).

## Next step
E1-E4 with one delegated writer.

Engram mirror: `odd/employee-app/tasks`.
