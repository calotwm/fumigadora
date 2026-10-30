# Feature: client-portal

## Objective
Give each client a way to see their own service status: a public link (and a printable QR placard with the Plagamix design) showing the next visit and oblea validity, plus a private portal behind an email magic link with debt, invoices, visit history and oblea PDFs. Covers the client-profile and public-link/QR items added by the user.

## Problem / why
Clients (buildings, businesses) call or message to ask when the next visit is and how much they owe. Building residents need to see the service status where they live. Today only the owner and employees can log in.

## Scope / decisions (defaults chosen by the parent 2026-10-30; the user delegated the choice)
- Public link per client: `/c/<publicToken>`, random unguessable token (>= 128 bits, base64url) stored on the client, regenerable by an admin (old link stops working). No login. Shows: client display name (no CUIT, no address detail beyond what the placard shows), next scheduled visit (date, service type, no employee name), last completed visit date, current oblea number + valid-until, "Plagamix" contact (phone/WhatsApp from company settings if present). NO debt or amounts on the public page (anyone who scans a building QR could see it).
- Client portal: role `client` session bound to `clientId`. Login at `/portal`: client enters an email; if it matches the client's email or a `client_contacts` email (case-insensitive) a magic link is sent via the existing mail service (`sendLogged`, new email kind). Response is always the same generic message (no account enumeration). Link token: random, stored hashed (sha256), expires in 30 minutes, single use. Session cookie for the client role lasts 30 days. An email shared by several clients: the link logs into a picker listing those clients.
- Portal content (read-only): next visits, visit history, balance (debt) and open invoices with their lines, payments, obleas with PDF download (only the client's own certificates). Logout.
- Authorization: client sessions can only reach `/api/portal/*` and only for their own `clientId`; every existing admin/employee route must reject the client role. Rate-limit magic link requests (per email and per IP, simple in-memory window).
- QR placard: admin-only printable page per client (A5/A4 portrait, print CSS) with Plagamix design (yellow/black brand, logo/wordmark used in the app), client name, "Escaneá para ver la próxima visita", QR of the public URL (generated server-side or client-side as SVG with the `qrcode` package), short URL text below. Bulk print for many clients (filter by zone) on one page with page breaks. Button in the client detail: "Link público" (copy, regenerate) and "Imprimir QR".
- Public base URL from config (`PUBLIC_BASE_URL`, fallback request origin).
- Out of scope: client editing data, online payments, WhatsApp delivery, per-month debt (F4).

## TDD
Mode: off (project convention). Runner: Vitest (`npm test`). Ordinary functional checks per task.

## Delivery
Branch `feat/client-portal` (from main 8c859c2). Strategy: ask-on-risk; forecast above 400 lines; single PR with work-unit commits (accepted for previous features). RDD disabled globally by user.

## Tasks
- [x] P1 Public link: migration (`clients.public_token` unique), token generation for existing clients (migration backfill or lazy), regenerate endpoint, public `GET /api/public/clients/:token` (no auth, minimal payload), web page `/c/:token`, admin "Link público" in client detail, tests (payload has no money/CUIT, unknown token 404, regenerate invalidates). Route: delegated (one writer for P1-P3, 2+ non-trivial files).
- [x] P2 Client portal: `client` role in shared types + session, `client_login_tokens` table, `POST /api/portal/login` (generic response, rate limit), `GET /api/portal/verify?token=` (sets session, picker when several clients), `/api/portal/*` read endpoints scoped to the session client, certificate PDF download for own certificates, email kind + copy, web `/portal` (login, sent, picker, dashboard), client role rejected on admin/employee routes, tests. Route: delegated.
- [x] P3 QR placard: `qrcode` dependency, printable placard page per client and bulk page by zone with print CSS and Plagamix design, buttons in client detail and clients list, `PUBLIC_BASE_URL` config + docs (README, docs/api.md, .env.example if writable). Route: delegated.

## Acceptance criteria
- Scanning a placard opens the public page with next visit and oblea validity, without amounts.
- A client requests a magic link with their email, opens it, sees their debt, invoices and obleas, downloads their PDF; cannot read another client's data (403/404).
- An unknown email gets the same response as a known one; a used or expired link is rejected.
- Client sessions are rejected by every admin/employee route. Existing tests keep passing.

## Checks
`npm run typecheck`, `npm test`, `npm run build`, browser QA (public page, portal login with simulated mail, placard print preview) on a seeded throwaway DB.

## Progress / evidence
- P1 done, commit 6bbef60 (migration 0015 with SQL backfill via gen_random_uuid; public endpoint, regenerate, `/c/:token`, Link publico sheet, `companyPhone` setting for the public contact). Route: delegated (one writer for P1-P3).
- P2 done, commit e91b677 (migration 0016: `client_login_tokens` + email kind `portal_login`; deny-by-default staff guard; `/api/portal/*`; `/portal` and `/portal/entrar`). Tests iterate every registered route and assert 403 for a client cookie.
- P3 done, commit cb213d1 (`qrcode` + `@types/qrcode` in web, placard page per client `/clientes/:id/cartel`, bulk `/carteles?zona=`, A5/A4 print CSS, lazy-loaded chunk; README, docs/api.md, docs/design.md).
- Deviations from the decisions: (1) magic-link verify is `POST /api/portal/verify` + `POST /api/portal/select` instead of `GET ?token=` so mail scanners that prefetch links cannot burn the token; the emailed link opens the SPA page `/portal/entrar`. (2) In production the magic link is NOT sent without `PUBLIC_BASE_URL` (a forged Host header could redirect the link); non-production falls back to the request origin. (3) The login lookup and mail run after the response so response time does not reveal whether an email is registered. (4) A client session uses the same signed cookie as staff (role `client`, `cid`), so logging in as a client in a browser replaces an admin session there. (5) A picker leaves the token unspent until a client is chosen. (6) `.env.example` could not be edited (path denied by the sandbox): add `PUBLIC_BASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` by hand; README documents them.
- Checks (final, on cb213d1): `npm run typecheck` clean; `npm test` 31 files / 346 tests passed (was 30 / 323: new files publicLink.test.ts with 10 tests and portal.test.ts with 23); `npm run build` ok. API smoke on a throwaway seeded PGlite (real server on port 3055): public payload 200 without amounts, unknown token 404, login answer identical for known and unknown email, magic link read from the mail log, verify ok then reuse 400, portal data scoped, client cookie 403 on /api/clients, /api/me/visits, /api/settings and /api/certificates/1/file, another client's oblea 404. Browser QA: public page, placard (A5, fits one page, long names clamp), bulk page by zone (5 placards, all fit), portal account after magic link. Throwaway data deleted. Not verified: real print dialog output (margins/background graphics depend on the browser) and a real Resend delivery.

## Next step
Owner review of the F3 branch (`feat/client-portal`), add the env vars to `.env.example`, set `PUBLIC_BASE_URL` in production, then PR.

Engram mirror: `odd/client-portal/tasks`.
