# Feature: plagamix-etapas

## Objective
Implement the five features proposed to Plagamix (deck `presentacion/plagamix-sistema-urquisoft-8.pdf`), in the agreed order:
1. Monthly service tracking.
2. Employee mobile app with cash "to hand over".
3. Automatic emails: zone-based monthly route with service notices (after Lucas approves) and debt reminders.
4. ARCA (AFIP) electronic invoicing — built and tested with mocks; activation waits for client's certificate, web-service point of sale and tax condition.

## Problem / why
Legacy workflow is manual: services slip through, cash collected by employees is untracked, notices and reminders are sent by hand, invoices are typed twice (system + ARCA).

## Scope
- Server (Hono + Drizzle), shared domain, web (React). Spec base: `docs/design.md`, `docs/api.md`.
- Out of scope: real ARCA activation, choosing/configuring the client's email domain (adapter + env vars only).

## Decisions (defaults, revisable)
- Client service plan lives on the client: `serviceFrequency`, `defaultServiceTypeId`, `zone` (reuse existing `area` as zone).
- Employees: `users` table (role `admin` | `employee`), password hashed with scrypt. Env `ADMIN_PASSWORD` keeps working for the owner. Employees only access `/api/me/*`.
- Cash collected by an employee is registered as a cash payment immediately (client debt drops), with `collectedByUserId` and `handedOverAt` null until the owner confirms receipt ("a rendir").
- Email: provider adapter. Resend HTTP API when `RESEND_API_KEY` + `MAIL_FROM` set; otherwise "simulated" mode that logs and stores the message. Every email stored in `email_log`.
- Scheduling: in-process daily job (single Railway instance). Debt reminder settings (enabled, every N days, from N days overdue) editable in Ajustes.
- ARCA: WSAA (CMS-signed login ticket) + WSFEv1 (`FECAESolicitar`). Disabled unless env configured (CUIT, cert, key, point of sale, environment, tax condition). Monotributo → Factura C; Responsable Inscripto → A/B by client IVA condition.

## TDD
Mode: off (no project config, no explicit choice). Runner: Vitest (`npm test`). Ordinary functional checks per task.

## Delivery
Branch `feat/plagamix-etapas` (from main cc5ce9f). Strategy: ask-on-risk; forecast well above 400 lines. Work-unit commits per task; PR slicing decided with the user before opening PRs. RDD disabled globally by user.

## Tasks
- [x] E1 Monthly tracking: client service plan fields, domain rule "due this month", API, Agenda "Seguimiento" view + dashboard block, one-click schedule. Route: delegated (writer trigger).
- [x] E2 Employees: users/roles/auth, visit assignment, employee mobile app (`/app`), cash to hand over + owner confirmation. Route: delegated.
- [x] E3 Emails: provider adapter + email log, zone route planner with approval and service notices, debt reminders job + settings. Route: delegated.
- [ ] E4 ARCA: client fiscal data, WSAA/WSFEv1 client, emit flow + invoice CAE fields, config status UI; mocked tests. Route: delegated.

## Acceptance criteria
- Owner sees which clients have not had their service this month and can schedule them in one action.
- Employee logs in on phone, sees only own visits for the day, marks done and cash; owner sees cash pending per employee and confirms.
- Approving a month route creates visits and sends one notice per client with email (simulated without provider).
- Debt reminders respect configured frequency and minimum days overdue; never duplicate within the interval.
- With ARCA configured (mock), an invoice gets CAE + number; without config, UI states it is pending activation and nothing breaks.

## Checks
`npm run typecheck`, `npm test`, `npm run build`, browser QA.

## Progress / evidence
- E1 (delegated, one writer): 244c37d, 243996c, 5e5b8d4. typecheck clean; `npm test` 99/99 (parent spot check re-ran); build ok; /api/tracking on reseeded DB: expected 27 = done 11 + scheduled 10 + pending 6. Weekly expected = Mondays in month; long frequencies only when due. Screens checked at 1440 and 390 by writer.
- E2 (delegated, one writer): 5663adb, 7a97326, f04de9c and the web admin commit. typecheck clean; `npm test` 124/124; build ok; curl on reseeded DB: owner login, employee login, /api/me/visits ok, employee on /api/clients and /api/users 403. Screens checked: employee app 390x844 (list, done sheet), Finanzas efectivo 1440, Ajustes empleados, Agenda day filter. Deviation: payments also got nullable `visitId` (links cash to its visit).
- E3 (delegated, one writer): see commits `feat(shared): route planning...`, `feat(server): email adapter...`, `feat(server): route plans, settings, debt reminders and daily job`, `feat(web): route planner`, `feat(web): mail and reminder settings`, `docs`. typecheck clean; `npm test` 155/155; build ok; curl on reseeded DB: generate 2026-11 (25 visits, 13 clients, 10 with email) -> approve -> 22 simulated notices, regenerate = 409; reminders enabled -> 5 simulated, second run 0. Screens checked at 1440 and 390 (Recorrido draft/approve dialog/approved, Ajustes Mails and Recordatorios, mail preview). Decisions: zones get one weekday each (heaviest first to least-loaded weekday), cap 12/day; `email_log.sentOn` stores the business date for the reminder interval; settings are key/value JSON; failed notices retried by the daily job; rescheduling after a notice is not re-notified. Gap: no per-zone bulk assignee; .env.example appended blindly (not readable by tooling).

## Next step
E4 (ARCA).

Engram mirror: pending (Engram tools unavailable).
