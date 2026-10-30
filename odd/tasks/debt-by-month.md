# Feature: debt-by-month

## Objective
Show each client's debt broken down by month, let the owner choose which months a payment settles, and update prices by IPC (meeting items 1 and 2).

## Problem / why
Today debt is a single balance and payments are allocated FIFO automatically. The owner needs to tell a client "you owe March and April", record a payment against specific months, and raise monthly prices with inflation without editing each client by hand.

## Scope / decisions (chosen by the parent 2026-10-30; the user delegated the choice)
- Debt by month: per client, group open invoice amounts by `period_month` (fallback: month of `issued_on`), showing billed, paid, and owed for each month, plus the total. Shown in the client detail (admin) and in the client portal summary (F3). Admin debtors list can show the oldest owed month and the number of owed months.
- Choosing months when registering a payment (admin): the payment form lists owed months (and the invoices inside each month) with checkboxes. Allocation goes to the selected invoices in chronological order; any remainder falls back to FIFO over the other open invoices. Default (nothing selected) keeps today's FIFO behaviour. Employee flow (F6) unchanged: visit invoice first, then FIFO.
- IPC adjustment = forward-looking price update, NOT interest on old debt: existing invoices and the legacy-reconciled balances never change.
  - Admin screen "Ajuste por IPC" (Ajustes or Finanzas): enter a percentage (e.g. 3.2) and optional rounding (none, to $100, to $1.000), choose scope (service type default prices and/or per-client/visit prices of scheduled future visits and client recurring prices, wherever prices live today), preview old -> new per item, apply in one transaction.
  - Every application is recorded in a history table (date, percentage, rounding, scope, user, count of items changed) and listed on the screen. No automatic INDEC fetch (out of scope; manual entry).
- Money stays integer cents; percentage applied with round-half-up to cents, then the chosen rounding.
- Out of scope: interest/late fees, automatic monthly IPC, editing past invoices.

## TDD
Mode: off (project convention). Runner: Vitest (`npm test`). Ordinary functional checks per task.

## Delivery
Branch `feat/debt-by-month` (from main 5ef8a45). Strategy: ask-on-risk; forecast above 400 lines; single PR with work-unit commits (accepted for previous features). RDD disabled globally by user. The user authorized autonomous continuation on 2026-10-30 ("vos mandale"); PRs are opened, merges stay with the user.

## Tasks
- [x] D1 Debt by month: pure shared function grouping invoices + allocations into months with tests; server endpoint(s) for client months; client detail UI; portal summary by month; debtors list oldest month. Route: delegated (one writer for D1-D3, 2+ non-trivial files). Commit 240fff5.
- [x] D2 Choose months in payment: payment input accepts selected invoice ids; allocation to selected first (chronological), remainder FIFO; admin payment form with month/invoice checkboxes; tests (selected later month paid while earlier stays owed; overpayment remainder FIFO; default unchanged). Route: delegated. Commit 617a6a1.
- [x] D3 IPC price update: pure shared price-adjust function with rounding tests; history table + migration; preview and apply endpoints (admin only, one transaction); admin screen with preview and history; tests (invoices untouched, preview equals apply, rounding). Route: delegated. Commit 24a87b1 (+ QA fix 2cb3356).

## Acceptance criteria
- A client owing three months sees three month rows with correct owed amounts; total equals the existing balance.
- Recording a payment selecting only April pays April even if March is older; leftover goes FIFO.
- Applying 10% with rounding to $100 changes future prices accordingly and leaves every existing invoice and client balance unchanged; the history lists the application.
- Existing tests keep passing.

## Checks
`npm run typecheck`, `npm test`, `npm run build`, API smoke and browser QA on a seeded throwaway DB.

## Progress / evidence
- 2026-10-30 D1 `240fff5 feat(receivables): debt broken down by month`: `shared/src/debtMonths.ts` (`debtByMonth`, `invoiceMonth`; credit netted oldest month first so the total equals the balance), `GET /api/clients/:id/months`, `months` in `GET /api/portal/summary`, `oldestOwedMonth`/`owedMonthCount` on receivables debtors; UI: "Deuda por mes" in the client "Cuenta corriente" tab, portal "Deuda por mes" list, "Desde <mes> · N meses" in Cobranzas. Tests: `shared/src/debtMonths.test.ts` (6), `server/src/test/debtMonths.test.ts` D1 block (4: three months, total = balance, fallback to issue month, 404, debtors, portal).
- 2026-10-30 D2 `617a6a1 feat(payments): choose the months a payment settles`: `allocatePayment` third argument extended to `number | number[]` (selected invoices first in chronological order, remainder FIFO, empty selection = FIFO); `POST /api/payments` accepts `invoiceIds` (400 when not open or mixed with `invoiceId`); payment sheet lists owed months (and the invoices of multi-invoice months) as checkboxes, amount pre-filled from the selection. Employee flow untouched (its route schema has no `invoiceIds`; existing `employeePayments.test.ts` "sends a partial payment above the invoice to the oldest debt" still passes). Tests: 4 new in `domain.test.ts`, 4 in `debtMonths.test.ts` (April paid while March owed; remainder FIFO; default FIFO; validation).
- 2026-10-30 D3 `24a87b1 feat(pricing): IPC price update with preview and history`: `shared/src/priceAdjust.ts` (`adjustPrice` with BigInt round-half-up to the cent then none/$100/$1.000; `percentToBasisPoints`); table `price_adjustments` (migration `0017_price_adjustments.sql`, generated with drizzle-kit); `POST /api/price-adjustments/preview`, `POST /api/price-adjustments` (one transaction, 400 `nothing_to_adjust`), `GET /api/price-adjustments`; scopes `serviceTypes`, `extras` (active), `visits` (scheduled, from today, own price), `monthlyFees` (active clients). UI: Ajustes > "Ajuste por IPC" (percentage, rounding chips, scope checkboxes, preview table, confirm, history). Tests: `shared/src/priceAdjust.test.ts` (6), `server/src/test/priceAdjust.test.ts` (5: rounding, scopes, preview = apply, invoices/balances/months unchanged, history, validation, employee 403). QA fix `2cb3356` (rounding chip order, lowercase month in debtors list).
- Checks (2026-10-30): `npm run typecheck` exit 0; `npm test` 35 files / 375 tests passed (baseline 346; one earlier full run showed 7 transient failures that did not reproduce on three later runs); `npm run build` exit 0.
- API smoke on seeded throwaway PGlite (temp dir, port 3999, admin lucas): client 8 months 07-10/2026 total 154.000 = balance; payment 50.000 with `invoiceIds:[Sept]` -> Sept paid, 4.000 FIFO to July; foreign id -> 400; IPC 10 % / $100 preview 76 items, apply items identical to preview, `/api/invoices` byte-identical before/after, receivables debtors identical, history 1 row (Lucas); employee juan -> 403 on all three IPC routes.
- Browser QA (375 and 1280 px): client "Deuda por mes" table, payment sheet month checkboxes (selecting August pre-filled $ 46.000 and paid August while July stayed owed), Ajustes > Ajuste por IPC preview (3,2 % / $100: 93.500 -> 96.500), Cobranzas debtors months; no horizontal overflow. Portal month list verified by API test only.
- Open decisions: `extras` added as a fourth scope ("wherever prices live today"); IPC percentages limited to > 0 and <= 100 with two decimals; overdue scheduled visits dated before today are not adjusted (spec says "future").

## Next step
Parent review of D1-D3, then open the PR (merge stays with the user).

Engram mirror: `odd/debt-by-month/tasks`.
