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
| 3 | Accessibility | ◐ **Partly delivered** — the skip link, `<html lang>`, and the shortcuts-dialog focus trap landed with the ux-persona work; [six tasks open](#3-accessibility-six-tasks-open) |
| 4 | SEO & growth | ✅ **Delivered** 2026-08-01 (PR #288) |
| 5 | Security & privacy | ○ **Open** — [seven tasks](#5-security--privacy-open), none started |
| 6 | ML & data | ○ **Open** — eight tasks, none started; moved to [features/ai-ml.md](../features/ai-ml.md#scoped-prompt-ready--from-the-2026-07-31-specialist-audit) in the 2026-08-01 doc consolidation so every AI/ML idea lives in one place |
| 7 | Backend & data architecture | ✅ **Delivered** 2026-08-01 (PR #292) |
| 8 | Developer & agent experience | ✅ **Delivered** 2026-08-01 (PR #290), except the CI composite action — [one task open](#8-developer--agent-experience-one-task-open) |

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

## 3. Accessibility (six tasks open)

Auditor's baseline: much is genuinely good — semantic radios for star ratings, fieldset/legend
medical questions, widespread `aria-live`, a reduced-motion kill-switch, glare/boat contrast modes.
Contrast ratios below were computed from the actual token hex values and re-verified 2026-08-01
against the current `src/app/globals.css` — all three contrast tasks are still failing today.

Delivered since the audit, by other work: the document `lang` now comes from the negotiated locale
(`src/app/layout.tsx`), a skip link ships in both the root and shop layouts
(`src/components/SkipLink.tsx`), the keyboard-shortcuts dialog has a real focus trap
(`useFocusTrap` in `src/components/KeyboardShortcuts.tsx`), and `.progress-wave-fill` is now
neutralised by the reduced-motion block.

### Fix the global focus indicator's contrast in light mode

- **Priority**: high
- **Effort**: S
- **Prompt**: In `src/app/globals.css`, the app-wide keyboard focus indicator is `outline: 3px solid color-mix(in srgb, var(--primary) 55%, transparent)` (in the `:where(a, button, input, select, textarea, summary):focus-visible` rule). In the light palette that computes to ~2.3:1 against `--background` (#faf9f6) and `--surface` (#ffffff), failing WCAG 1.4.11's 3:1 minimum for focus indicators — keyboard staff users can lose the focus ring entirely in sunlight. Introduce a dedicated semantic token (e.g. `--focus-ring`) defined per scheme in the `:root` and dark blocks — full-strength `--primary` in light mode is 5.36:1 on white and passes — and use it in the `:focus-visible` rule instead of the 55% mix. Keep the token semantic per ADR-0004 and also define it in the `.boat-mode` and `.glare-mode` blocks so those palettes keep a passing ring. Do not weaken the dark-mode ring (currently ~3.8:1, passing).
- **Verification**: Recompute ratios with the same formula (a small node script against the hex values) confirming ≥3:1 for light, dark, boat, and glare palettes; keyboard-Tab through `/sign-in` and the schedule in light mode and screenshot to confirm the ring is clearly visible; `pnpm check` green (the token change must not trip the semantic-token safeguard).

### Associate waiver errors with fields and mirror constraints client-side

- **Priority**: high
- **Effort**: M
- **Prompt**: On the waiver signing page `src/app/waivers/[token]/page.tsx`, a failed submit redirects to `?error=invalid` and renders one generic `role="alert"` banner; the signature input (`name="signerName"`) and agreement checkbox (`name="acknowledged"`) carry no `required`, no `aria-invalid`, and no `aria-describedby`, so a screen-reader or cognitive-disability user gets "check that every question is answered" with no pointer to which of ~10+ medical questions, the name, or the checkbox is missing — on a legally required, safety-critical flow (WCAG 3.3.1/3.3.3). Add `required` and `minLength={2}` to the `signerName` input and `required` to the `acknowledged` checkbox so the browser blocks-and-focuses the first invalid control before the round trip (the medical radios already have `required`; the server schemas near the top of the file stay the enforcement of record). Keep the server fallback but follow the pattern already established in `src/components/BookingPartyFields.tsx`: where the error banner renders, also give it an anchor (`id`) and make it a link-or-text that names what failed. Note the `saveDraftAction` "save for later" button must NOT be blocked by the new `required` attributes — give it `formNoValidate` since drafts intentionally accept partial answers.
- **Verification**: Keyboard walkthrough: submit the sign form empty → browser focuses the first missing control and announces its validation message; "Save for later" still works with a partial form; `pnpm e2e waivers.spec.ts --reporter=line` green, plus a new assertion that an incomplete "sign" submit leaves focus on/announces the offending field.

### Manage focus and announcements in the schedule builder's panel flow

- **Priority**: medium
- **Effort**: M
- **Scope update**: the component moved — it is now
  `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx`, on the staff operations
  board route rather than the public schedule. Nothing else about this task has landed: a grep for
  `useRef`/`.focus()` in that file finds nothing, and all three Cancel controls still carry the
  hand-rolled `className="text-sm font-medium text-muted hover:text-foreground"` (re-confirmed
  2026-08-01).
- **Prompt**: In `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx`, the Add/Move/Copy toggles correctly use `aria-expanded` and per-row accessible names, but opening a panel does not move focus into it, Cancel does not return focus to its toggle, and when a server action completes the whole panel unmounts leaving keyboard focus on `<body>`; only Remove gets an announcement (via `UndoToast`'s `role="status"`). Add a small effect keyed on `open` that focuses the first input of the newly opened panel; make each Cancel restore focus to the button that opened the panel (hold the toggle in a ref keyed by panel id); and render a visually-hidden `role="status"` region (or reuse the redirect-flash pattern the waiver page uses with `FlashParams`) that announces "departure added/moved/copied" after the action's redirect. While there, replace the three hand-rolled Cancel text buttons with `buttonClass({ variant: "ghost", size: "sm" })` — the project's hard rule ("button-shaped things via `buttonClass`") and the WCAG 2.5.8 24px target floor both require it. All new copy goes through `staff.json` per the i18n-copy skill.
- **Verification**: Keyboard-only walkthrough at `/shop/<slug>/schedule/board`: open Add with Enter → focus is in the title input; Escape/Cancel → focus back on the "+ Add" button; submit Move → screen reader (or Playwright `getByRole("status")`) sees the confirmation. The schedule-builder e2e spec green with a new focus assertion; `pnpm check` green.

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

### Add automated axe scans and keyboard assertions to the e2e suite

- **Priority**: medium
- **Effort**: M
- **Scope update**: the ux-persona task this once overlapped with (task 108) closed out without
  adding the dependency — `@axe-core/playwright` is still absent from `package.json` and there is
  still no `e2e/a11y.spec.ts`, re-confirmed 2026-08-01. The full scope below stands, including the
  ADR for the dependency.
- **Prompt**: The e2e suite (`e2e/`) asserts behavior almost entirely through accessible roles/names (good), but nothing runs an automated a11y scan and no spec asserts focus behavior beyond `keyboard-shortcuts.spec.ts` — regressions like the failing focus ring or a missing label ship silently. Add `@axe-core/playwright` as a devDependency (write an ADR per the "new runtime dependency → ADR" rule, noting it is test-only, using a `YYYYMMDD-short-slug` id) and create `e2e/a11y.spec.ts` that runs `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()` and asserts zero violations on the five highest-stakes surfaces: the public schedule (`/shop/<slug>/schedule`), the trip booking page + confirmation, the waiver page (`/waivers/<token>` — seed a token via the existing helpers in `e2e/helpers.ts`/`e2e/fixtures.ts`, following how `waivers.spec.ts` obtains one), the staff manifest page, and `/offline-manifest`. Triage any violations the scan finds into the fixes above rather than filtering rules; only document a rule exclusion with an inline comment if it is a genuine false positive.
- **Verification**: `pnpm e2e a11y.spec.ts --reporter=line` passes locally (never `pnpm e2e -- a11y.spec.ts` — the `--` breaks pnpm arg forwarding per AGENTS.md); intentionally removing an `aria-label` in `ScheduleBuilder.tsx` locally makes the scan fail, proving it bites; `pnpm check` green and the ADR committed in the same change.

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

Moved in full to
[../features/ai-ml.md](../features/ai-ml.md#scoped-prompt-ready--from-the-2026-07-31-specialist-audit)
on 2026-08-01 — AI/ML ideas were split across this section and a separate brainstorm file, so both
now live in one place. The eight tasks, their prompts, and the auditor's baseline notes are
unchanged; only the location moved. Code comments in `src/` citing "specialist-optimization-audit-20260731.md
§6" refer to that file's numbering, which was preserved.

---

## 8. Developer & agent experience (one task open)

The rest of this lens shipped: the stale copy-backlog claims are corrected everywhere, four new
`task:context` areas exist (payments, notifications, reviews, data portability), `pnpm e2e:run` and
`pnpm test:changed` give the fast iteration paths, `src/features` is inside the copy safeguards,
`pnpm check:repo` runs its ten checks in parallel and reports all failures, and `check:agents`
verifies AGENTS.md's route-map paths.

### Deduplicate CI job setup with a composite action

- **Priority**: low
- **Effort**: M
- **Prompt**: All seven jobs in `.github/workflows/ci.yml` repeat the same four setup steps (checkout, `pnpm/action-setup@v6`, `actions/setup-node@v7` with node 22 + pnpm cache, `pnpm install --frozen-lockfile`), and the two Playwright jobs additionally duplicate the browser-cache block including its long `-shell` key comment — eight near-identical stanzas that must be edited in lockstep, which is exactly the drift the repo's safeguards elsewhere exist to prevent. Create `.github/actions/setup/action.yml` (composite) holding the pnpm/node/install steps, and a second `.github/actions/playwright-shell/action.yml` holding the `~/.cache/ms-playwright` cache plus `pnpm exec playwright install --only-shell chromium`, moving the existing explanatory comments into the composite files so the rationale is not lost. Keep `actions/checkout` in each job (the visual job needs its special `fetch-depth: 0` variant untouched) and keep all job-level `timeout-minutes`, shard matrices, artifact steps, and env blocks exactly as they are. This is a refactor only — the effective step sequence per job must be unchanged.
- **Verification**: Push to a branch and confirm all CI jobs run green with identical step behavior (install hits the pnpm cache, Playwright jobs hit the `-shell` browser cache); `git diff --stat` shows ci.yml shrinking substantially with no behavioral edits outside the extracted steps.

---

## Cross-cutting notes for whoever sequences the remaining work

- **Overlapping files**: `src/app/globals.css` is touched by three of the open a11y tasks (focus
  ring, status-banner tokens, placeholder) — that is one natural slice, and one `pnpm visual` pass.
  The Stripe webhook is touched by the open livemode task (§5) on top of §7's already-shipped
  transition guards and event ledger; build the livemode check on that ledger rather than beside it.
- **Reviews required by repo rules**: every §5 task needs `security-reviewer`; the medical-diff,
  boarding-attention, and review-assist tasks in [ai-ml.md](../features/ai-ml.md) (formerly §6) need
  `dive-domain-expert` too, and review-assist and lapsed-regulars additionally need
  `security-reviewer`.
- **The marketing-caching task (§2) is now gated on the e2e Activity migration**, not on Next
  configuration — sequence the suite work first or the flag flip will be reverted again.
