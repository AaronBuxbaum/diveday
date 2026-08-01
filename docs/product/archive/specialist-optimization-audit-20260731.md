# Specialist optimization audit — 2026-07-31

> ## 📦 Archived — every lens shipped or moved out (2026-08-01)
>
> All eight lenses are resolved. UX, frontend performance (bar one task), SEO/growth, backend/data
> architecture, and developer/agent experience shipped 2026-08-01 — see
> [shipped.md](../shipped.md#specialist-optimization-audit--five-lenses-delivered-2026-07-31--08-01).
> ML & data moved in full to
> [features/ai-ml.md](../features/ai-ml.md#scoped-prompt-ready--from-the-2026-07-31-specialist-audit).
> Security & privacy shipped 2026-08-01 (six of seven tasks; the seventh was deliberately not
> built — see [§5](#5-security--privacy-delivered) below) — see
> [shipped.md](../shipped.md#specialist-optimization-audit--security--privacy-delivered-2026-08-01).
> Accessibility's three contrast tasks are deliberately still open, pending a human decision on the
> color guide, and moved to
> [features/roadmap.md](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision)
> so they stay visible as live open work rather than sitting in an archived file. The one remaining
> open item, marketing-page caching (§2), is tracked by its own two ADRs and an active PR rather than
> here — see that section. Retained for the rationale behind every task. Not open work; do not plan
> from it — see [roadmap.md](../features/roadmap.md) for what's still open.

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
| 3 | Accessibility | ◐ **Partly delivered** — the skip link, `<html lang>`, and the shortcuts-dialog focus trap landed with the ux-persona work; waiver field errors, schedule-builder panel focus, and automated axe scans landed 2026-08-01 — see [shipped.md](../shipped.md#specialist-optimization-audit--accessibility-non-contrast-items-and-ci-dedup-2026-08-01); the three contrast tasks are deliberately deferred and moved to [roadmap.md](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision), pending a color-guide decision |
| 4 | SEO & growth | ✅ **Delivered** 2026-08-01 (PR #288) |
| 5 | Security & privacy | ✅ **Delivered** 2026-08-01 — [six of seven tasks](#5-security--privacy-delivered); the seventh was **not built** — see that section |
| 6 | ML & data | ○ **Open** — eight tasks, none started; moved to [features/ai-ml.md](../features/ai-ml.md#scoped-prompt-ready--from-the-2026-07-31-specialist-audit) in the 2026-08-01 doc consolidation so every AI/ML idea lives in one place |
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

## 3. Accessibility (contrast tasks moved)

Auditor's baseline: much is genuinely good — semantic radios for star ratings, fieldset/legend
medical questions, widespread `aria-live`, a reduced-motion kill-switch, glare/boat contrast modes.
The contrast ratios in the moved tasks (see below) were computed from the actual token hex values
and re-verified 2026-08-01 against the current `src/app/globals.css` — all three were still failing
as of that date.

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

**The three contrast tasks are deliberately still open** — the product owner ruled out touching
contrast values in the same pass that delivered the rest of this lens (it would fight the current
color guide), so they were kept as open work rather than folded into "delivered." The axe scan
above excludes the `color-contrast` rule for exactly this reason (see the spec's own comment) — it
would otherwise fail on this same known, tracked debt on every run.

**Moved in full** to
[../features/roadmap.md](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision)
on 2026-08-01, so genuinely open work stays visible outside an archived file rather than requiring
someone to know to look here. The three tasks' prompts and verification steps carried over
unchanged; only the location moved. Code comments in `src/` citing "specialist-optimization-audit-20260731.md
§3" refer to this file's numbering, which is preserved.

---

## 5. Security & privacy (delivered)

Auditor's baseline — explicitly checked and found sound (no task needed): bearer/account token
entropy and hashing (256-bit CSPRNG, SHA-256 at rest, single-use consume with atomic `WHERE`,
supersession, disabled-account re-check); Svix and Stripe signature verification (timing-safe,
fail-closed, 300s replay tolerance); CSV export formula-injection escaping and per-shop scoping;
SSRF guarding in `src/lib/storage/ingest-url.ts` (DNS + private-range checks + no redirects +
bounded reads); tenant isolation in server actions (mutations consistently use
`session.user.shopId`, never the URL slug); the embed/frame-header logic in `src/proxy.ts`; and
observability URL redaction of token path segments. Every task below is security-sensitive and
needs a `security-reviewer` pass before merge per the repo's hard rules.

Six of the seven findings shipped 2026-08-01, each with its own `security-reviewer` pass per the
repo's hard rules — see
[shipped.md](../shipped.md#specialist-optimization-audit--security--privacy-delivered-2026-08-01)
for the mechanisms and ADRs:

- Use a CSPRNG for blob object keys holding card images.
- Check Stripe event livemode before mutating payment state.
- Add baseline security headers beyond frame protection.
- Give recap tokens their own secret and a lifetime.
- Move sign-in and booking rate limits to a shared store.
- Harden the `/api/test/*` seed endpoints with an explicit shared secret.

**"Close the revocation window on base staff surfaces" was not built.** It re-proposed exactly what
[H-15](../human-decisions.md#decision-register) already decided against on 2026-07-24: accept
Auth.js's 30-day JWT default with no live database recheck, an explicit "acceptable,
non-aggressive" tolerance. See
[20260724-staff-session-and-capability-migration-policy](../../architecture/decisions/20260724-staff-session-and-capability-migration-policy.md),
whose own text asks a future agent not to silently revisit this — caught here before
implementation started this pass. If the tolerated window ever needs to shrink, that ADR names the
pattern to reuse (import/export's existing current-role recheck, generalized).

**"Reduce what a stolen device can read from offline manifests" is deliberately not being built —
a human decision, not a missed task.** Kept in full below for whoever eventually revisits it.

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

## Cross-cutting notes (historical)

- **The three moved contrast tasks (§3) all touch `src/app/globals.css`** — that was flagged as one
  natural slice and one `pnpm visual` pass; still true wherever they land now, see
  [roadmap.md](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision).
- **The medical-diff, boarding-attention, and review-assist tasks in [ai-ml.md](../features/ai-ml.md)
  (formerly §6) need `dive-domain-expert`** in addition to `security-reviewer` on review-assist and
  lapsed-regulars — noted here since it doesn't fit `ai-ml.md`'s own per-task format.
- **The marketing-caching task (§2) is gated on the e2e Activity migration**, not on Next
  configuration — sequence the suite work first or the flag flip will be reverted again. Still the
  one open item this file doesn't fully account for; tracked by its own two ADRs and an active PR
  rather than a roadmap entry (see §2 above).
