OPENSESMA SECURITY ASSESSMENT AND REMEDIATION REPORT
====================================================

Date:            8 October 2026
Prepared for:    Emmanuel (OpenSesma)
System:          OpenSesma estate access control PWA
                 https://opensesma.netlify.app  (repo: github.com/Hunter-007/opensesma)
Code reviewed:   commit efa38c6 (before fixes)
Fixes in:        commit 2b41096, deployed to production 8 Oct 2026 19:08 UTC
                 (deploy 6ac7e9f7740cb600089d8148; database migration
                 0001_security_hardening applied; Netlify secret scan: 0 matches)


1. SUMMARY
----------

The core cryptography held: passes cannot be forged or edited. The weak
points were around it - who could make the app pay for SMS, how far one pass
could be shared, and how much a single gate phone exposed.

The review found 20 issues: 0 critical, 4 high, 7 medium, 6 low,
3 informational.

After remediation:
  Fixed ............ 14   (F3, F4, F5, F6, F7, F8, F9, F10, F12, F13, F14,
                           F15, F16, F17)
  Mitigated ........  3   (F1, F2, F11)
  Partly fixed .....  1   (F20 - remaining step is an owner action)
  Open by choice ...  2   (F18, F19)

Two further problems were found while re-reviewing the fixes; both were
fixed before release (section 6).

Actions still needed from you (section 8): change the database password,
use the /setup link once and then keep Netlify team login on until setup is
done, and add Termii keys only after confirming the SMS limits suit you.


2. SCOPE AND METHOD
-------------------

Approach: white-box review from an attacker's point of view. For each role -
anonymous visitor, resident, household member, guard, gate phone, security
officer and estate manager - every input the server trusts was traced end to
end.

Areas: login and sessions; invites and join requests; pass creation and the
shared decision rules; gate sync and upload protocol; walk-ins and SMS links;
admin actions and CSV export; push notifications; HTTP headers; the service
worker; secrets and dependencies.

Not tested: the live site (behind Netlify team login and unreachable from the
review workspace); Netlify's and Termii's infrastructure; physical attacks on
the gate; social engineering of guards beyond what the app shows them.

Severity combines ease of exploitation with real cost to an estate: money,
a stranger getting in, or residents' data leaking.


3. FINDINGS AT A GLANCE
-----------------------

ID   Severity  Finding                                              Status
---  --------  ---------------------------------------------------  ------------
F1   High      Login codes sent to any number worldwide; no per-IP  Mitigated
               or global limit (SMS cost abuse)
F2   High      Artisan, multi-day and staff passes admit unlimited  Mitigated
               people; staff passes bypass event caps and levy rule
F3   High      Gate phone token never expires; downloads every      Fixed
               pass, resident phone number and guard PIN hash
F4   High      Open redirect in the login "next" parameter          Fixed
F5   Medium    Six-digit gate codes can be guessed                  Fixed
F6   Medium    Server accepts gate decisions without re-checking;   Fixed
               validity depends on the gate phone's clock
F7   Medium    CSV export allows spreadsheet formula injection      Fixed
F8   Medium    No Content-Security-Policy; guard console framable   Fixed
F9   Medium    Admin invite accepts a house from another estate     Fixed
F10  Medium    Push subscriptions accept any HTTPS address and can  Fixed
               be reassigned
F11  Medium    Keypad lockout freezes code entry for everyone;      Mitigated
               client-side only
F12  Low       Public health check reveals configuration and raw    Fixed
               database errors
F13  Low       Dues status accepts any value                        Fixed
F14  Low       Making a resident a guard/manager silently removes   Fixed
               them from their house
F15  Low       Join link lists every house address; requests        Fixed
               default to head of household
F16  Low       No limit on guard PIN attempts on the gate phone     Fixed
F17  Low       Visitor pass page shows host's name and phone        Fixed
F18  Info      Recycled phone numbers inherit old accounts          Open
F19  Info      Ban list matches exact names only                    Open
F20  Info      Secret handling (DB password in chat, single master  Partly fixed
               secret, first visitor owns a fresh install)


4. FINDINGS IN DETAIL, WITH REMEDIATION
---------------------------------------

F1 - SMS cost abuse through the login form                        HIGH
  Where:    requestOtp (src/lib/server/auth.ts); normalisePhone.
  Issue:    Limits were per phone number only (1/min, 5/hour). Nothing
            limited how many different numbers one client could target, and
            international numbers were accepted, enabling "SMS pumping" to
            premium ranges.
  Impact:   Once SMS_DRIVER=termii, each abusive request is a charge, and the
            balance can be drained so real residents stop getting codes.
  Fix:      - Codes only sent to allowed country codes (ALLOWED_COUNTRY_CODES,
              default 234).
            - Per network (IP): 10 codes/hour, 40/day (OTP_PER_IP_PER_HOUR).
            - Service-wide: 300 codes/hour, then "try again shortly"
              (OTP_GLOBAL_PER_HOUR).
            - Code verification limited to 30 attempts/hour per IP.
            - Resident-triggered SMS (pass shares) capped at 20/house/day.
  Status:   MITIGATED.
  Residual: Under a large distributed attack, real users may hit the
            service-wide cap and have to wait. Cost is bounded, not zero.
  Tests:    tests/security.test.ts "F1" block.

F2 - One pass can admit unlimited people                          HIGH
  Where:    resolvePassShape (src/lib/server/passes.ts); addStaffProfile.
  Issue:    Artisan, multi-day and staff passes had maxEntries = 0
            (unlimited). Staff passes are "essential", so they kept working
            under the levy restriction and had no guest cap.
  Impact:   One forwarded code could admit a whole party or a stream of
            strangers, sidestepping event capacity and the levy rule.
  Fix:      - Daily entry caps signed into the pass (staff 4, artisan 4,
              multi-day 6), enforced on the gate phone even offline and
              re-checked by the server.
            - Guard warned when a pass is already inside and was not checked
              out.
            - At most 6 staff profiles per house.
            - Banned names/phones refused at pass creation.
  Status:   MITIGATED.
  Residual: A staff code can still admit up to 4 people a day. Staff passes
            still work when dues are owed (by design - nobody is cut off from
            essentials).

F3 - A gate phone holds the whole estate                          HIGH
  Where:    buildSync, authDevice (src/lib/server/gate.ts); gate IndexedDB.
  Issue:    Device token never expired or rotated. Full sync returned every
            pass token, code, primary resident phone number, the ban list and
            guard PIN hashes. 4-digit PINs were trivially recoverable offline.
  Impact:   A stolen or infected gate phone leaked residents' numbers and
            every live pass (replayable as genuine QR codes) until noticed.
  Fix:      - Sync sends pass details without signatures (cannot be replayed
              as QR) and no phone numbers (units, bans, visitors).
            - Device token rotates every 24 h; old token valid 10 min grace;
              reuse after that blocks the device and alerts the manager.
            - Tokens expire after 30 days unused.
            - Guard PINs 6 digits, PBKDF2 310,000 iterations.
            - Offline walk-in fallback no longer shows a resident number.
  Status:   FIXED.
  Residual: Codes and visitor names are still cached unencrypted on the
            phone (needed for offline checks). No alert yet when a device
            syncs from a new network.

F4 - Open redirect after login                                    HIGH
  Where:    safeNext (src/routes/login/+page.server.ts).
  Issue:    Any "next" starting with "/" but not "//" was accepted; "/\host"
            is treated by browsers as another site.
  Impact:   A genuine OpenSesma login link could forward residents to a
            look-alike phishing site after a real sign-in.
  Fix:      src/lib/shared/redirect.ts parses with URL, requires same origin,
            rejects backslashes, control characters and encoded slashes, and
            allows only /app, /admin, /join, /gate, /welcome, /w/, /setup.
  Status:   FIXED. Verified in tests and in the browser walkthrough.

F5 - Codes can be guessed at the gate                             MEDIUM
  Issue:    900,000 six-digit codes; with ~300 active passes, about a 10%
            chance per hour of a hit within the old lockout.
  Fix:      8-digit codes (90 million, unbiased generation, shown "4821 9163");
            keypad locks 1 min after 5 wrong codes and 15 min after 10;
            manager alerted after 10 unknown codes in 15 minutes.
  Status:   FIXED. Expected guesses per hit now in the hundreds of thousands
            while lockouts cap attempts at ~40/hour.

F6 - The server trusted gate decisions blindly                    MEDIUM
  Issue:    Uploaded entries were recorded without re-checking revocation,
            expiry or hours; time windows used the phone's own clock.
  Impact:   A dishonest guard or edited phone clock could admit people on
            dead passes with no warning to the manager.
  Fix:      - Server re-runs the decision rules for every uploaded entry at
              the entry time, flags cancelled/expired/out-of-hours/over-limit
              entries, and alerts admins.
            - Phone clock compared with server time on upload; skew over
              5 minutes is corrected and flagged.
            - Gate keeps server-anchored time after each sync, so changing
              the phone's date has no effect.
            - Admin log filter "Only entries needing review" and dashboard
              tile.
  Status:   FIXED.
  Residual: Flags are raised after the fact, when the phone uploads.

F7 - Formula injection in the CSV export                          MEDIUM
  Fix:      Cells starting with = + - @ tab or CR are prefixed with ' so
            spreadsheets show them as text.
  Status:   FIXED.

F8 - No CSP; guard console could be framed                        MEDIUM
  Fix:      Strict Content-Security-Policy on every page (default-src
            'self', script-src 'self', frame-ancestors 'none', object-src
            'none', base-uri/form-action 'self'); X-Frame-Options DENY and
            HSTS on every path in netlify.toml, including the static /gate.
  Status:   FIXED. Browser walkthrough recorded zero CSP violations.
  Residual: Inline styles still allowed (style-src 'unsafe-inline').

F9 - Admin invites could reference another estate's house         MEDIUM
  Fix:      Invite house must belong to the admin's estate, else refused.
  Status:   FIXED. (No database-level constraint added.)

F10 - Push subscriptions accepted any address                     MEDIUM
  Fix:      Only Google (fcm.googleapis.com), Mozilla, Apple
            (*.push.apple.com) and Microsoft (*.notify.windows.com) push
            hosts over https on the default port; an existing subscription
            can't be moved to another user (409; the app re-subscribes).
  Status:   FIXED.

F11 - Keypad lockout can freeze the gate                          MEDIUM
  Fix:      Escalating lockout plus manager alert on repeated wrong codes;
            QR scanning and walk-ins keep working during a lock.
  Status:   MITIGATED.
  Residual: The lock still pauses typed-code entry for everyone at that
            gate phone.

F12 - Health check said too much                                  LOW
  Fix:      Public /api/health returns only {ok}; details require
            "Authorization: Bearer <CRON_SECRET>".
  Status:   FIXED.

F13 - Dues status accepted any value                              LOW
  Fix:      Must be paid, owing or unknown.
  Status:   FIXED. (No database check constraint added.)

F14 - Staff account could overwrite a resident                    LOW
  Fix:      Adding a guard/manager with a resident's phone is refused.
  Status:   FIXED.

F15 - Join link exposed every address                             LOW
  Fix:      Join page lists streets only; house number is typed and matched
            on the server (5 attempts/hour per user). Newcomers to a house
            that already has a head join as household members; the manager
            sees the requested role before approving.
  Status:   FIXED.
  Residual: Street names are still visible to anyone with the link.

F16 - No limit on guard PIN attempts                              LOW
  Fix:      5 wrong PINs in 15 minutes lock shift sign-in for 5 minutes; the
            counter survives reloads. PINs are now 6 digits.
  Status:   FIXED.

F17 - Visitor page showed host phone                              LOW
  Fix:      Visitor page shows the host's first name only, no number.
  Status:   FIXED.

F18 - Recycled phone numbers                                      INFO
  Status:   OPEN (accepted). Revisit with periodic household
            re-confirmation and expiry of long-unused memberships.

F19 - Ban list easy to dodge                                      INFO
  Status:   OPEN (accepted). Server now also refuses passes and walk-ins for
            banned names/phones, but name-based bans stay easy to dodge until
            visitor photos arrive in V2.

F20 - Secret handling                                             INFO
  Fix:      - /setup requires SETUP_TOKEN in production (set in Netlify).
            - APP_SECRET can be rotated: set APP_SECRET_PREVIOUS, then run
              "npm run secrets:rotate".
  Status:   PARTLY FIXED.
  Residual: The production database password was shared in chat during
            setup and must be changed by you (section 8).


5. WHAT HELD UP (BEFORE AND AFTER)
----------------------------------

Forging or editing a pass ............... Blocked (Ed25519 signatures; key
                                          encrypted at rest, never leaves
                                          server)
Reusing an old QR after edit/cancel ..... Blocked once the gate syncs
Using one estate's pass at another ...... Blocked (estate ID in signed pass)
Guessing a login code ................... Impractical (hashed, 5-min expiry,
                                          3 tries, rate limits)
Stealing sessions from the database ..... Blocked (SHA-256 hashes only;
                                          HttpOnly, SameSite=Lax, Secure)
Reading another household's data ........ Blocked (all queries scoped)
CSRF .................................... Blocked (origin checks; bearer
                                          tokens for gate APIs)
SQL injection ........................... Blocked (parameterised Drizzle)
Cross-site scripting .................... Not found (Svelte escaping; now
                                          also CSP)
Guessing a gate setup code .............. Impractical
Answering another's walk-in SMS link .... Impractical (96-bit, single use,
                                          15-min expiry)
Vulnerable dependencies ................. None (npm audit, production)
Secrets in repository or build .......... None (Netlify secret scan: 0)


6. PROBLEMS FOUND DURING THE RE-REVIEW (FIXED)
----------------------------------------------

1. The browser walkthrough caught a bug introduced by the fixes: check-in
   failed for a pass not yet cached on the gate phone (browser storage could
   not save the in-memory pass object). Fixed, with a regression test that
   fails without the fix.

2. Re-reading the token-rotation change showed that two open tabs of the
   guard console could leave one tab holding a stale token, which would have
   been treated as a stolen copy and blocked the phone. Syncs now take turns
   across tabs and always read the newest token from storage. Covered by a
   test.


7. VERIFICATION
---------------

- Automated tests: 97 passing (46 new). tests/security.test.ts has one or
  more tests per finding, each written to fail on the old behaviour.
- Test effectiveness check: four fixes were deliberately undone; each time
  the matching security tests failed (5 failures), then the fixes were
  restored.
- End-to-end browser walkthrough of the production build: resident pass
  creation and sharing, visitor page, guard console online and offline,
  walk-ins, overrides, admin log and CSV. Also confirmed CSP and
  X-Frame-Options headers, that /login?next=/%5Cevil.com stays on-site, and
  zero CSP violations on resident, gate and admin pages.
- Type-check (svelte-check): 0 errors, 0 warnings.
- npm audit (production dependencies): 0 vulnerabilities.
- Production deploy of 2b41096: ready; migration 0001_security_hardening
  applied; secret scan of 138 files found nothing.
- Not re-tested against the live site (team login; unreachable from the
  review workspace).


8. ACTIONS FOR THE OWNER
------------------------

1. Change the database password (Netlify > Database) and update the
   DATABASE_URL environment variable. The current one was shared in chat.
2. Create your estate once using the setup link (sent separately; it
   contains SETUP_TOKEN). Keep Netlify team login on until that is done.
3. Gate phones: guard PINs are now 6 digits and gate codes 8 digits. Gate
   phones enrolled before this release keep working and pick up the new
   rules on their next sync.
4. Before switching on real SMS (SMS_DRIVER=termii plus Termii keys), check
   the limits: ALLOWED_COUNTRY_CODES (default 234), OTP_PER_IP_PER_HOUR
   (default 10), OTP_GLOBAL_PER_HOUR (default 300). Set a low-balance alert
   in Termii.
5. Later: plan F18 (household re-confirmation) and F19 (photos in V2).
