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
- [ ] D1 Debt by month: pure shared function grouping invoices + allocations into months with tests; server endpoint(s) for client months; client detail UI; portal summary by month; debtors list oldest month. Route: delegated (one writer for D1-D3, 2+ non-trivial files).
- [ ] D2 Choose months in payment: payment input accepts selected invoice ids; allocation to selected first (chronological), remainder FIFO; admin payment form with month/invoice checkboxes; tests (selected later month paid while earlier stays owed; overpayment remainder FIFO; default unchanged). Route: delegated.
- [ ] D3 IPC price update: pure shared price-adjust function with rounding tests; history table + migration; preview and apply endpoints (admin only, one transaction); admin screen with preview and history; tests (invoices untouched, preview equals apply, rounding). Route: delegated.

## Acceptance criteria
- A client owing three months sees three month rows with correct owed amounts; total equals the existing balance.
- Recording a payment selecting only April pays April even if March is older; leftover goes FIFO.
- Applying 10% with rounding to $100 changes future prices accordingly and leaves every existing invoice and client balance unchanged; the history lists the application.
- Existing tests keep passing.

## Checks
`npm run typecheck`, `npm test`, `npm run build`, API smoke and browser QA on a seeded throwaway DB.

## Progress / evidence

## Next step
Delegate D1-D3 to one writer.

Engram mirror: `odd/debt-by-month/tasks`.
