# Specialist optimization audit — 2026-07-31

Eight specialist lenses swept the codebase in parallel on 2026-07-31 — UX/interaction design,
frontend performance, accessibility, SEO/growth, security/privacy, ML & data, backend/data
architecture, and developer/agent experience — producing ~70 prompt-ready tasks. **Five lenses have
since been delivered in full and their prompts removed from this file**; what remains below is the
still-open work, and only that.

Every task's *Prompt* is written to be handed verbatim to an implementation agent with zero other
context. Priorities and effort are the auditor's estimate; **a human decides what actually gets
built** — nothing here is committed scope. Tasks were grounded in the code as of 2026-07-31;
re-verify file paths against `AGENTS.md`'s route map before starting one, **line numbers have
drifted and are anchors, not gospel** (re-locate by symbol name), and follow the Parallel-work rules
(check open PRs for overlap) before claiming a slice.

## Status by lens

Code comments across `src/` cite this document by section number, so the numbering is stable — a
delivered lens keeps its row here rather than being renumbered away.

| § | Lens | State |
| --- | --- | --- |
| 1 | UX & interaction design | ✅ **Delivered** 2026-08-01 (PR #291) — see [shipped.md](../shipped.md#specialist-optimization-audit--five-lenses-delivered-2026-07-31--08-01) |
| 2 | Frontend performance | ✅ **Delivered** 2026-08-01 (PR #286), except marketing-page caching — [reopened as independent work](#2-frontend-performance-one-task-open) |
| 3 | Accessibility | ◐ **Partly delivered** — the skip link, `<html lang>`, and the shortcuts-dialog focus trap landed with the ux-persona work; waiver field errors, schedule-builder panel focus, and automated axe scans landed 2026-08-01; [three contrast tasks open](#3-accessibility-three-contrast-tasks-open), deliberately deferred — see that section |
| 4 | SEO & growth | ✅ **Delivered** 2026-08-01 (PR #288) |
| 5 | Security & privacy | ○ **Open** — [seven tasks](#5-security--privacy-open), none started |
| 6 | ML & data | ○ **Open** — [eight tasks](#6-ml--data-open), none started |
| 7 | Backend & data architecture | ✅ **Delivered** 2026-08-01 (PR #292) |
| 8 | Developer & agent experience | ✅ **Delivered** 2026-08-01, including the CI composite action |

What the delivered lenses actually shipped is indexed in
[shipped.md](../shipped.md#specialist-optimization-audit--five-lenses-delivered-2026-07-31--08-01);
the mechanisms live in the code and the ADRs it links.

---

## 2. Frontend performance (one task open)

The other eight tasks in this lens shipped: the sharp resize bound, `next/image` across every photo
surface, per-namespace diver message payloads, the Sentry client-bundle trim, Suspense streaming on
the public schedule plus the remaining staff `loading.tsx` files, parallelized page prologues, the
command-palette GET route, and the hoisted `AddPanel`.

### Cache the marketing pages per locale

- **Priority**: medium (was high; the cheap version was tried and reverted)
- **Effort**: L — this is now a suite-migration task with a page-caching payoff, not an S/M page change
- **Status**: attempted and reverted. Commit d8e7b32 turned on `nextConfig.cacheComponents` and
  cached the seven marketing pages (`/`, `/pricing`, `/product`, `/about`, and the three
  `/switching/**` routes) per negotiated locale with `"use cache"`. Commit 100fcf8 reverted it the
  same day: the flag is app-wide and unconditionally enables React `<Activity>` state preservation
  for client-side navigation everywhere, which broke 22+ pre-existing e2e specs across unrelated
  surfaces. The two ADRs that came out of that attempt are the current state of the art —
  [20260801-cache-components-activity-state](../../architecture/decisions/20260801-cache-components-activity-state.md)
  (superseded; the staff-surface state-handling fixes it prompted are still in the tree, inert) and
  [20260801-cache-components-e2e-activity-migration](../../architecture/decisions/20260801-cache-components-e2e-activity-migration.md)
  (proposed; the migration plan).
- **Prompt**: Do **not** re-attempt this as a page-caching change. The prerequisite is its own piece
  of work: execute the migration plan in ADR
  `20260801-cache-components-e2e-activity-migration.md` — sort the suite's `getByText` and raw
  `.locator()` call sites into "safe" and "needs `.filter({ visible: true })`" per the bundled Next
  docs (`node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`, "Testing"), fix the
  leaf matchers, and only then re-enable `cacheComponents` and restore the `"use cache"` marketing
  pages. `src/i18n/request.ts`'s module comment already records why the pages are dynamic today and
  what the fix looks like; keep it in sync. Ship the suite migration and the flag flip as separate
  reviewable steps so a revert of one doesn't drag the other.
- **Verification**: the whole e2e fleet green with `cacheComponents` on, twice in a row (Activity
  breakage was intermittent per-spec); then `pnpm build` output shows the seven marketing routes as
  static/partially-prerendered rather than fully dynamic, and
  `curl -H "Accept-Language: es" localhost:3000/pricing` still returns Spanish.

---

## 3. Accessibility (three contrast tasks open)

Auditor's baseline: much is genuinely good — semantic radios for star ratings, fieldset/legend
medical questions, widespread `aria-live`, a reduced-motion kill-switch, glare/boat contrast modes.
Contrast ratios below were computed from the actual token hex values and re-verified 2026-08-01
against the current `src/app/globals.css` — all three contrast tasks are still failing today.

Delivered since the audit, by other work: the document `lang` now comes from the negotiated locale
(`src/app/layout.tsx`), a skip link ships in both the root and shop layouts
(`src/components/SkipLink.tsx`), the keyboard-shortcuts dialog has a real focus trap
(`useFocusTrap` in `src/components/KeyboardShortcuts.tsx`), and `.progress-wave-fill` is now
neutralised by the reduced-motion block.

Delivered 2026-08-01, non-contrast: the waiver page's `signerName`/`acknowledged` controls now carry
`required`/`minLength`, the fallback error banner names and links to the specific field that failed
(`firstInvalidWaiverField` in `src/app/waivers/[token]/page.tsx`); the schedule builder's Add/Move/Copy
panels move focus into their first field on open and return it to the toggle on Cancel, and the
hand-rolled Cancel buttons now go through `buttonClass({ variant: "ghost", size: "sm" })`
(`src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx` — the panel-completion
announcement this task also asked for turned out to already exist, via the `ShopNotice role="status"`
banner `ScheduleBoardPage` renders from `?builder=added|moved|copied|removed`, so no new region was
needed there); and `@axe-core/playwright` now scans five surfaces in `e2e/a11y.spec.ts` on every CI
run (ADR [20260801-axe-core-playwright-a11y-scans](../../architecture/decisions/20260801-axe-core-playwright-a11y-scans.md)).

**The three contrast tasks below are deliberately still open** — the product owner ruled out
touching contrast values in the same pass that delivered the rest of this lens (it would fight the
current color guide), so they stay tracked here rather than folded into "delivered." The axe scan
above excludes the `color-contrast` rule for exactly this reason (see the spec's own comment) — it
would otherwise fail on this same known, tracked debt on every run.

### Fix the global focus indicator's contrast in light mode

- **Priority**: high
- **Effort**: S
- **Prompt**: In `src/app/globals.css`, the app-wide keyboard focus indicator is `outline: 3px solid color-mix(in srgb, var(--primary) 55%, transparent)` (in the `:where(a, button, input, select, textarea, summary):focus-visible` rule). In the light palette that computes to ~2.3:1 against `--background` (#faf9f6) and `--surface` (#ffffff), failing WCAG 1.4.11's 3:1 minimum for focus indicators — keyboard staff users can lose the focus ring entirely in sunlight. Introduce a dedicated semantic token (e.g. `--focus-ring`) defined per scheme in the `:root` and dark blocks — full-strength `--primary` in light mode is 5.36:1 on white and passes — and use it in the `:focus-visible` rule instead of the 55% mix. Keep the token semantic per ADR-0004 and also define it in the `.boat-mode` and `.glare-mode` blocks so those palettes keep a passing ring. Do not weaken the dark-mode ring (currently ~3.8:1, passing).
- **Verification**: Recompute ratios with the same formula (a small node script against the hex values) confirming ≥3:1 for light, dark, boat, and glare palettes; keyboard-Tab through `/sign-in` and the schedule in light mode and screenshot to confirm the ring is clearly visible; `pnpm check` green (the token change must not trip the semantic-token safeguard).

### Raise tinted status-banner text above 4.5:1

- **Priority**: medium
- **Effort**: S
- **Prompt**: Light-mode success and warning text on their 10% tinted fills fails AA for the small text sizes used: `--success` #15803d on `bg-success/10` over white computes to 4.38:1 and `--warning` #b45309 on `bg-warning/10` to 4.39:1. Concrete instances: the waiver "progress saved" banner (`text-sm font-medium text-success` on `bg-success/10`, `src/app/waivers/[token]/page.tsx`), the payment-received panel (`text-success` on `bg-success/10`, `src/app/shop/[shopSlug]/schedule/[id]/_components/BookingConfirmation.tsx`), and warning-tinted notices/`ShopNotice tone="warning"` surfaces. Fix at the token level in `src/app/globals.css`: darken light-mode `--success` to ~#166534 and `--warning` to ~#92400e (the values boat-mode already uses), then re-verify every existing light-mode use of `text-success`/`text-warning` on `bg-surface`, `bg-background`, and the /10 tints clears 4.5:1. Dark mode already passes (7.5–8:1) — do not touch it.
- **Verification**: Node contrast script over the new hex values against `#ffffff`, `#faf9f6`, `#f1efe9`, and each color mixed at 10% over white, all ≥4.5:1; `pnpm visual` and review the diffs (an intentional token darkening, explained in the PR per the visual-triage skill); light/dark screenshots of the waiver saved banner and booking payment panel.

### Fix placeholder text contrast

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/app/globals.css` sets `input::placeholder`/`textarea::placeholder` to `color-mix(in srgb, var(--muted) 78%, transparent)`, which computes to 3.35:1 on white surfaces and 3.07:1 on `--surface-sunken` in light mode — placeholder text is real text under WCAG 1.4.3 and needs 4.5:1 (the schedule builder's title placeholder and search inputs rely on it). Change the rule to use `var(--muted)` at full strength (5.0:1 on background, 4.58:1 on sunken — passing) or raise the mix to a percentage that clears 4.5:1 on the darkest light-mode surface it sits on; placeholders remain visually distinct from typed text because typed text uses `--foreground`, not `--muted`. Dark mode currently sits at 4.54:1 — keep it at or above that.
- **Verification**: Node contrast script confirming ≥4.5:1 for the computed placeholder color over `#ffffff`, `#faf9f6`, and `#f1efe9` (light) and `#0d222d` (dark); axe run (or DevTools contrast checker) on the schedule builder's Add panel; `pnpm visual` diff reviewed and explained.

---

## 5. Security & privacy (open)

Auditor's baseline — explicitly checked and found sound (no task needed): bearer/account token
entropy and hashing (256-bit CSPRNG, SHA-256 at rest, single-use consume with atomic `WHERE`,
supersession, disabled-account re-check); Svix and Stripe signature verification (timing-safe,
fail-closed, 300s replay tolerance); CSV export formula-injection escaping and per-shop scoping;
SSRF guarding in `src/lib/storage/ingest-url.ts` (DNS + private-range checks + no redirects +
bounded reads); tenant isolation in server actions (mutations consistently use
`session.user.shopId`, never the URL slug); the embed/frame-header logic in `src/proxy.ts`; and
observability URL redaction of token path segments. Every task below is security-sensitive and
needs a `security-reviewer` pass before merge per the repo's hard rules.

Nothing in this lens has been started; all seven findings were re-confirmed present in the tree on
2026-08-01.

### Close the revocation window on base staff surfaces

- **Priority**: high
- **Effort**: S
- **Prompt**: `requireStaffSession()` in `src/lib/session.ts` trusts the roles baked into the JWT at sign-in and never re-checks the database, and no `session.maxAge` is set in `src/lib/auth.config.ts` (`session: { strategy: "jwt" }` only; Auth.js default: 30 days). The H-14 gates in `src/db/authz.ts` (`loadActiveStaffRoles`) already close this for refunds/exports/etc., but base staff surfaces — including the manifest page at `src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx` and diver profiles, which show medical flags and full rosters — only call `requireStaffSession`. A disabled or deleted staff member therefore keeps read access to PII/medical data for up to 30 days. Add a live check to `requireStaffSession` (person not deleted + `userAccounts.status === "active"`, mirroring `loadActiveStaffRoles`, redirecting to `/sign-in` on failure), and set an explicit shorter `session.maxAge`. This is auth/authz and medical-data-adjacent: it requires a `security-reviewer` pass before merge, and manifests are safety-critical so keep the code boring.
- **Verification**: Test in a new `session.test.ts`: sign in a staff member, set their `userAccounts.status` to `disabled` (and separately soft-delete the person), then assert `requireStaffSession` redirects even though the JWT still carries staff roles. Add an e2e assertion that a disabled staff account gets bounced from `/shop/<slug>/trips/<id>/manifest`.

### Use a CSPRNG for blob object keys holding card images

- **Priority**: high
- **Effort**: S
- **Prompt**: In `src/lib/storage/index.ts`, `vercelBlobStorageProvider.upload` builds the object path with `Math.random().toString(36).slice(2, 10)` and explicitly disables Vercel's own suffix (`"x-add-random-suffix": "0"`). These blobs live on the *public*, unauthenticated `*.public.blob.vercel-storage.com` host, and they include certification-card photos (name, DOB, card number — uploaded via `resolveCardImage` in `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`). URL unguessability is the only access control, yet the suffix is ~41 bits from a non-cryptographic PRNG whose state is observable/predictable. Replace it with `randomBytes(16).toString("base64url")` from `node:crypto` (≥128 bits), matching the discipline `src/lib/bearer-tokens.ts` documents. Do not enable `x-add-random-suffix` instead — keep the key deterministic-in-shape so `isManagedBlobUrl` and the deletion queue keep working. Security-sensitive (personal-data rows): needs a `security-reviewer` pass before merge.
- **Verification**: Extend `src/lib/storage/index.test.ts`: capture the PUT pathname across many uploads and assert the suffix is 22 base64url chars and that two providers created in the same tick never collide; grep the module to assert `Math.random` no longer appears.

### Check Stripe event livemode before mutating payment state

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/app/api/webhooks/stripe/route.ts` accepts events verified by either `STRIPE_WEBHOOK_SECRET` or the fallback `STRIPE_TEST_WEBHOOK_SECRET`, then applies them identically — `markCheckoutPaidBySessionId`, `markOrderPaidByInvoiceId`, `setShopStripeAccountStatus` — without ever inspecting `event.livemode`. If both secrets are set in a production deployment, a correctly-signed *test-mode* event (which anyone with access to the platform's test environment can generate) reaches the same handlers that flip live orders to paid; only the incidental `cs_test_`/`cs_live_` id mismatch stands in the way. Parse `livemode` in the event schema in `src/lib/payments/webhook.ts` (or in the route) and require that test-secret-verified events carry `livemode: false` and live-secret-verified events carry `livemode: true`, returning 200-and-ignore on mismatch (Stripe retries non-2xx forever). The `stripe_webhook_events` ledger added by §7 is a natural place to record the refusal. Payments are security-sensitive: needs a `security-reviewer` pass before merge.
- **Verification**: In `src/app/api/webhooks/stripe/route.test.ts`, sign a `checkout.session.completed` with the test secret but `livemode: true` (and vice versa) and assert no checkout/tip row changes state; keep the existing happy paths green.

### Add baseline security headers beyond frame protection

- **Priority**: medium
- **Effort**: M
- **Prompt**: The only security headers the app sets are `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`, stamped in `src/proxy.ts` — and its matcher excludes `/api` and static assets, so API responses and images get nothing. There is no HSTS, no `X-Content-Type-Options: nosniff`, no `Referrer-Policy`, no `Permissions-Policy`, and no script/style CSP anywhere (`next.config.ts` has no `headers()` block at all). Bearer-token pages (`/waivers/[token]`, `/ready/[token]`, `/recap/[token]`) carry the capability in the URL path, so a missing `Referrer-Policy` risks leaking live tokens to any third-party resource a page ever references. Add a `headers()` block to `next.config.ts` (so it covers all routes including `/api`): `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (consider `no-referrer` for the token routes), and a `Permissions-Policy` disabling camera/geolocation/etc. Keep the frame-header logic in `proxy.ts` — it must stay conditional on the embed exception; make sure the new config headers don't override it. A full script-src CSP is a follow-up, not this task. Read the Next.js docs in `node_modules/next/dist/docs/` first (this Next version differs from training data). Security-sensitive: needs a `security-reviewer` pass before merge.
- **Verification**: `curl -sI` against `pnpm dev` for `/`, `/shop/<slug>/schedule`, `/waivers/<garbage>`, and an `/api` route; assert the four headers everywhere, and that `/shop/<slug>/schedule?embed=1` still arrives frameable while everything else keeps `frame-ancestors 'none'`.

### Give recap tokens their own secret and a lifetime

- **Priority**: medium
- **Effort**: M
- **Prompt**: `src/lib/recap-links.ts` signs recap tokens as a stateless HMAC of the booking id, keyed directly with `authSecret` — the same secret that signs session JWTs — with no expiry and no revocation. Consequences: a recap link (which unlocks a diver's trip data, photo upload, review writing, and tip checkout via `src/app/recap/[token]/actions.ts`) works forever once it leaks from an inbox or forwarded message, and AUTH_SECRET can never be rotated for sessions without silently killing every recap link (and vice versa — the secrets' blast radii are coupled). Derive a dedicated key (e.g. `HKDF(authSecret, "recap")` or a separate `RECAP_LINK_SECRET` env var with fallback derivation) and fold an issued-at timestamp into the signed payload, rejecting tokens older than a generous window (e.g. 180 days — a diver revisiting a season later should still work; pick with the owner). Update the one place tokens are minted (`recapLinkPath`, used by `src/db/recap.ts`) and `e2e/visual.spec.ts`, which computes this token directly. Token-flow change: needs a `security-reviewer` pass before merge.
- **Verification**: Extend `src/lib/recap-links.test.ts`: a token minted with the old raw-`authSecret` scheme fails verification, a token past the window fails while one inside passes (drive via the injectable clock, never a sleep), and the purpose-separation tests still hold.

### Move sign-in and booking rate limits to a shared store

- **Priority**: medium
- **Effort**: L
- **Prompt**: `src/lib/rate-limit.ts` is an in-process token bucket, documented in ADR 20260724-rate-limiting as per-instance only. On the stated Vercel serverless target this makes the sign-in throttle in `src/lib/auth.ts` (20/15min per IP, 8/15min per email) close to a no-op: each cold-started function has fresh buckets, so a distributed credential-stuffing run is bounded only by function fan-out. The seam is already provider-shaped — implement a `RateLimitStore` backed by a shared store (Upstash Redis is the natural Vercel fit; a new runtime dependency requires an ADR per repo rules), keep the existing fail-open contract (`checkRateLimit` must never throw or 500 a request), and fall back to the in-memory store when the env var is absent so dev/e2e stay zero-setup. Wire it only into the store default; call sites don't change. Prioritize this over any per-endpoint tuning. Auth-adjacent and security-sensitive: needs a `security-reviewer` pass before merge.
- **Verification**: Unit tests with a fake remote store: limits enforced across two "instances" sharing the store; a store that throws or times out returns `{allowed: true}`; `DIVEDAY_RATE_LIMIT_DISABLED` behavior unchanged. Manually run the sign-in e2e suite to confirm no throttling regressions in the single-worker fleet.

### Harden the /api/test/* seed endpoints with an explicit shared secret

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/app/api/test/seed-account-token/route.ts` mints a valid **password-reset token for any account by email** and returns it in the response; `src/app/api/test/reset/route.ts` wipes and reseeds data. Both are guarded only by an env-var predicate (`DATABASE_URL` set, or production-without-`DIVEDAY_E2E`). That guard is sound today but is pure configuration: one misconfigured staging deployment (production build, `DIVEDAY_E2E=1` left set from a CI template, PGlite fallback) turns seed-account-token into instant account takeover. Contrast with `src/app/api/cron/reminders/route.ts`, which already requires a `CRON_SECRET` bearer token in addition to configuration. Add the same pattern: require a `DIVEDAY_E2E_SECRET` bearer header on every `/api/test/*` route (set by the Playwright harness in `e2e/fixtures.ts`), keeping the existing env-var guard as the first check. Token-flow-adjacent: needs a `security-reviewer` pass before merge.
- **Verification**: Route tests asserting 404 without the header even when `DIVEDAY_E2E=1`, and success with it; run one e2e spec that exercises `/verify/[token]` end-to-end to prove the harness wiring works.

### Reduce what a stolen device can read from offline manifests

- **Priority**: low
- **Effort**: L
- **Prompt**: `src/lib/offline-manifest-store.ts` encrypts manifest snapshots (roster names, readiness blockers including medical-flag text rendered via `readinessBlockerText`) with AES-GCM, but the non-extractable `CryptoKey` sits in the **same IndexedDB database** (`KEY_STORE` beside `MANIFEST_STORE`), and the offline viewer at `src/app/offline-manifest/` necessarily works without a session. So the encryption resists only naive file-level inspection: anyone holding an unlocked device can open the viewer, or run origin JS, and read every cached manifest — including after the staff member's session has expired or been revoked. Two proportionate improvements: (1) shrink exposure by tightening `offlineManifestExpiresAt` retention in `src/lib/offline-manifests.ts` (confirm the current window with the owner) and by having sign-out purge records with no pending events (`purgeOfflineManifestsExceptShop` is the existing purge seam to extend); (2) document explicitly in the module header that the at-rest encryption is device-theft mitigation only, so a future contributor doesn't extend the pattern to stronger claims. Do **not** add a PIN-derived key without an ADR and product sign-off — an un-openable manifest during a roll call is a safety failure (H-05), and manifests are safety-critical surfaces requiring a `dive-domain-expert` review; this is also medical-data-adjacent, so it needs a `security-reviewer` pass before merge.
- **Verification**: Test in `offline-manifest-store.test.ts`: after the sign-out purge, records without pending events are gone while one holding a pending roll-call event survives (the evidence-preservation rule must hold); expiry-window change covered by the existing clock-driven expiry tests.

---

## 6. ML & data (open)

Auditor's baseline: the app has no LLM dependency today (new runtime dependency → ADR), a strict
external-HTTP seam pattern (`marine-forecast.ts`/`analytics.ts` + `DIVEDAY_DISABLE_EXTERNAL_HTTP`),
and existing deliberately-conservative heuristics (`demandRecommendation`, `KIND_SEVERITY`) that
should be extended, not replaced with models. At single-shop data scale, SQL aggregates and
transparent scoring beat trained models everywhere except language tasks (moderation, translation,
summarization), where the Claude API is the right tool. **Explicitly rejected as not worth
building now**: training any custom model (every surface is below the data volume where one beats
the existing heuristics), LLM-drafted replies to reviews (the reply feature itself doesn't exist),
LLM anything on cert gating/manifests/medical decisions (hard rule: assistive only — and the
assistive versions below are deliberately model-free), and dynamic pricing beyond the last-minute
rule table (Stripe owns arithmetic; trust risk exceeds upside for a delight-first product).

Nothing in this lens has been started; none of the eight modules below exist in the tree as of
2026-08-01.

### Add departure-demand insights to the schedule builder

- **Priority**: high
- **Effort**: M
- **Prompt**: Build a demand-history signal for staff scheduling, grounded in data the app already has: `trips` (startsAt, capacity, status), `bookings` (active statuses `booked`/`checked_in`), and `trip_waitlist_entries`. Add a pure function in a new `src/lib/demand-history.ts` (with `demand-history.test.ts` first) that takes per-slot aggregates and returns codes like `{ code: "underserved_slot", weekday, timeband, avgFillRate, waitlistedTotal }`; add the SQL aggregates (fill rate and waitlist depth grouped by shop-local weekday × morning/afternoon band over the trailing 12 weeks, using `utcToWallTime` from `src/lib/zoned.ts` and `nowDate()` from `src/lib/clock.ts` — never `new Date()`) in a new `src/db/demand-history.ts`. Surface it as one quiet line in the staff schedule builder's route server component (`src/app/shop/[shopSlug]/schedule/board/`), reusing the existing conservative style of `src/lib/demand.ts` (`demandRecommendation`) — a signal only fires when a slot averaged ≥90% full or carried waitlists across ≥2 recent departures. This is deliberately statistics-not-ML: at a single shop's volume (tens of trips/month) a rolling aggregate is more trustworthy than any forecast model, and it must be presented as guidance, never auto-creating trips. All staff-facing words go through `staff.json` codes per the domain-layer-copy rule; run `pnpm check` and add the surface to `e2e/visual.spec.ts`.
- **Verification**: Unit tests cover the threshold edges (fires at 2 qualifying departures, not 1; empty history returns nothing). Seed data via `createTestDb()` + `src/db/seed.ts` shows the line on the schedule board; `pnpm check` green; visual diff explained in the PR.

### Suggest last-minute deal parameters from past blast outcomes

- **Priority**: high
- **Effort**: M
- **Prompt**: The one-tap last-minute blast exists (`src/db/trip-promos.ts` `sendLastMinuteDealBlast`, history via `listTripLastMinutePromos`, Today surfaces `last_minute_fill` rows via `tripIdsNeverSentLastMinuteDeal`), but staff pick the discount percent blind. Add a pure advisor in a new `src/lib/last-minute-advisor.ts` that, given open-seat ratio, hours until departure, matching `last_minute_list_entries` count (reuse `lastMinuteEntryMatchesTripDate` in `src/lib/last-minute-list.ts`), and the shop's past blasts with their fill outcomes, returns a code-shaped suggestion `{ suggestedPercent, rationale: "many_seats_soon" | "few_seats" | ... }` — a transparent rule table (e.g. ≥50% empty inside 48h → 20–25%; <25% empty → 10%), clamped by `isValidLastMinuteDiscountPercent`. Compute past-blast outcomes in `src/db/trip-promos.ts` as a SQL aggregate: for each `sent` promo, seats booked between `createdAt` and `expiresAt` from `bookings`. Prefill (never auto-send) the discount field on the trip's last-minute-deal form under `src/app/shop/[shopSlug]/trips/**`, with the rationale rendered from `staff.json`. Do not build an ML price model — a shop has single-digit blasts of history; state in the module doc that the rule table is the honest ceiling until there are hundreds of blasts. Stripe still owns all discount arithmetic.
- **Verification**: Table-driven unit tests for every rationale branch and the clamp; a `src/db` test seeding two past blasts asserts the outcome aggregate; open the trip page in dev and confirm the prefilled percent; `pnpm check` green.

### Ship an assistive review-moderation and themes assistant (Claude API)

- **Priority**: high
- **Effort**: L
- **Prompt**: Staff moderate every commented review by hand (`src/db/reviews.ts` `listShopReviewsForStaff`/`setReviewPublished`, queue count in `countReviewsAwaitingModeration`, UI at `src/app/shop/[shopSlug]/reviews`). Add an assistive triage: a new seam module at `src/lib/review-assist/` that calls the Claude API (`@anthropic-ai/sdk`, structured JSON output) to classify each pending comment `{ flags: ("names_third_party" | "contact_info" | "safety_complaint" | "profanity")[], sentiment: "positive"|"mixed"|"negative" }` and, on demand, summarize the trailing 90 days of *published* comments into 3–5 recurring theme codes for the owner. Follow the repo's provider-seam rules exactly: injectable provider defaulting from environment (mirror `src/lib/marine-forecast.ts`), a no-op when `ANTHROPIC_API_KEY` is unset or `DIVEDAY_DISABLE_EXTERNAL_HTTP === "1"`, failures degrade to "no assist" — the moderation queue must work identically with the feature dark. Hard guardrails: the model never publishes or unpublishes anything (`setReviewPublished` remains staff-tap only), flags render as neutral chips whose words live in `staff.json`, and review comments sent to the API contain no diver identity beyond the comment text. This adds a runtime dependency, so write an ADR (`YYYYMMDD-review-assist-llm` id format) and request `security-reviewer` sign-off since it exports user-generated content to a third party.
- **Verification**: Unit tests with a fake provider cover flag mapping, provider-error fallback, and the disabled-env path; `pnpm test src/lib/review-assist --reporter=dot`; manually seed a review with a phone number in dev and see the chip; confirm the queue renders unchanged with the key unset; `pnpm check` green and ADR present.

### Build a translation-drafting script for the locale-coverage ratchet

- **Priority**: high
- **Effort**: M
- **Prompt**: `pnpm check:locale` enforces translation coverage across `src/i18n/locales/<locale>/diver.json` and `staff.json`, which makes every copy extraction a multi-locale chore. Write a dev-time script `scripts/draft-translations.mjs` that diffs each non-English locale file against `en-US`, sends only the missing key/value pairs to the Claude API (one batched request per locale, structured JSON output keyed identically), and writes the drafts back with a `--write` flag (default is a dry-run report, mirroring the `check-copy.mjs` flag conventions). Include the surrounding keys of each missing entry as context so tone matches DiveDay's dive-briefing voice, and instruct the model to preserve ICU placeholders like `{name}` verbatim, validating placeholder parity in the script and rejecting any drafted string whose placeholders differ. Guardrails: drafts land in the working tree for human review in the PR — never auto-committed; waiver/medical wording stays English pending H-01/H-03 (`docs/product/human-decisions.md`), so skip keys under those namespaces; the script reads `ANTHROPIC_API_KEY` from the environment and exits cleanly with a message when unset. Since this is dev tooling, add `@anthropic-ai/sdk` as a devDependency, but still record a short ADR because generated locale text changes what users read. Note this serves *ongoing* locale maintenance — the original extraction backlog is finished and both baselines are empty.
- **Verification**: Run the script dry against a locale with a deliberately deleted key and confirm the report; run `--write` and confirm `pnpm check:locale` goes green and placeholders survive; a unit-testable pure helper for placeholder-parity checking gets its own test file.

### Detect changed medical answers between a diver's waivers (assistive, never gating)

- **Priority**: medium
- **Effort**: M
- **Prompt**: Waivers store versioned medical questionnaire answers (`waiver_records` in `src/db/schema.ts`, shapes in `src/lib/medical.ts` — `needsPhysicianReview`, `flaggedMedicalPrompts`). Add a pure comparator `medicalAnswerChanges(previous, current)` in `src/lib/medical.ts` returning codes for each question whose answer flipped, distinguishing `yes_to_no` (the one worth a human glance — a previously disclosed condition now undisclosed) from `no_to_yes` (already handled by the physician-review gate). In `src/db/waivers.ts`, when a completed waiver supersedes an older completed one for the same person and shop, compute the diff against the most recent prior record — only comparing answers captured against the same `questionnaireId` (a questionnaire change is not a flip). Surface `yes_to_no` flips as a quiet informational note on the diver record and the roster's medical-review panel, worded in `staff.json` as "answered differently than last time", with the prior date. Absolute guardrails: this is statistics-free, model-free, and must never block boarding, alter `needsPhysicianReview`, create a readiness blocker, or auto-message the diver — it is a prompt for a human conversation only. This touches medical data on a safety-critical surface: write failure-path and adversarial tests (unknown question ids, mismatched questionnaire versions fail closed to "no diff reported") and request both `dive-domain-expert` and `security-reviewer` review.
- **Verification**: Unit tests in `src/lib/medical.test.ts` cover both flip directions, same-answers, and cross-questionnaire no-ops; a `src/db/waivers.test.ts` case with two completed waivers asserts the diff is attached; confirm no readiness/blocker code path imports the new function; `pnpm check` green.

### Recommend the diver's next course step on the recap page

- **Priority**: medium
- **Effort**: M
- **Prompt**: Certification paths exist as guidance (`src/db/course-paths.ts`, including the pure `nextPathStep`, already used on the trip detail page), and the recap page (`src/app/recap/[token]`, data in `src/db/recap.ts`) is the highest-intent diver moment the app owns. Add a query in `src/db/course-paths.ts` that, given a person id, joins their highest `certifications` level against each visible path's steps and returns the first step whose course they haven't taken and whose `minimum_certification_level` they meet — reusing `nextPathStep` for the ordering logic rather than duplicating it. Render at most one suggestion on the recap page as a low-key card linking to the public course page (`shop/[shopSlug]/courses/[slug]`), with copy in `src/i18n/locales/<locale>/diver.json` and a `DiverIntlProvider` already above it (verify — a missing provider blanks the whole page). This is a deterministic join, not collaborative filtering: with one shop's enrollment volume, "the next step of the path you're on" is strictly better than any learned recommender, and the module doc should say so. Guidance never gates: admission stays on the course's own `minimum_certification_level` check at booking time. Respect the bearer-token page rules in `docs/engineering/capability-telemetry-runbook.md` — no new data exposure beyond this booking's diver, and no structured data on the token page.
- **Verification**: `src/db/course-paths.test.ts` cases: uncertified diver → entry course, mid-path diver → next step, fully-certified → nothing, hidden path → nothing. E2e assertion on the recap spec that the card shows for the seeded diver; screenshot added to `e2e/visual.spec.ts`; `pnpm check` green.

### Instrument Today-queue outcomes before touching its ranking

- **Priority**: medium
- **Effort**: S
- **Prompt**: The Today ranking (`src/lib/today.ts` `KIND_SEVERITY`, `sortActions`, urgency windows) is hand-coded and well-reasoned; replacing it with learned ranking is unjustified without outcome data, so build the measurement first. Extend the typed event vocabulary in `src/lib/analytics.ts` with one event: `{ name: "today_action_opened"; kind: TodayActionKind; urgency: TodayUrgency; rank: number }`, emitted from the Today page's action taps alongside the existing `staff_recovery`/`blockers_surfaced` events (see `src/db/today.ts` and the Today route under `src/app/shop/[shopSlug]`). Keep it best-effort via `trackEvent` exactly as documented in that file — never awaited in a way that delays navigation, and silent under `DIVEDAY_DISABLE_EXTERNAL_HTTP`. Add a short note in the `src/lib/today.ts` module doc stating the tuning contract: severity constants may only be re-ordered with click-through/recovery evidence from these events, not by taste. Explicitly do not add any model, decay, or personalization now — the deliverable is the data seam plus the documented bar for future changes.
- **Verification**: Type-level exhaustiveness keeps the event union sound (`pnpm typecheck`); a unit test with an injected fake tracker asserts the event fires with the row's rank; `pnpm check` green.

### Score boarding risk as a transparent checklist, not a model

- **Priority**: low
- **Effort**: M
- **Prompt**: "No-show risk scoring" is the classic ML pitch here, but the honest version at this data scale is a visible checklist score: the signals that predict a roll-call problem already exist as rows — unresolved readiness blockers near departure (`src/lib/readiness.ts` / `src/db/readiness.ts`), a prior `roll_call_events` absence for the same person, and a booking made under a heuristic lead-time threshold. Add `boardingAttention(input): { level: "watch" | null, reasons: BoardingAttentionCode[] }` in a new `src/lib/boarding-attention.ts` — additive named reasons, no weights or probabilities, returning `watch` only when ≥2 reasons hold — with the reason-gathering SQL in `src/db/check-in.ts` feeding the existing check-in queue (`listCheckInQueue`). Render it as a neutral informational chip on the check-in queue row with words from `staff.json`. Guardrails: this is safety-adjacent, so it must never gate boarding, never reorder the manifest, and never appear on diver-facing surfaces; prior absence data is sensitive, so the chip shows reasons only on tap and the change gets a `dive-domain-expert` review. Document in the module why a trained classifier is rejected: a shop sees too few no-shows per season to fit anything, and an opaque score on a boarding surface violates the "boring code on safety surfaces" rule.
- **Verification**: Unit tests for each reason and the ≥2 threshold; a db test seeding a past `absent` roll-call event asserts the reason surfaces; check-in e2e spec still passes; `pnpm check` green.

### List lapsed regulars for staff win-back (SQL, staff-initiated)

- **Priority**: low
- **Effort**: M
- **Prompt**: Churn signals for a dive shop are diver-level and computable with one aggregate: a person whose merged history (`src/lib/prior-visits.ts` `mergeShopHistory` semantics — native `bookings` plus imported `prior_visits`) shows ≥3 lifetime visits but none in the trailing 12 months is a lapsed regular. Add `listLapsedRegulars(db, shopId, now)` in `src/db/divers.ts` (thresholds as named constants in a small pure helper in `src/lib/` with tests, clock via `nowDate()`), counting a prior visit only when `priorVisitStanding` says `recorded`, and excluding deleted people. Surface it as a filter or section on the staff divers list (`src/app/shop/[shopSlug]/divers`), showing last-visited date and a link to the diver record — from which staff can already add the person to the last-minute list (`src/db/last-minute-list.ts`), which is the consent-carrying channel for outreach. Hard guardrail: no automatic emailing — `sendNotificationBatch` must not be wired to this list; DiveDay surfaces the fact, the human decides the outreach, keeping the shop on the right side of marketing-consent rules. No ML: recency/frequency thresholds are the entire method, and the module doc should note that an RFM-style weighted score can come later only if shops ask for ordering within the list.
- **Verification**: db test seeds a 3-visit diver with an old last booking (frozen clock) and asserts inclusion; cancelled-status prior visits don't count toward the 3; the divers page renders the section in dev; `pnpm check` green plus a `security-reviewer` glance since it aggregates personal history.

---

## 8. Developer & agent experience (delivered)

The rest of this lens shipped: the stale copy-backlog claims are corrected everywhere, four new
`task:context` areas exist (payments, notifications, reviews, data portability), `pnpm e2e:run` and
`pnpm test:changed` give the fast iteration paths, `src/features` is inside the copy safeguards,
`pnpm check:repo` runs its ten checks in parallel and reports all failures, and `check:agents`
verifies AGENTS.md's route-map paths.

**Deduplicate CI job setup with a composite action** — delivered 2026-08-01. All seven jobs in
`.github/workflows/ci.yml` used to repeat the same four setup steps (checkout, `pnpm/action-setup@v6`,
`actions/setup-node@v7` with node 22 + pnpm cache, `pnpm install --frozen-lockfile`), and the two
Playwright jobs additionally duplicated the browser-cache block including its `-shell` key comment.
`.github/actions/setup/action.yml` (composite) now holds the pnpm/node/install steps, and
`.github/actions/playwright-shell/action.yml` holds the `~/.cache/ms-playwright` cache plus
`pnpm exec playwright install --only-shell chromium`, with the original explanatory comments moved
into the composite files rather than dropped. `actions/checkout` stays inline in every job (the
visual job keeps its own `fetch-depth: 0` variant untouched), and every job-level `timeout-minutes`,
shard matrix, artifact step, and env block is unchanged — a pure refactor of the shared setup only.

---

## Cross-cutting notes for whoever sequences the remaining work

- **Overlapping files**: `src/app/globals.css` is touched by three of the open a11y tasks (focus
  ring, status-banner tokens, placeholder) — that is one natural slice, and one `pnpm visual` pass.
  The Stripe webhook is touched by the open livemode task (§5) on top of §7's already-shipped
  transition guards and event ledger; build the livemode check on that ledger rather than beside it.
- **Reviews required by repo rules**: every §5 task needs `security-reviewer`; the §6 medical-diff,
  boarding-attention, and review-assist tasks need `dive-domain-expert` too, and review-assist and
  lapsed-regulars additionally need `security-reviewer`.
- **The marketing-caching task (§2) is now gated on the e2e Activity migration**, not on Next
  configuration — sequence the suite work first or the flag flip will be reverted again.
