# AI & ML ideas

The single home for every AI/ML-shaped DiveDay idea — from a raw one-line concept to a
prompt-ready implementation task. Previously split across a brainstorm file and a specialist
audit's ML & data section; consolidated here 2026-08-01 so there is exactly one place to look.
Nothing here is committed scope until it moves into [roadmap.md](roadmap.md) with a milestone, an
ADR for the provider/dependency boundary, and the right safety review.

## Guardrails

- AI suggests; the safety spine decides.
- Low-confidence extraction fails closed.
- AI output on safety, medical, certification, nitrox, payments, or boarding surfaces must cite the
  underlying app state and stay reviewable by a human.
- No AI clears readiness, boarding, medical review, nitrox fill authorization, or refund/payment
  state.
- At single-shop data scale, SQL aggregates and transparent scoring beat trained models everywhere
  except language tasks (moderation, translation, summarization), where the Claude API is the
  right tool. Prefer a named, auditable rule table over an opaque score on any safety-adjacent
  surface.

**Explicitly rejected as not worth building now** (per the 2026-07-31 specialist audit): training
any custom model — every surface below is below the data volume where one would beat a heuristic
or SQL aggregate; LLM-drafted replies to reviews (the reply feature itself doesn't exist yet);
LLM anything on cert gating, manifests, or medical decisions (hard rule: assistive only, and the
assistive versions below are deliberately model-free where they touch those surfaces); and dynamic
pricing beyond the last-minute rule table (Stripe owns arithmetic; trust risk exceeds upside for a
delight-first product).

## Raw ideas — not yet scoped

Exploratory only. No effort estimate below the level of "big bet"; no module names, no file paths
— these need a design pass before they're prompt-ready.

### Diver and staff assistants

- **Diver-facing Q&A grounded in real state.** Answer questions like "Can I dive the wreck Saturday
  with Open Water?" from schedule and readiness logic. The answer can explain, but the readiness
  engine remains authoritative. *(L, cross-cutting, big bet.)*
- **Natural-language ops assistant.** Staff-only assistant for operational questions such as "Who is
  not ready for tomorrow's wreck trip?" Answers must cite the underlying app state. *(L,
  cross-cutting, big bet.)*

### Evidence extraction

- **Cert-card OCR.** Extract agency, level, card number, and date from a card photo for staff to
  verify. Low confidence never clears a gate. *(M, certs, big bet.)*

## Scoped, prompt-ready — from the 2026-07-31 specialist audit

Auditor's baseline: the app has no LLM dependency today (new runtime dependency → ADR), a strict
external-HTTP seam pattern (`marine-forecast.ts`/`analytics.ts` + `DIVEDAY_DISABLE_EXTERNAL_HTTP`),
and existing deliberately-conservative heuristics (`demandRecommendation`, `KIND_SEVERITY`) that
should be extended, not replaced with models.

Nothing in this section has been started; none of the eight modules below exist in the tree as of
2026-08-01. Every task's *Prompt* is written to be handed verbatim to an implementation agent with
zero other context. Priorities and effort are the auditor's estimate; **a human decides what
actually gets built** — nothing here is committed scope. Tasks were grounded in the code as of
2026-07-31; re-verify file paths against `AGENTS.md`'s route map before starting one, **line
numbers have drifted and are anchors, not gospel** (re-locate by symbol name), and follow the
Parallel-work rules (check open PRs for overlap) before claiming a slice.

Code comments in `src/` that cite "specialist-optimization-audit-20260731.md §6" refer to this
section — the task numbering below is unchanged from the original audit, only its location moved.

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

## Cross-cutting notes

- **Reviews required**: the medical-diff, boarding-attention, and review-assist tasks above need
  `dive-domain-expert`; review-assist and lapsed-regulars additionally need `security-reviewer`.
- **North-star measures** these ideas could eventually feed are tracked in
  [roadmap.md's measures](roadmap.md#measures) — instrument before ranking, never the reverse (see
  the Today-queue task above).
