---
name: opensesma-product
description: OpenSesma product requirements, PRDs, decisions and business context. Use when deciding what to build or how a feature should behave in the OpenSesma estate access-control app.
---

# OpenSesma — product requirements and decisions

OpenSesma replaces "call the gate to let someone in" in Nigerian/African
residential estates. Residents issue passes; a guard verifies them on a cheap
Android phone in seconds, **even with no power or data at the gatehouse**.
Browser PWA only (no app store). Owner: Emmanuel (Hunter-007 on GitHub).

- Full spec (MVP, features, PRDs): Claude Doc "Estate Access Control Platform — MVP, Features & PRDs"
  https://claude.ai/code/artifact/eaf0a96e-8e2b-4ff1-ae80-7e30258dec32
- Live: https://opensesma.netlify.app · Repo: https://github.com/Hunter-007/opensesma (public)

Before changing behaviour, check it against the decisions below. If a
request contradicts one, say so and ask; don't silently override.

## Decisions (owner-confirmed)

| Topic | Decision |
| --- | --- |
| Name | OpenSesma |
| Buyer / admin | The estate manager (or residents' association exco). Estates pay; residents and visitors never pay or install anything |
| Gates | Usually 2, each serving pedestrians and vehicles; treated identically in the MVP |
| Gate conditions | Power and internet unreliable → offline-first guard console is a hard requirement |
| Visitor photos | On hold for V1 (bans are name/phone only until photos arrive in V2) |
| Vehicle plates | V2 |
| Levy-linked access | In the MVP: rule per estate = off / warn guard / restrict (owing houses can't create party or multi-day passes). Essentials (guest, staff, delivery, artisan) always work |
| SMS provider | **None in the MVP** (9 Oct 2026). Termii was too expensive/restrictive. The app sends nothing; people share from their own phones |
| Pass delivery | Resident taps **WhatsApp** (wa.me) or **Text message** (sms: link) on the pass screen; message pre-filled with code + short link `/v/<pass id>` |
| Sign-in | **One-time sign-in links**, not SMS codes. Manager sends them from People → "Sign-in link"; house/household invites sign the person in on Join. Managers recover via the private setup link |
| Guards | Never sign in to the web app. Gate phone is enrolled with a setup code; each guard starts a shift with a 6-digit PIN |
| SMS code login | Kept in code; switches back on automatically if `SMS_DRIVER=termii` + `TERMII_API_KEY` are set |
| Don't build | A home-made SMS sender (Android SIM gateway, etc.): grey route, SIM bans, DND, NCC licensing. Prefer web push / WhatsApp share / links |

## Personas and surfaces

| Who | Surface | Job |
| --- | --- | --- |
| Resident (primary, sub) | `/app` | Create & share passes, approve walk-ins, add household members and staff, see history |
| Visitor | `/p/<token>` (via `/v/<id>`) | Show QR or 8-digit code. No app, no login, no JS |
| Guard | `/gate` on shared gate phone | Scan/type code → full-screen ALLOW/DENY, check in/out, walk-in request, override with reason. Works offline |
| Estate manager / security officer | `/admin` | Houses & dues, people, gate phones, gate log + CSV, reports, ban list, settings |

## Pass types (PRD 2)

| Type | Window | Entries | Notes |
| --- | --- | --- | --- |
| Guest | Today now→+12 h, or a chosen time | 1 entry | Name required |
| Delivery | Now → +2 h | 1 | No name needed |
| Artisan / service | Date + hours | Unlimited in window, **max 4/day** | Purpose required |
| Multi-day | Start → end date | **max 6/day** | |
| Event / group | Date + hours (overnight OK) | Capacity cap (e.g. 40) | One code for a party |
| Staff (recurring) | Days + hours, no end | **max 4/day** | Max 6 staff per house; ID on file |

- Every pass: 8-digit numeric code (unique among active passes), signed QR token, share link.
- Revoke/edit propagates to gates on next sync (≤60 s online); edits re-issue the token.
- Per-household active pass cap (default 50).

## Core flows

- **Visit:** resident creates pass → shares via WhatsApp/text → visitor shows QR or reads code → gate verifies locally → check in → resident sees "Came in".
- **Walk-in (PRD 4):** guard enters house + name → web push to household with Let in/Decline → first answer wins → after 3 min guard sees "call the resident". (The SMS fallback at 45 s only fires when SMS is configured.)
- **Override (GO-06):** mandatory reason; admin alerted; protects the guard.
- **Offline gate (PRD 3):** decisions on-device; events queue in IndexedDB and upload idempotently; server re-checks every entry and flags disagreements ("entries needing review").
- **Onboarding (PRD 1):** manager adds houses (or CSV import), sends each resident their invite on WhatsApp; heads of household invite their own members. The estate-wide "join link" needs SMS sign-in, so it's hidden while SMS is off.

## Non-functional requirements

- Resident app first load ≤3 s on 3G; initial JS ≤200 KB gzipped; visitor page ≤100 KB, works without JS.
- Gate result ≤2 s offline on a 2 GB RAM Android 8+ phone; usable offline 6+ h; zero data loss on sync.
- Guard UI: ≥48 px targets; colour + icon + text for every state; plain language.
- Strict estate isolation; NDPA 2023 (minimal data, 12-month retention then anonymise, export/delete on request).

## MVP done = success metrics (pilot estate, 60 days)

≥70% of households onboarded in 30 days · ≥80% of visitor entries via pass by
day 60 · median gate check ≤10 s · walk-in decision ≤2 min · 100% offline
entries synced · signed paid plan after pilot. MVP is done when one estate runs
a month with zero "please confirm this visitor" calls and the paper logbook is retired.

## Roadmap

- **V2 (months 4–6):** visitor photos + photo bans, vehicle plates, overstay alerts, resident self-entry pass, exit item checks, shift handover, guard SOS, local-language UI, announcements, dues payment (Paystack/Flutterwave), WhatsApp API.
- **V3 (7–12):** hardware (boom/ANPR/turnstile), multi-estate FM companies, facility booking, artisan directory, USSD.
- Open product risks: recycled phone numbers (household re-confirmation), name-based bans (photos).

## Business context (9–10 Oct 2026, to validate)

- Pricing hypothesis: **₦150 per house per month, minimum ₦25,000/estate**; annual prepay = 2 months free; free 2–3 month pilot for the first 10 estates. Competitors don't publish prices — validate with 5 estate committees.
- Sizing: 500 visitors/day ≈ 250–500 houses ≈ 7.5k requests/day, 1–2 GB/month, ~150 MB/year of data.
- Infra plan: Netlify free during pilot → one VPS (Hetzner/Contabo ~€4) + Cloudflare free + off-site backups at ~3 paying estates. Revenue is in naira; minimise dollar costs.
- Text messages if ever needed: aggregators like BulkSMSNigeria publish ~₦6.49/SMS; WhatsApp Cloud API utility ≈ $0.0067/msg (more expensive). Texting every pass would cost ~₦97k/month for a busy estate — why sharing from the resident's phone matters.

## Writing for users

Short, plain sentences; Nigerian context (house numbers, streets, "estate
manager", naira). Guards may have limited English: one idea per screen, big
buttons. Never show resident phone numbers to visitors or gate phones.
