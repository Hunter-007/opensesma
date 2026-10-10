---
name: opensesma-engineering
description: How the OpenSesma codebase works and how to change, test and deploy it safely (SvelteKit, Drizzle, Netlify Database, offline gate engine). Use for any coding, debugging or deploy task in the OpenSesma repo.
---

# OpenSesma — engineering guide

Repo: https://github.com/Hunter-007/opensesma (**public**, default branch `main`;
Netlify deploys every push to `main`). Read `docs/ARCHITECTURE.md` for the full
design. Product rules live in the `opensesma-product` skill; security rules in
`opensesma-security`.

## Stack

- SvelteKit 2 + **Svelte 5 runes**, TypeScript, plain CSS (`src/app.css`), no UI framework.
- Drizzle ORM on Postgres. Production: **Netlify Database** via postgres.js. Dev/tests: **PGlite** (`DATABASE_URL=memory://` or `pglite://./.data/pglite`).
- `@sveltejs/adapter-netlify` (default) or `adapter-node` with `ADAPTER=node` (self-hosting / local e2e).
- Ed25519 pass tokens (`@noble/curves`), web push (VAPID), service worker, IndexedDB gate store.
- Node 20+. Tests: vitest (+ fake-indexeddb, @netlify/database-dev); browser e2e with Playwright.

## Code map

| Path | What |
| --- | --- |
| `src/lib/shared/` | Code that runs on server **and** gate phone: `evaluate.ts` (the one decision function), `passToken.ts`, `encoding.ts` (8-digit codes), `types.ts` (pass types, `PER_DAY_CAP`, `DEFAULT_SETTINGS`, deny messages), `sync.ts`, `pin.ts`, `redirect.ts` (`safeNext`) |
| `src/lib/server/` | `auth.ts` (OTP + sessions), `links.ts` (one-time sign-in links, invite sign-in), `estates.ts` (estates, houses, invites, staff, demo data), `passes.ts` (create/revoke, share message, `/v/` short link), `gate.ts` (device enrol/auth/rotation, sync, event ingest + server re-check, walk-ins), `admin.ts` (log, CSV, reports), `push.ts`, `sms.ts`, `crypto.ts`, `config.ts`, `guards.ts` (`requireUser/Resident/Admin`, `attempt`), `util.ts` (`AppError`, `audit`, `rateLimit`), `db/schema.ts` |
| `src/lib/client/gate/` | `engine.ts` (offline gate: enrol, PIN shifts, sync with server-anchored clock, lockouts, event queue), `store.ts` (IndexedDB) |
| `src/lib/components/` | `ShareButtons.svelte` (WhatsApp / Text / Copy), Keypad, Scanner, PassRow, PushPrompt, WalkinDecision, ScheduleInput |
| `src/routes/` | `app/` resident, `admin/` manager, `gate/` guard (prerendered, offline), `p/[token]` visitor page (no JS), `v/[id]` short link → `/p/`, `l/[token]` sign-in link, `join/[code]` invite, `setup/` (token-gated), `api/gate/*`, `api/health`, `api/cron/maintenance` |
| `scripts/` | `seed.ts`, `migrate.ts`, `sync-migrations.ts`, `vapid.ts`, `rotate-secret.ts` |
| `tests/` | `passEngine`, `flows`, `gateEngine`, `security`, `signInLinks`, `migrations`, `netlifyDatabase` |

## Working rules

1. **Shared decision logic stays in `evaluate.ts`.** Server and gate must never disagree; change it once, test both paths.
2. **The gate must keep working offline.** Never add a network round-trip to the ALLOW/DENY path. Keep the sync protocol backward compatible — old gate phones update late.
3. Every query is scoped by `estateId` from the session/device, never from form input alone (e.g. check a `unitId` belongs to the estate).
4. Server actions: wrap in `attempt(...)`, throw `AppError(message, status, code)` with a user-facing message; audit admin actions with `audit(...)`; rate-limit anything anonymous with `rateLimit(key, n, seconds)`.
5. Svelte 5: use runes (`$state`, `$derived`, `$props`). **Clone `$state` objects (`JSON.parse(JSON.stringify(x))`) before IndexedDB writes** — proxies throw DataCloneError.
6. Svelte eats regex braces in attributes: write `pattern={"[0-9]{6}"}`.
7. Strict CSP (`svelte.config.js` + `netlify.toml`): no inline scripts, no third-party script/CDN; inline styles OK.
8. The app sends no SMS by default. Share flows use `ShareButtons` (wa.me / `sms:?&body=`), stripping WhatsApp `*bold*` for text. Check `config.smsLoginEnabled` before showing SMS-dependent UI.
9. Copy: plain, short, Nigerian context. Never show a resident's phone number to visitors or gate phones.

## Database & migrations

- Edit `src/lib/server/db/schema.ts`, then `npm run db:generate -- --name <snake_name>`; this writes `drizzle/NNNN_*.sql` and mirrors it to `netlify/database/migrations/`. Rename random names in both folders **and** `drizzle/meta/_journal.json` before committing.
- Netlify applies `netlify/database/migrations/` just before a deploy is published (and snapshots the DB). **Never edit or delete a deployed migration**; never run `drizzle-kit push/migrate` against Netlify. Prefer additive changes (new tables, nullable columns).
- Applied in production: `0000_init`, `0001_security_hardening`, `0002_sign_in_links`.

## Run, test, verify

```bash
npm install
npm run db:seed && npm run dev          # http://localhost:5173 — OTPs on screen, SMS at /dev/outbox
npm test                                 # vitest (108 tests at 9 Oct 2026)
npm run check                            # svelte-kit sync + svelte-check: must be 0 errors, 0 warnings
ADAPTER=node npm run build && node build # production server locally
```

Production-like local run (SMS off, like live):
`PORT=4173 ORIGIN=http://localhost:4173 PUBLIC_APP_URL=http://localhost:4173 APP_SECRET=<32+ chars> SETUP_TOKEN=<anything> DATABASE_URL=pglite://./.data/pglite NODE_ENV=production node build`

Browser e2e: Playwright is at `/opt/npm-tools/node_modules/playwright` with
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (never `playwright install`). Use a
Pixel 5 profile for resident/gate, desktop for admin. Watch `pageerror` and CSP
console messages; take screenshots and look at them.

Done means: tests pass, `npm run check` is clean, the changed flow was walked in
a browser on the production build, and new behaviour has a test.
After killing local servers, use `pgrep -x node -a | awk '$3=="build"'` (plain `pkill node` kills the shell).

## Deploy (Netlify)

- Project `opensesma` (site id `75e8db20-a7e3-4787-8d94-31ab3cfe5e06`). Push to `main` → build → migrations → publish (~1 min).
- Verify with the Netlify connector: get-project → `currentDeploy.id` → get-deploy-for-site: check `state: ready`, `commit_ref`, `database_migrations[].applied`, empty secret scan.
- The cloud workspace can't reach `*.netlify.app` (proxy 403); verify via the Netlify API or ask the owner.
- adapter-netlify runs in Lambda compatibility mode: **no `NETLIFY_DB_URL` there** → the app reads the `DATABASE_URL` secret.
- Netlify Functions don't set `NODE_ENV=production`; `config.isProd` also checks Vite's `import.meta.env.PROD`.
- Env vars through the connector: plain values save only with default options; secrets need context `production` + scopes `["builds","functions","runtime"]`. Other combinations report success and save nothing — **always read back with getAllEnvVars**.
- Env vars: secrets `APP_SECRET` (rotate only via `APP_SECRET_PREVIOUS` + `npm run secrets:rotate`), `CRON_SECRET`, `VAPID_PRIVATE_KEY`, `DATABASE_URL`, `SETUP_TOKEN`; plain `PUBLIC_APP_URL`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `SMS_DRIVER=console`. Optional SMS: `TERMII_*`, `ALLOWED_COUNTRY_CODES`, `OTP_PER_IP_PER_HOUR`, `OTP_GLOBAL_PER_HOUR`.
- Never put secrets in the repo, commits, skills or docs. Netlify's secret scan runs on every deploy.

## Commits

Small, descriptive commits on `main` with a body explaining why; end with the
session's attribution lines. Keep README / ARCHITECTURE / security docs in step
with behaviour changes.

## Known gaps / next engineering work

- README still describes 6-digit codes and SMS-first sign-in; update to 8-digit codes, link sign-in and WhatsApp/text sharing.
- Gate sync every 60 s is the main load; slowing idle sync to ~3 min would cut requests ~60%.
- Planned infra move at ~3 paying estates: one VPS (adapter-node + Postgres) behind Cloudflare, nightly off-site backups, uptime monitor on `/api/health`, Sentry.
