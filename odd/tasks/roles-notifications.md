# Feature: roles-notifications

## Objective
Make the owner (Lucas) a real admin user and add per-user notifications (in-app bell for everyone, email for admins), covering meeting item 14 ("user profiles and notifications per user type").

## Problem / why
Today the owner logs in with `ADMIN_PASSWORD` only and has no user row (session `{role:'admin', name:'Dueño'}`, no `userId`), so there can be only one anonymous admin, nothing can be addressed to the owner, and `/api/me/*` needs `?userId=` for admins. The only notifications are emails to clients (service notices, debt reminders); nothing reaches the owner or employees.

## Current state (mapped 2026-10-29)
- Auth: `server/src/auth.ts` (HMAC session cookie, `verifySessionToken` accepts roles admin|employee, employee requires uid; `resolveSession` reloads the user each request). Login `POST /api/auth/login` with `{username?, password}`; no username = `ADMIN_PASSWORD`.
- `users` (`server/src/db/schema.ts`): no email; role enum `admin|employee` (`shared/src/types.ts` `USER_ROLES`). CRUD in `server/src/routes/users.ts` + `services/users.ts`; web `features/settings/EmployeesSection.tsx` (no role field).
- `routes/me.ts` `actingUser`: admin must pass `?userId=`.
- Assignee lists (`AssigneeSelect`, `listUsers`, `requireAssignee`) accept any active user.
- `payments.collectedByUserId` null = registered by the owner; only the employee flow sets it.
- Email: `services/mail.ts` `sendLogged` -> `email_log` (kind enum `service_notice|debt_reminder|test`). Daily job `services/jobs.ts` runs once after 09:00 Buenos Aires, guarded by `job_runs`.
- Tests: `employees.test.ts`, `api.test.ts`, `config.test.ts`, helper `makeTestApp` logs in with `{password}` (owner).

## Scope
- Admin users with username + password; role selectable in Ajustes > Empleados; optional email on users.
- `ADMIN_PASSWORD` kept as emergency owner access only.
- Notifications: storage, API, bell UI (admin shell and employee app), generators, email copy for admins.
- Out of scope: client role and client portal (F3, needs magic-link design), WhatsApp, employee app work (extras with prices, ordered daily route, postpone/cancel, partial payment status: F6).

## Decisions (accepted by the user 2026-10-29)
- Login screen: username + password for everyone; a secondary "Acceso de emergencia" link keeps the password-only `ADMIN_PASSWORD` login. Emergency session stays userless (`name 'Dueño'`), has no bell, and should prompt to create an admin user if none exists.
- `users.email` nullable (unique when present, lowercase). `users.assignable` boolean: default true for employees, false for admins; assignee lists and `requireAssignee` only accept active assignable users.
- An admin user in `/api/me/*` acts as themself (no `?userId=` needed); keep `?userId=` working for admins.
- Dev seed creates an admin user (`lucas`, dev-only password in the seed like the employees).
- Notifications are addressed to a user (`user_id`). Admin notifications are created for every active admin user. Dedupe key per (user, kind, ref, day) so jobs can rerun safely.
- Admin notifications (bell + email when the admin has an email):
  - End-of-day summary (~20:00 Buenos Aires): visits done/pending, collected today, cash still "a rendir".
  - Cash pending handover from employees (in the summary; no separate spam).
  - Client email failed (when `sendLogged` records a failure).
  - Visits from previous days still `scheduled` (morning job).
- Employee notifications (bell only):
  - Morning: their visits of the day.
  - Afternoon (~17:00 Buenos Aires): reminder when they still have unmarked visits today.
- Scheduling: extend the existing hourly scheduler with time-slotted jobs guarded by `job_runs` (one claim per job and day).

## TDD
Mode: off (project convention). Runner: Vitest (`npm test`). Ordinary functional checks per task.

## Delivery
Branch `feat/roles-notifications` (from main b01f5ae). Strategy: ask-on-risk; forecast above 400 lines; single PR with work-unit commits (same as legacy-import, accepted by the user). RDD disabled globally by user.

## Tasks
- [x] R1 Admin users: migration (users.email, users.assignable), role + email + assignable in user CRUD (server + EmployeesSection), unified login form with emergency link, `/api/me` acting as the admin user, assignee filtering, dev seed admin, tests and docs (README, docs/design.md, docs/api.md). Route: delegated (one writer for R1, N1, N2; 2+ non-trivial files).
- [x] N1 Notifications core: `notifications` table + migration, service (create with dedupe, list, unread count, mark read / mark all read), `/api/me/notifications` endpoints, bell with unread badge and dropdown in admin `Shell` and `EmployeeApp`, tests. Route: delegated.
- [x] N2 Generators: time-slotted jobs (morning, 17:00, 20:00 Buenos Aires) for the notifications listed above, failed-client-email hook, admin email copy via `sendLogged` (new email kind), tests with injectable today/time. Route: delegated.
- [ ] N3 Installable PWA + Web Push (added by the user 2026-10-29): web app manifest with Plagamix icon/colors, service worker, Web Push with VAPID keys (env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; inactive when unset), `push_subscriptions` table per user/device, "Activar notificaciones" button in admin shell and employee app, every notification also delivered as push to the user's devices (expired subscriptions removed). iOS needs the PWA added to the home screen (16.4+). Route: delegated.
- [ ] N4 Live admin alerts (added by the user 2026-10-29): when an employee marks a visit done, records cash collected (and extras once F6 exists), every active admin gets a notification + push right away; bursts from the same employee within a few minutes are grouped into one notification. Route: delegated.

## Acceptance criteria
- Lucas logs in with username + password and sees the full admin UI; emergency password login still works.
- An admin can create another admin and an employee with email; admins are not offered as assignees unless marked assignable.
- Employees see only their own notifications; admins see admin notifications; marking read works; reruns of a job do not duplicate notifications.
- Existing tests keep passing.

## Checks
`npm run typecheck`, `npm test`, `npm run build`, browser QA of login, bell and Ajustes on the dev seed.

## Progress / evidence
- Mapping: delegated explorer (auth, users, notifications, owner assumptions).
- R1 (delegated, one writer): 2bce3f8. Migration 0007 (users.email unique nullable, users.assignable, admins backfilled false). Server login already accepted username; UI unified with "Acceso de emergencia". Assignee lists filter assignable. Seed admin `lucas`.
- N1 (delegated): a517fb2. Migration 0008 `notifications` (kinds day_summary, visits_overdue, client_email_failed, visits_today, visits_reminder; dedupe `userId:kind:refType:refId:day`), `/api/me/notifications`, bell polling every 60s in Shell rail, mobile top bar and EmployeeApp.
- N2 (delegated): cc79723. Migration 0009 (email kind owner_notification). Job keys notify_morning (09:00), notify_afternoon (17:00-20:00), notify_evening (20:00) in job_runs, catch-up after restart. Failed client email -> admins once per client/kind/day. Evening summary skipped on empty days.
- Checks: typecheck 0 errors; `npm test` 260/260 (re-run by parent: 260 passed); build ok; API smoke on throwaway PGlite: seed admin login (userId 1), notifications list with a visits_overdue item, emergency login userless with empty list. Not verified: browser QA of login, bell, banner, Ajustes; real Resend; Postgres run of migration 0009.

## Next step
N3 and N4 with the same delegated writer, then browser QA of the whole feature.

Engram mirror: `odd/roles-notifications/tasks`.
