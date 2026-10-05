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
- [x] T1 Scaffold workspace + shared domain module (money, dates, invoice status, allocation FIFO, aging, recurrence) with unit tests. Route: delegated (writer trigger).
- [x] T2 Server: Drizzle schema + migrations, PGlite/pg switch, auth, REST API for all entities, derived queries (balances, aging, dashboard, monthly summary), seed data. Route: delegated.
- [x] T3 Web shell: design tokens, layout (rail + bottom bar), login, API client, command palette, Dashboard "Hoy". Route: delegated.
- [x] T4 Clients: list with balance/aging, client sheet (account statement, visits, invoices, certificates, data) with inline Cobrar/Facturar/Agendar/WhatsApp. Route: delegated.
- [x] T5 Agenda: day/route, week, month, upcoming; complete-visit flow (invoice + certificate + next visit). Route: delegated.
- [x] T6 Cobranzas (aging board, invoices, batch monthly billing) + Finanzas (summary, compare, categories, movements, quick expense) + Ajustes. Route: delegated.
- [x] T7 Railway deploy config, production build serving SPA, README, responsive QA in browser. Route: delegated + parent browser check.

## Acceptance criteria
- Recording an invoice updates client account, receivables, dashboard without extra input.
- Recording a payment allocates to invoices, updates statuses, account, monthly income.
- Completing a visit can create invoice, certificate and next visit in one confirm.
- Dashboard answers: income, expenses, balance, owed, overdue invoices, upcoming visits, services this month, late payers.
- Usable at 375px width and desktop.

## Checks
`npm run typecheck`, `npm test`, `npm run build`, manual browser QA.

## Progress / evidence
- T1+T2 (delegated, one writer): commits 39a6c37..49308c7. typecheck clean; `npm test` 59/59 pass (parent spot check re-ran: 59/59); build ok; migrate+seed ok; built server curl: login 200, dashboard JSON sane, 401 without cookie. Postgres path untested (PGlite only). API documented in docs/api.md.
- Review: assess risk high (auth, payments) on a9c7ec6..49308c7; user declined and asked to skip always — RDD disabled globally (`gentle-ai review mode disable`).
- T3+T4 (delegated, one writer): commits ae6fcff, e759920, dcefe33, 863d1c1. typecheck clean; `npm test` 65/65; build ok; built server serves SPA + fallback; browser QA at 375/1280 by writer.

- T5–T7 (same writer, resumed): commits 6116c06, c425fe8, 6ab5985, 6c94a6b. typecheck clean; `npm test` 69/69 (parent spot check re-ran: 69/69); build ok; production refuses boot without ADMIN_PASSWORD/SESSION_SECRET; browser sweep 375/1280 all routes. Not exercised end to end: void, delete, edit, reschedule, cancel, archive, settings CRUD.
- Postgres path: untested. Parent attempt via Docker failed (Docker daemon not running); `db:migrate` hung instead of failing fast against an unreachable host.
- `.env.example` first comment line inaccurate (server does not load .env); file blocked by permission rules for agents.

## Next step
Test against real Postgres (Docker or Railway), fix `.env.example` comment, deploy to Railway.

Engram mirror: pending (Engram tools unavailable this session).
