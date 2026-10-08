# OpenSesma architecture

## Goals that shaped the design

1. **The gate must never stop working.** Gatehouse power and data are unreliable, so every gate decision is made on the gate phone.
2. **Any phone.** One browser app (PWA) for residents, guards and managers. No app store. Visitors need nothing installed — a 6-digit code read aloud works.
3. **Cheap on data.** System fonts, ~116 KB gzipped JS for the whole app, a no-JS visitor page, delta sync.
4. **Accountable.** Every entry, refusal and override is logged with the guard, gate and time; admin actions are audited.

## Components

| Part | Code | Notes |
| --- | --- | --- |
| Pass tokens | `src/lib/shared/passToken.ts` | `base64url(json).base64url(ed25519 sig)`. ~250 chars, fits a low-density QR |
| Decision rules | `src/lib/shared/evaluate.ts` | One pure function used by server and gate: estate, revoked, ban, house active, window, schedule (estate time zone, overnight shifts), entry count, dues warning |
| Server | `src/lib/server/*` | SvelteKit server routes + Drizzle. Postgres in production, PGlite (Postgres-in-WASM) for dev and tests |
| Gate engine | `src/lib/client/gate/engine.ts` | Enrolment, PIN shifts, sync, verification, event queue. Pure TS over IndexedDB, tested in Node with fake-indexeddb |
| Service worker | `src/service-worker.ts` | Precaches the app and the prerendered `/gate` shell; push notifications with Let in / Decline actions |

## Sync protocol (gate ⇄ server)

1. **Upload first.** `POST /api/gate/events` with up to 100 queued events. Each has a UUIDv7 made on the phone, so a resend after a dropped connection is ignored (`on conflict do nothing`).
2. **Then download.** `GET /api/gate/sync?since=<cursor>&u=<unitsHash>&g=<guardsHash>&b=<bansHash>`.
   - Passes changed since the cursor (5 s overlap for clock races); a full set of active passes on first sync.
   - Houses, guards and bans only when their hash differs from the phone's, so an idle minute costs a few hundred bytes.
3. The phone keeps `entriesUsed = max(server, local)`, so its own un-uploaded check-ins still count.
4. Runs every 60 s, on reconnect, when the screen wakes, and after each check-in.

**Conflicts.** Two offline gates can each admit the same one-time pass. The server accepts both events (they happened), increments the count, and flags the one that went over the limit as a *double entry* on the dashboard. Refusing a real event after the fact would only corrupt the log.

**Staleness.** QR passes verify by signature even if created after the last sync. Codes need the local cache. If the phone hasn't synced for `staleSyncHours` (default 6), allowed results carry a "cancellations may be missing" warning and unknown codes steer the guard to Walk-in.

## Walk-ins (no phone calls)

`POST /api/gate/walkins` → web push to every active household member with *Let in / Decline* buttons. The gate polls every 3 s. When polled after 45 s with no answer, the server texts the household a single-use link (`/w/<token>`) — so no cron is needed on serverless. After 3 minutes the gate shows the household's numbers to call; requests expire after 15 minutes. The first answer wins; later answers see who decided. Approval creates a one-time pass the gate verifies like any other.

If the gate has no data at all, the walk-in screen shows the primary resident's number (synced with the house list) to call instead.

## Security model

| Threat | Mitigation |
| --- | --- |
| Forged or edited pass | Ed25519 signature checked on the gate; estate secret key never leaves the server and is AES-256-GCM encrypted with `APP_SECRET` at rest |
| Guessing 6-digit codes at the gate | Codes are only valid inside their window; keypad locks for a minute after 5 wrong codes (persists across reloads) |
| Screenshot shared widely | Entry caps per pass type, time windows, revocation on next sync, every use notifies the resident |
| Edited pass reused | Edits re-issue a new token; the gate treats a token that differs from its cached one as cancelled |
| Stolen gate phone | Device token is revocable from Admin; the phone wipes its data on next contact. Guards also need a PIN per shift |
| OTP abuse | OTPs are HMAC'd at rest, 5-minute expiry, 3 attempts, 60 s resend cooldown and 5 per hour per number |
| Session theft | Random 256-bit tokens stored only as SHA-256; HttpOnly, SameSite=Lax, Secure cookies; 30-day sliding expiry |
| Cross-estate access | Every query is scoped by the estate from the session or device; gate events referencing another estate's pass are dropped |
| Setup link misuse | `/setup` is open only on an empty install or with `SETUP_TOKEN`; an existing phone number must still sign in with an OTP |
| CSRF | SvelteKit origin checks on form actions; gate API uses bearer tokens, not cookies |

## Privacy (Nigeria Data Protection Act 2023)

- Minimal data: visitor name and optional phone; ID numbers only for household staff.
- Retention: a daily job (`/api/cron/maintenance`, triggered by `netlify/functions/maintenance.mts`) replaces visitor names and phones older than the estate's retention period (default 12 months) with `[removed]`.
- Guards see only what the gate needs. Resident phone numbers are on the gate phone solely for the offline "call the house" fallback.

## Levy-linked access

Admins mark each house *paid / owing / not set*. The estate's levy rule decides what that means:

- **off** — record only.
- **warn** (default) — the guard sees "Household is owing estate dues" on the allow screen.
- **restrict** — owing houses can't create party or multi-day passes. Guests, staff, deliveries and artisans always work, so nobody is cut off from essentials.

Every change is audited.

## Data model

`estates` (settings JSON, signing keys) → `gates`, `units` (dues status) → `memberships` (user × estate × role × house, guard PIN hash) · `users` (phone) · `invites` · `otps` · `sessions` · `staff_profiles` · `passes` (code unique among *active* passes per estate) · `access_events` (device UUID ids) · `walkin_requests` · `bans` · `devices` · `push_subscriptions` · `audit_logs` · `rate_limits`.

Schema: `src/lib/server/db/schema.ts`; migrations in `drizzle/`.
