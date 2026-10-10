---
name: opensesma-security
description: OpenSesma's security model, invariants and assessment history. Use before changing sign-in, passes, the gate protocol, admin actions, headers or secrets in OpenSesma, and when reviewing its security.
---

# OpenSesma — security model and rules

Full assessment and remediation report: `docs/security/2026-10-08-assessment.txt`
(and the Claude Doc "OpenSesma Security Assessment",
https://claude.ai/code/artifact/32e0febb-43b0-41dd-bb21-2f71b29d0c21).
`tests/security.test.ts` and `tests/signInLinks.test.ts` keep each fix in
place: **never delete or weaken those tests to make a change pass.**

## Invariants (don't break these)

**Passes**
- Signed with the estate's Ed25519 key; the secret key stays on the server, AES-256-GCM encrypted with `APP_SECRET`. Gates hold only the public key.
- Edits re-issue the token; the gate treats a stale token as cancelled.
- Codes are 8 digits (90 million values), valid only in their window.
- Daily caps are signed into the claims (`perDay`: staff 4, artisan 4, multi-day 6). Banned visitors are refused at pass creation and at walk-in.

**Gate phones**
- Receive pass details **without signatures** and **no phone numbers** (units, bans, visitors).
- Device token rotates every 24 h, with a 10-minute grace for the previous token. Reusing an old token after that revokes the device, audits `device.token_reuse` and alerts admins. Tokens expire after 30 days unused.
- Syncs are serialised across tabs (`navigator.locks`) and always read the newest token from IndexedDB.
- Guard PINs are 6 digits, PBKDF2 at 310k iterations, with a lockout after 5 wrong in 15 min (lasts 5 min).
- Keypad lockout: 1 min after 5 wrong codes, 15 min after 10. Admins are alerted after 10 unknown codes in 15 min.

**Server re-check**
- Every uploaded entry is re-evaluated at server time; disagreements are stored in `access_events.flag` ("entries needing review").
- Clock skew over 5 min is corrected and flagged. The gate uses server-anchored monotonic time.

**Sign-in without SMS** (`src/lib/server/links.ts`)
- Tokens are 192-bit, stored only as SHA-256, single use (atomic claim), with a 3-day expiry.
- A new link cancels older unused ones.
- The GET page changes nothing; signing in is a POST, so WhatsApp link previews can't use the link.
- Refused for anyone with a membership in another estate.
- Invite links are bearer links too, so the same rules apply.

**Setup and SMS limits**
- `/setup` in production requires `SETUP_TOKEN`. The token holder can create estates and sign in as any estate manager, so it must stay private: never in the repo (public), docs, skills or commits.
- When SMS is on: OTPs go only to `ALLOWED_COUNTRY_CODES` (default 234), with per-IP (10/h, 40/day) and global (300/h) caps. OTPs are HMAC'd, expire in 5 min, allow 3 attempts and have a 60 s resend cooldown.

**Sessions**
- Random 256-bit tokens stored as SHA-256.
- Cookies are HttpOnly, SameSite=Lax and Secure in production, with a 30-day sliding expiry.

**Web surface**
- `safeNext` URL-parses and allowlists post-login and post-logout redirects.
- Strict CSP with `frame-ancestors 'none'`, plus X-Frame-Options DENY and HSTS on every path, including static `/gate`.
- CSV cells starting with `= + - @ tab CR` are prefixed with `'`.
- Push endpoints are allowlisted (FCM, Mozilla, Apple, Windows) and can't be reassigned to another user.
- `/api/health` publicly returns only `{ok}`; details need `Bearer CRON_SECRET`.

**Access scoping**
- Every query is scoped by estate.
- A house ID from a form must belong to the actor's estate.
- Staff accounts can't overwrite a resident.

## Assessment status (8 Oct 2026, re-tested)

- **Fixed:** F3, F4, F5, F6, F7, F8, F9, F10, F12, F13, F14, F15, F16, F17.
- **Mitigated:** F1 SMS cost abuse (bounded, not zero), F2 shared staff codes (≤4/day), F11 keypad lockout is still device-wide.
- **Partly fixed:** F20. **Owner action still open:** rotate the production DB password, which was shared in chat, then update `DATABASE_URL`.
- **Open by choice:** F18 (recycled phone numbers), F19 (name-only bans until V2 photos).
- **Accepted risks** (from the 9 Oct sign-in links change):
  - a manager can sign in as their own residents (audited);
  - the setup-token holder is effectively a super-admin.

## How to work on security here

- Any change to auth, links, passes, the gate protocol, admin actions, headers or secrets gets a regression test asserting the protection holds, in `tests/security.test.ts` or a focused test file. Test it the way it would fail: undo the fix and confirm the test goes red.
- **Write defensive tests and code-review reports only.** Don't write standalone attack or exploit tooling, even for this app. A safety system blocked that once on this project, and the user accepted code-review style findings instead.
- After security changes, walk the flows in a browser on the production build and check for zero CSP violations.
- Re-review your own fixes for regressions. Past examples:
  - DataCloneError on check-in for passes not yet cached on the gate phone;
  - two-tab token-rotation race that could get the gate phone blocked;
  - a flaky tamper test: change the *first* base64url character of an Ed25519 signature, not the last, because the last carries only 2 bits.
- When reporting findings, give an ID, severity, where, what goes wrong, impact and direction, in plain language. Keep a status table (fixed / mitigated / open) and say how each fix was verified.
- Secrets live only in Netlify env vars. If a user pastes a secret into chat, use it only where it belongs and recommend rotating it.

## Pre-launch checklist (owner)

- [ ] Rotate the DB password, then update `DATABASE_URL`.
- [ ] Turn off Netlify team login after the estate is created.
- [ ] Add an uptime monitor and error tracking.
- [ ] Set up daily backups, and test one restore.
- [ ] Publish a privacy notice and a data-processing agreement with each estate (NDPA 2023).
