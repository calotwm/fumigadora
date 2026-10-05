# Feature: fumigadora-app

## Objective
Build from scratch a management web app for a pest-control company (clients, receivables, billing, agenda, certificates, cash flow, dashboard), replacing the legacy Plagamix UX. Spec: `docs/design.md`.

## Constraints
- Deploy target: Railway (single service + Postgres). No Next.js.
- Stack: Hono + Drizzle + Postgres/PGlite, Vite + React + TS + Tailwind v4, Vitest.
- Money as integer cents. UI copy Spanish (es-AR), code English.
- Swiss minimalism: Inter, black/white/red, grid, no gradients, minimal radius.
- Responsive PC + phone.

## TDD
Mode: off (no project config, no explicit user choice). Source: default. Runner: Vitest (`npm test`). Ordinary functional checks per task.

## Delivery
Strategy: ask-on-risk. No remote configured; work-unit commits on branch `feat/fumigadora-app`. Forecast: well over 400 lines (greenfield) — PR slicing decision deferred until a remote exists.

## Tasks
- [ ] T1 Scaffold workspace + shared domain module (money, dates, invoice status, allocation FIFO, aging, recurrence) with unit tests. Route: delegated (writer trigger).
- [ ] T2 Server: Drizzle schema + migrations, PGlite/pg switch, auth, REST API for all entities, derived queries (balances, aging, dashboard, monthly summary), seed data. Route: delegated.
- [ ] T3 Web shell: design tokens, layout (rail + bottom bar), login, API client, command palette, Dashboard "Hoy". Route: delegated.
- [ ] T4 Clients: list with balance/aging, client sheet (account statement, visits, invoices, certificates, data) with inline Cobrar/Facturar/Agendar/WhatsApp. Route: delegated.
- [ ] T5 Agenda: day/route, week, month, upcoming; complete-visit flow (invoice + certificate + next visit). Route: delegated.
- [ ] T6 Cobranzas (aging board, invoices, batch monthly billing) + Finanzas (summary, compare, categories, movements, quick expense) + Ajustes. Route: delegated.
- [ ] T7 Railway deploy config, production build serving SPA, README, responsive QA in browser. Route: delegated + parent browser check.

## Acceptance criteria
- Recording an invoice updates client account, receivables, dashboard without extra input.
- Recording a payment allocates to invoices, updates statuses, account, monthly income.
- Completing a visit can create invoice, certificate and next visit in one confirm.
- Dashboard answers: income, expenses, balance, owed, overdue invoices, upcoming visits, services this month, late payers.
- Usable at 375px width and desktop.

## Checks
`npm run typecheck`, `npm test`, `npm run build`, manual browser QA.

## Progress / evidence
(empty)

## Next step
T1.

Engram mirror: pending (Engram tools unavailable this session).
