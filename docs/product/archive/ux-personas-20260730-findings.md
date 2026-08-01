# UX persona walkthroughs — 2026-07-30 (archived findings)

**Archived 2026-07-31.** This is the closed-out findings-and-tasks record of the 2026-07-30
review: 165 prompt-ready tasks across fifteen personas plus two cross-cutting lenses, kept here
for rationale — why each fix was made, which review passes it went through, what was deliberately
deferred and why. Not open work; do not plan from it. For current state, use:

- [product/personas.md](../personas.md) — the standing persona reference this review produced,
  rewritten as evergreen guidance (not a dated bug list) for evaluating future UX work.
- [product/features/story-backlog.md](../features/story-backlog.md) — every ticket from this review that is still
  open, partially done, or blocked on a pending review pass, cross-referenced back to its persona.

---

A breadth-first exploration of DiveDay's frontend through the eyes of fifteen personas, with
**prompt-ready tasks** for handing to a smaller implementation model. Findings come from reading
the code and from running the app (screenshots of every major surface, desktop + mobile,
public + staff).

**How to use this doc.** Each persona section has a short experience narrative (what they hit
today, with file references) followed by numbered tasks. Every task is written to be pasted into
a lesser model as a standalone prompt: it names the files, states the change, and states how to
verify. Tasks are tagged **[S]**mall (copy/one-file), **[M]**edium (one surface), or **[L]**arge
(cross-surface or schema). Cross-references between personas are noted rather than duplicated.
Before implementing anything here, follow AGENTS.md (skills: `new-feature`, `i18n-copy`,
`design-review`, `verify`) — these prompts state *what* and *where*; the repo rules state *how*.

**Status note.** This is an assessment, not a commitment. Tasks conflict with none of
`product/features/roadmap.md` as of this date, but the roadmap owns priority. Several tasks touch
security-sensitive or safety-critical surfaces and say so inline.

**Completion tracking.** Finished tasks carry a trailing `**Done — PR #N.**` (or `**Deferred —
...**` for a task deliberately not implemented, with the reason). Untagged tasks are still open.

---

## Contents

| # | Persona | Surfaces |
| --- | --- | --- |
| 1 | Nadia — nervous first-time diver | public schedule, course pages, booking |
| 2 | Tomas — certified traveler on a phone | schedule, trip page, booking, sign-in |
| 3 | Priya — parent booking the family | booking party form, course age rules |
| 4 | Marco — repeat local diver | schedule, booking speed |
| 5 | Ingrid — non-native English speaker | i18n coverage everywhere |
| 6 | Rob — diver the night before (waiver + medical) | /waivers/[token], /ready/[token] |
| 7 | Amara — diver after the trip | /recap/[token], reviews, tips, photos |
| 8 | Dana — solo shop owner at 6am | Today queue, departure board |
| 9 | Chloe — front desk in a morning rush | check-in, walk-in booking, blockers |
| 10 | Sal — captain with wet hands | manifest, roll call, offline view |
| 11 | Kai — day-one seasonal hire | navigation, discoverability, refusals |
| 12 | Maren — weekly-admin manager | reviews moderation, promos, settings, reports |
| 13 | Victor — skeptical owner evaluating a switch | marketing pages, pricing, switching guides, onboard |
| 14 | June — low-vision / screen-reader / assistive-tech user | accessibility everywhere |
| 15 | Leo — anyone on a slow island connection | performance, offline/PWA, error coverage, email |

Two cross-persona lenses follow the personas:

| § | Lens | Question |
| --- | --- | --- |
| 16 | Over-explained copy | Are we too verbose about mechanics customers don't care about? |
| 17 | Redundancy, coupling, findability | Should functionality live together or apart — and can you find it when you need it? |

Then: a cross-cutting consistency appendix and a ranked quick-wins list.

---

## 1. Nadia — the nervous first-timer

Knows nothing about certifications. Googled "learn to dive," landed on a course page or the shop
schedule. Every acronym is a wall; every unexplained gate is a reason to close the tab.

**What she hits today.** Course pages are unreachable by browsing — the public course *index* is
staff-gated (`src/app/shop/[shopSlug]/courses/page.tsx` calls `requireStaffSession()`), and the
schedule renders "Course session · Open Water Diver" as **plain text, not a link**
(`schedule/page.tsx`). Certification-path pages ("Open Water → Advanced → Rescue") are also
staff-only, so the "where do I start?" question has no surface at all. On a course page she meets
"PADI COURSE" (uppercased, unexplained), "Advanced Open Water or higher" with no link to the
prerequisite, and jargon like "two-tank trip," "BCD," "Regulator" with no glossary. If she tries
to book a session above her level, `course_prerequisite` is deliberately collapsed to
"This trip isn't taking bookings anymore." (`schedule/[id]/actions.ts`) — a lie that dead-ends
her instead of pointing to the Open Water course the shop offers. Her one lead-capture path, the
course inquiry composer, is `mailto:`-only and never asks for her email
(`courses/[slug]/_components/CourseInquiry.tsx`), so a phone with no mail client configured
loses the lead entirely.

### Tasks

1. **[M] Make course sessions on the schedule link to their course page.** In
   `src/app/shop/[shopSlug]/schedule/page.tsx`, the "Course session · {title}" line renders as
   plain text. Wrap the course title in a `Link` to `/shop/[shopSlug]/courses/[slug]` (the slug
   is available on the trip's course relation; check `src/db/trips.ts` for the query shape). Keep
   the existing visual style, add a hover/focus underline. Verify: from the public schedule,
   signed out, you can tap through to the course page. Add a line to the e2e schedule spec.
   **Done — this PR.**
2. **[L] Open the public course catalog.** Make `/shop/[shopSlug]/courses` (index) publicly
   viewable for active courses: extend `isPublicShopRoute` in `src/lib/auth.config.ts` and split
   the page's staff editor affordances behind the session check, the way the schedule page
   already does. This touches the public-route allowlist → **needs a `security-reviewer` pass**
   per AGENTS.md. Verify: signed-out visit renders active courses only; editor controls absent;
   e2e spec for the signed-out view.
   **Done — this PR.** Implemented per the security-reviewer note above: `$`-anchored
   `COURSES_INDEX`/`COURSE_PATHS_INDEX`/`COURSE_PATH_PAGE` patterns kept separate from
   `PUBLIC_SCHEDULE`'s open-ended tail, public branch uses `listActiveCourses`/`isActive`-filtered
   path queries, shop resolves via `getShopBySlug` never session. Security-reviewer pass pending.
3. **[L] Give certification paths a public page.** `courses/paths/page.tsx` and
   `paths/[pathSlug]/page.tsx` are staff-gated; the data is guidance, not a gate (see the route
   map note in AGENTS.md). Allowlist them like task 2 (same security-review requirement), and add
   a "Not sure where to start?" link from the public course index. Verify signed-out rendering.
   **Done — this PR.** Same commit as task 2; security-reviewer pass pending.

    **Security-reviewer note (tasks 2–3).** The shop must resolve from the URL slug
    (`getShopBySlug`), never the session, following the `staffView = session?.user?.shopId ===
    shop.id && isStaff(...)` pattern already in `schedule/page.tsx` and `courses/[slug]/page.tsx`
    — and 404 on a missing shop rather than returning null. The public branch must fetch
    `listActiveCourses`, never the staff `listCourses`, so hidden/draft courses are never fetched
    for an anonymous request, not merely hidden in the render; apply the same `isActive`
    discipline to `courses/paths/page.tsx` (currently unfiltered `listCoursePaths`) and
    `paths/[pathSlug]/page.tsx` (`getCoursePathBySlug` doesn't filter `isActive` at all, and
    today's page body is entirely the staff editor — a new diver-facing render is needed, not a
    condition on the existing one). Filter path steps referencing hidden courses the same way
    `courses/[slug]/page.tsx`'s `CoursePathTrail` already does (`.filter(step =>
    step.course.isActive)`), or a hidden course's title leaks through a path listing. Fix, in the
    same change, that `generateMetadata` on the already-public course page falls back to the
    internal `description` field (meant for staff pickers, per the schema comment) when
    `summary` is empty — a pre-existing leak into public `<meta>` tags. Gate all edit/
    visibility-toggle controls behind `staffView` by not rendering them, not by disabling them
    (the mutations already re-check `requireStaffSession` server-side — defense in depth, not the
    primary control). Critically, do **not** copy `PUBLIC_SCHEDULE`'s open-ended `(\/.*)?` regex
    tail — `/courses` shares its segment tree with the staff editor (`/courses/[slug]/edit`), so
    any new allowlist entry must stay narrow and `$`-anchored like `COURSE_PAGE`, or it silently
    exposes the editor to anonymous GETs at the proxy layer. Don't add these routes to
    `isEmbeddableShopRoute` — that exception is scoped to the booking widget by its own ADR.
    Before merge: verify unauthenticated requests to the new routes *and* to
    `/courses/[slug]/edit`/`/courses/new` (still gated); seed an inactive course and a
    hidden-course path step and confirm neither's title/slug/description appears in the anonymous
    response body; cross-tenant check that shop A's public `/courses` never returns shop B rows
    and that a shop-B staff session viewing shop A's page gets `staffView === false`; POST
    directly to `visibilityAction`/`setPathVisibilityAction`/`createPathAction`/`savePathAction`/
    `deletePathAction` with no session and with a wrong-shop session; extend
    `src/lib/auth.config.test.ts` with explicit `false` cases for the editor/new routes alongside
    the new `true` cases; and run `pnpm check:copy`/`check:domain-strings` plus `pnpm visual` for
    the new public surfaces.
4. **[S] Stop lying about prerequisite refusals.** In
   `src/app/shop/[shopSlug]/schedule/[id]/actions.ts`, `course_prerequisite` maps to the
   `booking.errors.unavailable` message ("This trip isn't taking bookings anymore."). Keep the
   deliberate information-hiding (see the rationale in `types.ts`) but change the user-facing copy
   to a neutral truth, e.g. "This session has admission requirements — get in touch and the shop
   will help you find the right starting point." New key in `src/i18n/locales/*/diver.json` via
   the `i18n-copy` skill; link the shop's contact email when present.
   **Done — this PR.**
5. **[S] Expand agency acronyms once per page.** On course pages
   (`_components/CourseSections.tsx`), "{agency} course" renders `PADI` / `SSI` bare. Add a
   translated title/abbr treatment, e.g. "PADI (Professional Association of Diving Instructors)"
   on first mention, or a short "an international scuba training agency" hint line. Keep it to
   the course hero.
   **Done — this PR.**
6. **[M] Explain jargon at point of use.** Add a small translated glossary-hint pattern (tooltip
   or muted parenthetical) for the first occurrence of: "two-tank trip" (= two dives in one
   outing), "BCD," "Regulator," "nitrox" on public surfaces (`schedule/page.tsx`,
   `RentalFitForm.tsx`, `DiveBriefingsSection.tsx`). Coordinate wording with the
   `dive-domain-expert` agent; all strings via message bundles.
   **Done — this PR.** Used the plain-language definitions from the dive-domain-expert review
   below verbatim.

    **Dive-domain-expert review.** Safe plain-language definitions — *two-tank trip*: "A boat
    trip with two separate dives, back to back, with a rest break (a surface interval) in
    between — not two tanks worn at once" (keep the clarifying clause; newcomers sometimes read
    "two-tank" as double cylinders). *BCD*: "The inflatable vest you wear that holds your tank
    and lets you control whether you float or sink." *Regulator*: "The mouthpiece and hose that
    let you breathe normal air from your tank underwater." *Nitrox*: do **not** land on "just
    extra oxygen" — that undersells both the required certification (an uncertified nitrox
    request gets flagged, not silently filled) and the fact that nitrox extends
    no-decompression time at moderate depths but *restricts* maximum depth versus air
    (oxygen-toxicity risk), so it isn't unconditionally "more" or "safer." Use: "A breathing gas
    with extra oxygen that lets specially trained divers spend a bit more time underwater on
    some dives — you don't need to know more than that as a beginner."
7. **[M] Capture the inquiry lead server-side.** `CourseInquiry.tsx` builds a `mailto:` and never
   collects the diver's address. Add optional email/phone fields and a server action that records
   the inquiry (a small `course_inquiries` table — see the `schema-change` skill) and notifies the
   shop via the existing `src/lib/notifications/` adapter, keeping the `mailto:` as a fallback.
   Happy-path + failure-path tests per AGENTS.md.
   **Done — this PR.**
8. **[S] Make the experience dropdown required.** In `CourseInquiry.tsx` the experience level
   select ("I have tried scuba once…") defaults to "Choose one" and is skippable — it's the most
   useful field for the shop. Mark it required and preselect nothing.
   **Done — this PR.**

---

## 2. Tomas — the certified traveler booking from a phone abroad

Found the shop on WhatsApp from a friend's link. Books from a hotel bed on flaky wifi, in a
different locale and currency, comparing two shops in another tab.

**What he hits today.** The public schedule has **no shop identity**: `<h1>` is literally
"Schedule," no logo, name, address, phone, or footer for anonymous visitors
(`shop/[shopSlug]/layout.tsx` renders `ShopNav` only for staff sessions). The month calendar and
the trip list are desynchronized — paging the calendar to September still shows the August list
(`schedule/page.tsx` never passes `month` to `pagedUpcomingTripsWithCounts`). Calendar chips show
only times, names hidden in hover-only `title=` attributes. Pagination is forward-only. Reviews —
his trust signal — are dead last after several screens of trips. On the trip page, the hero price
and the charged price can disagree (header renders `trip.priceCents`, the form charges
`perDiverPriceCents` including course + e-learning fees), and the free-cancellation line renders
only if the shop set a per-trip number — usually absent, with no fallback copy. A cancelled trip
404s bare (`if (trip?.status !== "scheduled") notFound()`) with no app-level `not-found.tsx` to
soften it. If the trip is full, the sticky mobile CTA disappears entirely instead of becoming
"join the wait list."

### Tasks

9. **[M] Put the shop's identity on its public pages.** Add a lightweight public header/footer
   for anonymous visitors in `src/app/shop/[shopSlug]/layout.tsx` (or the schedule/course pages):
   shop name as the `<h1>`-adjacent brand, contact phone/email (fields exist on `shops`), and a
   footer line. Keep it out of `?embed=1` mode. Verify in light + dark, mobile + desktop; update
   the visual spec.
   **Done — this PR.** `PublicShopChrome.tsx` (new), mounted from the shop layout.
10. **[M] Synchronize calendar and list.** In `schedule/page.tsx`, pass the selected month into
    the trip-list query so the list follows the calendar, or scroll-link the list to the chosen
    day. Read `src/db/trips.ts` for the paged query; add a unit test for the month-filtered
    variant. This is the single most confusing behavior on the page.
    **Done** — the core month-bound fix already shipped in an earlier commit this session
    (`5c82a84`, predates this PR's doc tracking); this PR builds further schedule fixes on top.
11. **[S] Make calendar day cells tappable and show trip names.** In
    `_components/ScheduleCalendar.tsx`, make the whole day cell a link when it has departures,
    and show an abbreviated trip name in the chip (truncate; the full name can stay in
    `title=`).
    **Done — this PR.**
12. **[S] Keep a sticky CTA on full trips.** In `schedule/[id]/page.tsx` the sticky mobile CTA
    requires `!full`. When full, render it as "Join the wait list" anchored to the wait-list
    form instead of hiding it.
    **Done — this PR.**
13. **[M] Soft-land cancelled and missing trips.** Add `src/app/not-found.tsx` (app-level) and a
    branded handler for cancelled trips: instead of `notFound()`, render "This trip was
    cancelled" with links to the schedule and shop contact. Copy via bundles. Tests for the
    cancelled path.
    **Done — this PR.** The app-level `not-found.tsx` already existed (`5c82a84`); this PR adds
    the cancelled-trip-specific branded landing on the trip page.
14. **[S] Always say something about cancellation.** In `_components/TripHeader.tsx`, when
    `cancellationWindowHours` is null, render a fallback translated line ("Cancellation questions?
    Ask the shop — {contact}") instead of nothing.
    **Done — this PR.**
15. **[M] Reconcile the two prices on the trip page.** Make `TripHeader` render the same
    per-diver total the booking section charges (`perDiverPriceCents`, including course fees),
    with a breakdown line when course fees apply ("$450 course + $149 e-learning"). One money
    truth per page. Unit-test the header amount for a course session.
    **Done — this PR.**
16. **[S] One money format per page.** `TripHeader.tsx` calls `formatMoneyCents` without a locale
    (falls back to en-US) while `BookingSections.tsx` formats locale-aware. Thread the request
    locale into every `formatMoneyCents` call on public pages; `pnpm check:locale` should already
    flag stragglers — clear them.
    **Done — this PR.**
17. **[M] Add "previous page" to schedule pagination**, or replace jump-to-start with true
    bidirectional keyset paging in `schedule/page.tsx` (`pagedUpcomingTripsWithCounts` in
    `src/db/trips.ts` needs a backward cursor).
    **Done — this PR.** `src/lib/schedule-pagination.ts` (new) implements the backward cursor.
18. **[S] Show a running party total.** In `BookingSections.tsx`, when party size > 1 render
    "3 divers × $120 = $360" above the submit button. Locale-aware formatting.
    **Done — this PR.**
19. **[S] Tell the diver they're leaving for Stripe.** The pay button label is "Heading to
    payment…" only after tap. Add a persistent hint under the button: "You'll finish paying on a
    secure Stripe page." (translated key). Calms the scariest hop on hotel wifi.
    **Done — this PR.**
20. **[S] Fix the promo-code silent failure.** An invalid promo simply doesn't discount
    (`actions.ts` treats it as no-op) and the diver finds out on the Stripe page. Validate on
    submit and return a field-level "That code isn't active" error, reusing the redeemability
    predicate in `src/lib/promo-codes.ts` / `src/db/shop-promos.ts`.
    **Done — this PR.**

---

## 3. Priya — the parent booking a family

Books herself plus two kids, 9 and 11, for a Discover Scuba session, on a phone.

**What she hits today.** Every party member requires a **name and an email** — she must invent
addresses for children or type her own three times, with autofill deliberately disabled for
divers 2–6 (`BookingPartyFields.tsx`, `autoComplete="off"`). Party size caps at 6 with no "bigger
group? call us" escape. Course minimum age is displayed only on the course page — never on the
trip/booking page — and is **not enforced for public bookings** (`src/db/bookings.ts` gates
`course_min_age` on `req.actor !== "public"`), so she can pay for an 8-year-old on a 12+ course
and discover it at the dock.

### Tasks

21. **[M] Make party-member emails optional or shareable.** In
    `src/components/BookingPartyFields.tsx` + the booking action
    (`schedule/[id]/actions.ts`), allow "use the lead booker's email" per member (checkbox that
    disables the field) or make additional-member email optional; server-side, fall back to the
    lead's contact for notifications. Check the booking transaction's duplicate-email guard in
    `src/db/bookings.ts` first (its tests are the contract) — dedupe logic must not collapse
    two members sharing an email into "already booked." Failure-path tests required.
    **Done — this PR.**
22. **[S] Re-enable autofill for extra party members.** Remove the `autoComplete="off"` overrides
    for divers 2+ in `BookingPartyFields.tsx` (use `name`/`email` tokens); document in the PR why
    it was off if a reason surfaces in git blame.
    **Done — this PR.**
23. **[M] Enforce and surface course minimum age for public bookings.** Safety-adjacent: in
    `src/db/bookings.ts`, evaluate `course_min_age` for public actors too (collect birth year or
    an "all divers meet the minimum age of {n}" attestation checkbox in the booking form), and
    render the course's `minimumAge` on the trip page for course sessions. Needs
    `dive-domain-expert` review per AGENTS.md (cert/admission gating). Begin with a failing
    regression test for the public-actor gap.
    **Partial — this PR.** Implemented only the safe subset the dive-domain-expert review below
    calls for: `minimumAge` now renders on course trip pages, and the booking form requires a
    self-declared attestation checkbox. No birth date is persisted and `course_min_age` still
    isn't a hard gate for public actors — doing that would reverse human-decision H-08 (age
    refusals as a probing vector, H-22) and needs its own human-decision entry, not just an
    engineering change. **Deferred pending that decision.**

    **Dive-domain-expert review.** This needs reframing before implementation, not just building
    as written — `course_min_age` is deliberately unenforced for public actors today
    (`docs/product/human-decisions.md` H-08 option B, cross-referenced by H-22
    `20260725-checklist-age-disclosure`): a hard public-facing age refusal can be used to probe
    whether a specific address/email belongs to a minor, which is exactly what H-22 closed off.
    An **attestation checkbox** ("I confirm every diver on this booking meets the minimum age of
    {n}") is the safer mechanism — a self-declared checkbox can't be used to fingerprint an
    already-known person the way a birthdate-driven refusal can — but on its own it's not
    enforcement: if it doesn't write to `people.date_of_birth`, the existing `under_minimum_age`
    readiness blocker still never fires and dock-day discovery isn't actually fixed. If the
    implementation *does* start persisting a submitted birth year, that interacts with
    `findOrCreatePerson`'s email-match reuse (H-13) and can reopen the H-22 probing vector —
    route that path through `security-reviewer`, not only `dive-domain-expert`. Adding any hard
    block for public actors is a policy reversal of H-08 and needs its own human-decision entry,
    not just an engineering change. Agency nuances to encode correctly: PADI Discover Scuba's
    floor is age 10, Bubblemaker (pool-only) runs younger (~8–9), and Junior Open Water Diver
    spans ages 10–14 with restrictions that lift automatically at 15 without a new course —
    verify each course template's `minimumAge` against its specific agency/course, not a
    shop-wide guess. Attestation copy must address "every diver in this party," not "you," since
    a parent is often attesting about a child; anchor the age check to the trip/course date
    (already correct via `calendarDateInTimezone`); and define an anchor date for multi-session
    courses where a birthday could fall between sessions.
24. **[S] Add a big-group escape hatch.** When `maxPartySize` caps the select, render a translated
    line "Bringing more than {n}? Contact the shop — {contact link}" under the party-size field.
    **Done — this PR.**
25. **[S] Attribute party booking failures to the right member.** `createBookingParty` returns one
    reason for the whole rollback; the UI shows "You're already on this trip's list" even when
    diver 4 is the duplicate. Thread the failing member index through the action's error state
    and highlight that fieldset. (Read `bookings.test.ts` "rolls back the whole party" first.)
    **Done — this PR.**
26. **[S] Replace the gift-detection regex with a course flag.** "Giving this dive as a gift?"
    triggers off `/discover scuba|try scuba/i` on the course title
    (`BookingSections.tsx`) — English-only. Add an `isIntroCourse`-style boolean to the course
    content shape (`src/lib/courses.ts`, editor checkbox in `courses/[slug]/edit`) and use it.
    **Done — PR #273.**

---

## 4. Marco — the repeat local who wants to book in ten seconds

Dives with this shop monthly. Knows exactly which trip he wants. Every field is friction.

**What he hits today.** Nothing recognizes him: no email prefill, no "book again," no "your
usual Saturday 7:30" (`schedule/page.tsx`, `BookingSections.tsx`). The schedule has no filters —
not even "has space" — so he scrolls a flat chronological wall (our mobile screenshot of the
demo shop is ~13,000px tall). The "did you mean {existing diver}?" typo-correction feature is
dead code: `knownDivers` is only ever passed in the test file (`BookingPartyFields.tsx`).

### Tasks

27. **[M] Remember the returning diver on this device.** After a confirmed booking, store
    name/email (not payment data) in `localStorage` and prefill the next booking form with a
    one-tap "Booking as Marco (not you?)" chip. Client-only, no schema change; keep it out of
    embed mode if the embed is meant to be stateless. Add an e2e assertion.
    **Done — PR #273.**
28. **[M] Add simple schedule filters.** "Has space" toggle + trip-type filter (fun dive /
    course) as query params on `schedule/page.tsx`, server-rendered (no client state — see the
    visual-stability note in `AddDiverSection.tsx` for the house pattern). Unit tests on the
    filtered query.
    **Done — PR #273.**
29. **[S] Wire up `knownDivers` or delete it.** `suggestNameTypo` in `BookingPartyFields.tsx`
    never fires in production (both call sites omit the prop). Either pass recent public-safe
    known-diver names where staff use the same component, or remove the dead path — half-built
    features cost comprehension.
    **Done — PR #273.** Resolved by deletion, not wiring-up: the only real data source for
    `knownDivers` is the shop's full diver roster, and the booking page is public/unauthenticated
    — wiring it up as sketched would leak other divers' names/emails to anonymous visitors. Task
    27 (remember-this-device) covers the actual need without that exposure.
30. **[S] "Next departure" quick link.** At the top of the schedule, render one prominent card
    for the soonest departure with spots ("Next boat out: Sat 7:30 — 3 spots") linking straight
    to its booking form. Data is already in `range.first`.
    **Done — PR #273.**

---

## 5. Ingrid — the non-native English speaker

German diver, browser in de-DE, gets es-ES or en-US. Reads carefully; idioms and half-translated
pages erode trust fast — especially around money, medicine, and legal text.

**What she hits today.** Only `en-US` and `es-ES` exist. The **RSTC medical questionnaire and the
default waiver body are hardcoded English** (`src/lib/medical.ts`, `src/lib/waivers.ts`) inside
an otherwise fully translated Spanish page — the highest-stakes untranslated text in the product
(sign-off pending H-01/H-03 per AGENTS.md, but the gap deserves a visible interim note). The
capacity pill on four surfaces returns raw English from the domain layer (`capacityLabel()` in
`src/lib/trips.ts` — "1 spot left"), while a correctly pluralized `fallback.spotsLeft` key sits
unused. Booking validation errors are hardcoded English in the server action
(`schedule/[id]/actions.ts`: "Enter a name.", "Enter a valid email address." …). Currency is
hardcoded USD across checkout, format defaults, and tip presets. Sentences are assembled from
fragments in JSX ("Need help?" + link + suffix), which breaks word order in translation. Client
validation in `ImageFileInput.tsx` is English on a localized page. Stripe line descriptions are
built in English in the domain layer (`src/db/checkouts.ts`, `src/lib/courses.ts`).

### Tasks

31. **[S] Localize the capacity pill.** Replace `capacityLabel()`'s English strings
    (`src/lib/trips.ts`) with a code return (`{ kind: "full" | "left", remaining }`) and move
    wording into `diver.json`/`staff.json` (the plural-ready `fallback.spotsLeft` pattern already
    exists). Domain layer returns codes, not sentences — this is the ADR
    20260731-domain-layer-copy-leaks pattern; run `pnpm check:domain-strings --write` to bank
    the reduction.
    **Done — PR #272.**
32. **[S] Localize booking-action validation errors.** Move the six hardcoded strings in
    `schedule/[id]/actions.ts` into the diver bundle via `requestTranslator()`. Same for the
    three raw strings in `schedule/actions.ts` (`joinLastMinuteListAction`) — the rate-limit
    error two lines above already shows the correct pattern.
    **Done — PR #272.**
33. **[S] Localize `ImageFileInput` client errors.** `src/components/ImageFileInput.tsx` has
    hardcoded English validation messages on localized diver surfaces; accept the strings as
    props from the server component (the staff-Client-Component pattern) or use
    `useTranslations()` under `DiverIntlProvider`.
    **Done — PR #272.**
34. **[M] De-fragment assembled sentences.** Audit the three-key stitched sentences: the waiver
    help footer (`waivers/[token]/page.tsx` — currently reads "Need help? Return to the shop and
    contact your dive shop," with the link going to DiveDay's marketing homepage), the ready
    contact line, the recap greeting's hardcoded punctuation, and `" · "`/`" — "` literals in
    JSX. Replace each with a single ICU message using `t.rich` for embedded links. Fix the
    waiver footer's `href="/"` to the shop's contact while there.
    **Done — PR #272.**
35. **[L] Localize money end-to-end.** Add `currency` to `shops` (schema-change skill), thread it
    through `formatMoneyCents` (`src/lib/format.ts` defaults `"usd"`), checkout creation
    (`src/db/checkouts.ts`), tip presets (`recap/[token]/page.tsx` — `TIP_PRESETS_USD`), and
    course fee display. Stripe owns conversion arithmetic. This is a prerequisite for any
    non-US shop; needs an ADR note and careful test coverage of the payments path.
    **Deferred (Ingrid session, PR #272).** Cross-surface schema + payments-path change; scoped
    out of the i18n backlog pass to keep that PR reviewable. Needs its own ADR-led change.
36. **[S] Move Stripe line descriptions out of the domain layer.** `` `Deposit — ${title}` `` in
    `src/db/checkouts.ts` and `` `${course.title} — instruction` `` in `src/lib/courses.ts` are
    English sentences from `src/db`/`src/lib`. Return structured parts and compose the localized
    label at the call boundary.
    **Deferred (Ingrid session, PR #272).** Depends on task 35 landing currency handling first,
    since the Stripe line item composition point is the natural place to localize both together.
37. **[S] Fix untranslated greeting fallbacks.** `"there"` (`ready/[token]/page.tsx`) and
    `"diver"` (`recap/[token]/page.tsx`) are injected into localized greetings. Add translated
    fallback keys.
    **Done — PR #272.**
38. **[M] Add an interim notice for English-only legal/medical text.** While H-01/H-03 keep
    waiver/medical wording in English, render a one-line translated notice above them on non-en
    locales: "This legal and medical text is provided in English — ask the shop if anything is
    unclear." Keeps trust without touching the frozen wording. Coordinate with
    `dive-domain-expert`.
    **Done — PR #272.** Shipped the dive-domain-expert-corrected wording below (not the
    original draft), which never implies the shop will translate the waiver/medical text.

    **Dive-domain-expert review.** The proposed wording is a liability problem, not just a
    nicety gap — "ask the shop if anything is unclear" implies the shop is offering translation
    or explanation of a legal release and a medical questionnaire whose answers gate whether
    someone dives, and most shops aren't staffed or trained to give that kind of ad hoc
    translation, especially where a mistranslated "no" is exactly the failure mode this system
    exists to prevent. Corrected copy should not promise shop-side translation and should push
    the diver toward getting the content actually understood before signing: "This waiver and
    medical form are only available in English right now. If you're not comfortable reading
    English legal or medical text, please bring someone who can help you read it carefully, or
    ask the shop before your trip — don't sign anything you don't understand." It must never
    read as "the shop will explain this for you."
39. **[S] Use `Intl.ListFormat` on the recap page.** `sitesSentence` hardcodes `" and "` while
    the recap *email* already uses `Intl.ListFormat` — the email and the page it links to
    disagree in Spanish. Align the page (`recap/[token]/page.tsx`).
    **Done — PR #272.**
125. **[S] Set `<html lang>` from the negotiated locale.** `src/app/layout.tsx` hardcodes
    `lang="en"` for every page including fully Spanish ones — screen readers pronounce Spanish
    pages with an English voice. Thread `requestLocale()` into the root layout's `lang`
    attribute. Probably the highest-impact one-line i18n fix in the app.
    **Done — PR #272.**
126. **[S] Localize the calendar week start.** `ScheduleCalendar.tsx` + `src/lib/calendar.ts`
    hardcode Sunday-first; Spanish/German calendars are Monday-first. Use
    `Intl.Locale.prototype.getWeekInfo()` with a Sunday fallback.
    **Done — PR #272.**
127. **[S] Fix the copy-ratchet blind spot's known leaks.** `scripts/check-copy.mjs` can't see
    strings returned from function bodies in `.tsx`, so it reports zero while these ship
    English on localized surfaces: `WaiverSendControl.tsx` ("Copied", "No email on file"…),
    `ConnectivityStatus.tsx` ("This device is online."…), `ImageFileInput.tsx` (task 33), and
    the literal "version" on the waiver page. Fix the strings first; extending the scanner to
    function bodies is a follow-up worth its own task.
    **Done — PR #272.**
128. **[M] Per-recipient notification language.** `src/lib/notifications/index.ts` picks the
    *shop's* locale for every email — a German diver at a Cozumel shop gets Spanish
    confirmations. Add an optional locale on the person (captured from the booking request's
    negotiated locale) and prefer it. Schema-change skill; tests on the notification path.
    **Deferred (Ingrid session, PR #272).** ADR 20260731-notification-locale (pre-existing,
    written before this session) deliberately scopes notification locale to the shop only, with
    per-person locale explicitly named as future work — implementing it here would have reversed
    a standing architectural decision without its own review.
129. **[S] Localize page titles.** 25+ static English `metadata.title` exports on localized
    pages (waiver, ready, recap, sign-in). Convert the token surfaces at minimum to
    `generateMetadata` with the negotiated locale.
    **Done — PR #272.**

---

## 6. Rob — the diver the night before (waiver, medical, readiness)

Opens the waiver link from email at 11pm. Mild asthma, slightly anxious about the medical form.
Next checks the "ready" page to see what's left.

**What he hits today.** The eight RSTC medical questions arrive **pre-answered "No"**
(`RadioQuestion` sets `defaultChecked` on No in `waivers/[token]/page.tsx`) — he can scroll past
the entire questionnaire without a conscious answer: simultaneously a liability hole and a UX
accident. When he does answer Yes, the one reassuring sentence ("a 'yes' doesn't automatically
cancel your dive") is eight questions off-screen in the smallest muted text; there's no way to
attach a doctor's note or explain a managed condition; and the post-signature state is chilling:
"don't assume you're cleared until your shop confirms" — no timeline, no contact, no shop phone
on the page. The legal wall renders unabridged with no summary. The trip he's signing for is
never named — no date, no trip title, just the shop name. Rate-limited double-taps show the
*wrong* error ("Please answer every question…"). The expired-link card has no shop identity or
contact (the branch returns before the shop is even loaded). On `/ready`, the dock arrival time
("be at the dock by 7:30am") exists only in the email, never on the page; there's no countdown,
no site photos — the night-before *email* is richer than the page it links to.

### Tasks

40. **[S] Unset the medical defaults.** Remove `defaultChecked` from the "No" radios in
    `waivers/[token]/page.tsx` so every question requires a conscious answer (drafts still
    prefill from saved answers). Render "Yes" before "No" to match the paper RSTC convention.
    Safety-critical surface: adversarial tests (submit with an unanswered question) +
    `dive-domain-expert` review.
    **Done** — shipped in an earlier commit this session (`5c82a84`, dive-domain-expert reviewed,
    predates this PR's doc tracking); this PR's Rob batch built the remaining waiver/ready fixes
    on top of it.

    **Dive-domain-expert review.** Confirmed on both counts. `RadioQuestion` currently sets
    `defaultChecked={yes !== true}` on "No" for all eight questions, so a diver can submit
    having made zero conscious choices — a real liability hole, not just a UX one; real shops
    treat this the same as the paper form, where a blank or ambiguous answer isn't accepted. The
    paper RSTC/PADI-style form does list Yes before No per line, so reordering is correct, not
    just assumed. One addition: every question here is referral-flagged (`src/lib/medical.ts`),
    so when "Yes" is selected there's currently no path to add detail about a managed condition —
    any "tell us more" field added for that must stay purely informational for the shop's
    follow-up and must never read as a self-clearance override; the physician-review requirement
    stays fixed regardless of what the diver writes there.
41. **[S] Repeat the reassurance at the point of anxiety.** When a "Yes" is selected, reveal an
    inline translated note under that question: "A yes means a doctor should confirm you're fit
    to dive — it doesn't cancel your trip." (Progressive enhancement; fine to also always render
    it statically under each question in small text if client JS is unwanted.)
    **Done — this PR.**
42. **[M] Name the trip on the waiver.** Render trip title + date + time in the waiver header
    (`waivers/[token]/page.tsx` already loads the booking's trip for the sites peek — reuse it),
    so the diver can verify what they're signing for.
    **Done — this PR.**
43. **[S] Fix the rate-limit mislabel.** `saveDraftAction`/`completeAction` redirect to
    `?error=invalid` when throttled, rendering "Please answer every question…". Add a distinct
    `?error=rate` → translated "Give it a few seconds and try again — nothing was lost."
    **Done — this PR.**
44. **[M] Warm up the medical-review dead end.** The `medical_review` completed state
    ("Waiver received" / "don't assume you're cleared") gets: the shop's phone/email as tappable
    links (the ready page already shows how), a "what happens next" line ("The shop reviews
    this — usually before your trip day"), and the same `EarnedMoment` treatment for the parts
    that *are* done. Copy through `dive-domain-expert`.
    **Done — this PR.** Used the corrected copy from the dive-domain-expert review below
    verbatim, not the original "usually before your trip day" draft.

    **Dive-domain-expert review.** The proposed "what happens next" line is inaccurate and needs
    correcting before it ships. A "yes" on a referral-flagged question requires a **physician's
    written clearance**, not the shop's own review — the shop's role is to receive and check for
    that sign-off, not to grant medical clearance itself. "Usually before your trip day"
    overpromises: physician appointments can take days to arrange, and a diver filling this out
    the night before (Rob's own scenario) may not get sign-off in time. Corrected copy: "A 'yes'
    answer means you'll need a doctor to confirm in writing that you're fit to dive before you
    can go out — that's true at every shop, not just this one. The shop will reach out about
    next steps. If your trip is coming up soon, contact them now, since getting a doctor's
    sign-off can take a few days." The UI must never imply DiveDay or the shop can itself provide
    medical clearance, and must not suggest the diver is "probably fine" pending review.
45. **[M] Add shop contact to all dead-token cards.** The waiver `expired`/`unavailable`
    branches return before `getShopById` runs, rendering zero interactive elements. Load the
    shop first and render name + contact links on every terminal card (waiver, and check
    `/verify` which has the same no-link dead end).
    **Done — this PR.**
46. **[S] Put the dock-call time on /ready.** `dockCallMinutes` renders "be at the dock by
    7:30am" in the day-before email (`src/lib/notifications/email.ts`) but never on
    `ready/[token]/page.tsx`. Compute the same line and show it under the trip header.
    **Done — this PR.**
47. **[M] Bring anticipation to /ready.** Add the dive-site peek (photos, depth, difficulty —
    the component pattern exists on the waiver success page) and a relative-time line
    ("in 2 days") to `/ready`. The page a diver opens the night before should be at least as
    rich as the email that got them there.
    **Done — this PR.** `DiveSitesPeek.tsx` (new, shared with the waiver success page).
48. **[S] Fix the "no information was submitted" draft lie.** The expired-waiver copy says
    "no information was submitted," but drafts persist via `saveWaiverDraft`. Reword to be
    truthful for both cases ("Your saved answers are kept — ask the shop for a fresh link.").
    **Done — this PR.**
49. **[S] Surface silent rate-limits on /ready.** Every throttled action on
    `ready/[token]/actions.ts` redirects with no error param — buttons appear to do nothing. Add
    a `?error=rate` notice to `READY_NOTICES`, and add the missing `error-fit` entry while
    there (a failed gear save currently renders nothing at all).
    **Done — this PR.**
50. **[M] Replace `window.confirm` for cancel/reschedule.** The two money-moving actions on
    `/ready` confirm via native OS dialogs that can't show the refund preview the page already
    computed. Build a small translated inline-confirm (server-roundtrip pattern is fine)
    showing the refund line before the destructive submit. Also used by staff surfaces — see
    task 96; consider one shared component.
    **Done — this PR.** `src/components/ui/InlineConfirm.tsx` (new, shared).
51. **[S] Show waiver link expiry on the page.** The email states the exact expiry; the page
    says only "before it expires." Render "This link works until {date}" from the token's
    known TTL.
    **Done — this PR.**

---

## 7. Amara — the diver after the trip

Gets the recap link that evening. Would leave a review if it's effortless; might tip; wants her
photos somewhere.

**What she hits today.** The review ask renders *above* the memory — map, sites, conditions,
crew shoutout all sit below the rating form (`recap/[token]/page.tsx`), so she's asked to rate
before being reminded why it was great. Two review asks stack (on-page + Google/TripAdvisor),
and the external one has the warmer copy. Nothing warns that adding a comment delays publication
(moderation), and editing a published review silently un-publishes it. Tipping is USD-hardcoded
(`TIP_PRESETS_USD`) and returning from Stripe after paying shows **nothing** (`?tip=paid` has no
notice entry). Photos upload one per full page reload (no `multiple`), the upload button has no
pending state, and a no-show diver hitting "review" is told to "pick a rating and try again"
forever. If the crew logged nothing, the page degrades to pure ask-page (review + tip + book
again) with no gift left.

### Tasks

52. **[S] Reorder the recap: memory first, asks second.** Move the sites/conditions/crew-shoutout
    sections above the review and tip sections in `recap/[token]/page.tsx`. The code comment
    explains the current order deliberately — update the comment with the new rationale: earn
    the 5 before asking for it.
    **Done** — shipped in an earlier commit this session (`5c82a84`, predates this PR's doc
    tracking); the rest of Amara's persona shipped in this PR on top of it.
53. **[S] Add the missing `tip=paid` notice.** `TIP_NOTICES` lacks the success case its own
    action sets. Add "Thanks — your tip is on its way to the crew 🤿" and handle the
    webhook-pending window (don't re-render the tip form as if nothing happened).
    **Done** — shipped alongside task 52 in `5c82a84`.
54. **[S] Disclose comment moderation up front.** Next to the comment textarea, render the
    existing fact as a hint: "Ratings post right away; the shop reads written words first."
    (Currently discovered only after submitting.)
    **Done — this PR.**
55. **[S] Multi-photo upload.** Add `multiple` to the recap `ImageFileInput` and loop server-side
    (cap stays `MAX_RECAP_PHOTOS_PER_BOOKING`). Give the upload button the `SubmitButton`
    pending treatment it's missing.
    **Done — this PR.**
56. **[S] Honest no-show and cancelled states.** `did_not_dive` flattens to "pick a rating and
    try again"; a cancelled booking's photo refusal advises re-encoding a JPEG. Map both reasons
    to truthful translated messages.
    **Done — this PR.**
57. **[M] Merge the two review asks.** Fold the external-review CTA into the on-page review's
    success state: after a 4–5★ submission, offer "Share it on Google too" (copy their comment
    to clipboard). One ask at a time; the sequencing logic is a few lines in
    `recap/[token]/page.tsx`.
    **Done — this PR.** `ShareReviewButton.tsx` (new).
58. **[S] Fix "today" in evergreen copy.** `recap.externalReviewBody` says "took you out today"
    on a link that never expires. Reword to timeless ("took you out").
    **Done — this PR.**
59. **[M] Make the recap shareable.** `recap-links.ts` calls itself shareable but the page has
    no share affordance. Add the existing `navigator.share`/clipboard pattern
    (`TripActions.tsx`) with an OG image for the recap route so the link unfurls with the trip
    title and site names. Bearer-token caveat: confirm with the capability-telemetry runbook
    before adding any metadata that leaks through the token URL.
    **Done — this PR.** `RecapShareButton.tsx` + `opengraph-image.tsx` (new).
60. **[S] Localize tip presets/currency** — folded into task 35 (shop currency); until then, at
    least derive the currency label from the shop's Stripe account rather than hardcoding `$`.
    **Done — this PR.** Added a `defaultCurrency` on the shop's Stripe account
    (`TipAmountPicker.tsx` now reads it); full cross-surface currency i18n stays task 35, deferred.

---

## 8. Dana — the solo owner at 6am

Runs the whole shop alone. Opens Today with coffee in hand, 90 minutes before the boat leaves.

**What she hits today.** The Today ranking is genuinely good (chronological-beats-severity,
per-departure collapse, role lenses — `src/lib/today.ts`), but the "now" band is 24 hours wide,
so tomorrow's 7am boat interleaves with today's. Six of fourteen action kinds have hardcoded
English labels and details straight from `src/db/today.ts` ("Open prep list", "Open trip"…), and
its time formatter hardcodes `"en-US"`. Most non-waiver rows point at a surface rather than act
in place ("Open Priya's record"), so N blockers = N page loads. Crew assignment on the departure
board is HTML5 drag-and-drop — **impossible on the phone she's holding** — with a visually
buried select fallback; failures roll back silently. And when the last blocker of the morning
clears, the row just disappears: no "all boats clear" moment (the excellent 🤙 empty state only
covers the fully empty queue).

### Tasks

61. **[S] Localize `src/db/today.ts`.** Move the six hardcoded action kinds' labels/details to
    codes resolved through `today-labels.ts` (the blocker rows already show the pattern), and
    replace the `"en-US"` literal in its `at()` time helper with the negotiated locale. Bank
    the `check:domain-strings` reduction.
    **Done — PR #274.**
62. **[M] Add an "imminent" urgency band.** In `src/lib/today.ts`, split `now` (≤24h) into
    "next 3 hours" and "today," so the 7am boat's problems visibly outrank tonight's. Ranking
    is pure logic with tests — extend `sortActions`/`urgencyFor` test cases first.
    **Done — PR #274.**
63. **[M] Make the departure board's crew select the primary control.** In
    `src/components/today/DepartureBoard.tsx`, promote the existing `<select>` fallback to the
    visible default (keep DnD as desktop enhancement), give the staff chips and the unassign ×
    real tap targets (`min-h-11` wrappers — see the `RosterSection.tsx` checkbox precedent),
    and surface assignment failures with a worded rollback like `RollCallButton.tsx` instead of
    silent revert.
    **Done** — the select-as-primary-control and worded-rollback core shipped in an earlier
    commit this session (`5c82a84`, predates this PR's doc tracking); this PR's Dana batch
    added the remaining Today-queue fixes on top.
64. **[S] Celebrate the cleared morning.** When the "Before today's boats" group empties but
    later groups remain, render a small earned moment ("Today's boats are all clear 🤙") in
    `TodayQueue.tsx`. The seasonal-briefing copy system in `today.ts` shows where celebration
    strings live.
    **Done — this PR.**
65. **[M] Let payment rows act in place.** `payment_due` rows send Dana to the roster. Add a
    "copy payment link" / "resend invoice" inline action on the Today row, reusing the
    invoicing path in `src/lib/payments/`. (Scope check: if invoicing isn't wired for that
    booking type, fall back to the current navigation — never a dead button.)
    **Done — this PR.** `PaymentActionControl.tsx` (new).
66. **[S] Give Today a scannable count.** `summarizeDay` is prose; add "{n} items" chips to the
    group headers so a glance distinguishes a 5-job morning from a 40-job one (the count is
    already computed for group rendering).
    **Done — this PR.**

---

## 9. Chloe — front desk during the morning rush

A line of six customers; two walk-ins; one diver whose waiver didn't arrive.

**What she hits today.** Adding a walk-in is five interactions across three full page loads:
Schedule → trip → Guests tab → GET-form search reload → "Add to trip"
(`trips/[id]/_components/AddDiverSection.tsx`); a brand-new diver additionally requires an email
(`required`), and there is **no walk-in path at all** from Today, Check-in, or the command
palette. On the Check-in page, a blocked diver renders a badge and up to three blocker bullets —
**with nothing to tap** (`check-in/page.tsx` renders `null` for the action slot); she must leave,
fix, and come back, while `blockers/page.tsx` already shows the one-tap-fix pattern. Blocker
bullets silently truncate at three. The roster's per-diver cards are ~200px tall with no
"unsigned only" filter for scanning a 12-person boat.

### Tasks

67. **[L] Build a fast walk-in flow.** Add a "Walk-in" action on the Check-in page (and the
    command palette) that: picks today's departure, searches existing people, or takes
    name-only for a new diver (email optional at the counter — the crew can collect it later;
    check what `src/db/bookings.ts` minimally requires and relax the form, not the
    transaction). Books as staff actor with counter payment deferred. This is the single
    highest-friction common task on the staff side. E2e spec required (booking flow).
    **Done** — shipped in an earlier commit this session (`5c82a84`, security-reviewer reviewed,
    predates this PR's doc tracking): `/check-in/walk-in`, wired into the command palette.
68. **[M] Give blocked divers an action on Check-in.** Reuse the Blockers page's one-tap-fix
    row pattern (`blockers/page.tsx`) inside `check-in/page.tsx`'s blocked-diver card: send
    waiver, open the exact record. Also render "+{n} more" instead of silently truncating at
    three bullets.
    **Done — this PR.**
69. **[S] Add an "unsigned waivers" filter to the roster.** In
    `trips/[id]/_components/RosterSection.tsx`, add a filter chip row (all / needs waiver /
    blocked) as server-rendered query params, and show counts in the section heading.
    **Done — this PR.**
70. **[S] Link the not-ready refusal to the blocker.** `checkIn.notice.notReady` says "resolve
    the blocker before checking them in" without a link; make it a `t.rich` link to the
    diver's guest row (the manifest's `not_ready` refusal already does exactly this — copy
    the pattern).
    **Done — this PR.**
71. **[S] Celebrate the cleared queue.** When the last diver checks in, swap the empty state
    for "Everyone's aboard the day 🎉 — {n} divers checked in." One translated string in
    `check-in/page.tsx`.
    **Done — this PR.**

---

## 10. Sal — the captain with wet hands

Runs roll call on a phone at the dock and off the boat, sometimes with no signal.

**What he hits today.** The live manifest is the best-engineered surface in the product (56px
boat targets, glare mode, `WaterLocker` spray rejection, milestone haptics, honest offline
snapshots). But **the offline view — the surface for the actual wet-hands scenario — has none
of it**: no haptics, no `WaterLocker`, no `MissingDiversGrid`, no completion ripple, plain
`onClick` buttons (`src/components/OfflineManifestView.tsx` vs `manifest/page.tsx`). Checkpoint
tabs are `min-h-11` (not boat-size) and switching is a full navigation. Six summary tiles push
the roll-call list below the fold on a phone. The offline note field silently re-sends a typed
note on the next tap (never cleared). The offline manager's "Saved …" timestamp uses raw
`toLocaleString()` with no shop timezone. On Today, the "Boarding" CTA is `md`, not boat-size.

### Tasks

72. **[M] Bring the boat affordances to the offline view.** Port `MilestoneHaptics`,
    `WaterLocker`, `MissingDiversGrid`, and the roll-call-complete celebration from
    `manifest/page.tsx` into `OfflineManifestView.tsx`. Safety-critical surface: keep the
    fail-closed boarding rules untouched; boring code; failure-path tests; `dive-domain-expert`
    review.

    **Dive-domain-expert review — the fail-closed boarding rules to leave untouched.**
    (1) Readiness gates boarding only at the "Before departure" checkpoint — the Board button
    only renders when `ready || !isDeparture`; after any numbered dive, roll call is a pure
    headcount regardless of saved readiness. Don't let the ported celebration/haptics code add a
    readiness check to post-dive checkpoints or hide "Board" for unready divers anywhere but
    departure. (2) `canRecordOfflineStatus` (`src/lib/offline-manifests.ts`) is the real
    enforcement, independent of the UI — it refuses a `"boarded"` event unless the saved
    readiness snapshot says `"ready"`; `"not_boarded"` is always allowed, and it does **not**
    vary by checkpoint the way the UI's `isDeparture` logic does. Add an explicit failure-path
    test confirming that marking a diver boarded after dive 1 with a not-ready snapshot (e.g. an
    uncleared medical) still succeeds as a pure headcount the way the UI implies — if it doesn't,
    that's a latent bug this port could surface for the first time, and it needs to be caught by
    a test, not discovered on a boat. (3) An expired saved copy (`isOfflineManifestExpired`)
    stays readable but refuses any new roll-call write — the ported UI must respect that flag the
    same way the current code does (no board/not-board buttons, a distinct "expired" message);
    never let a haptic or celebration fire an action the store layer is about to reject.
    (4) "Not boarded" carries forward as a presumption at later checkpoints, never resets to
    awaiting — any new "everyone's aboard!" celebration must gate on the true boarded count and
    must not fire for a manifest with carried-forward not-boarded divers just because "awaiting"
    reads zero. (5) Reconciliation on sync is the final authority, not the offline UI — keep
    surfacing pending/rejected sync counts as today; a satisfying "all boarded" animation must
    never imply server-confirmed state while sync is still pending.
    **Done — this PR.** While porting, found and fixed a real latent bug the review above
    anticipated: `canRecordOfflineStatus` was gating readiness at *every* checkpoint instead of
    only "departure" (mismatching `recordRollCall`'s server-side gate), silently refusing
    legitimate post-dive headcount boarding for a not-ready diver. Added a `checkpoint` parameter
    and a regression test (`offline-manifests.test.ts`) covering exactly that scenario. **Needs a
    follow-up `dive-domain-expert` review pass before merge** given the fail-closed-logic change,
    per AGENTS.md's safety-critical rule.
73. **[S] Clear the offline note after recording.** `record()` in `OfflineManifestView.tsx`
    never clears `noteByBooking`, so a note rides along on re-taps. Clear it on success.
    **Done — this PR.**
74. **[S] Boat-size the checkpoint controls.** Checkpoint tabs on both live and offline
    manifests are `min-h-11`; promote to the `boat` size (`buttonClass` already defines it)
    since they sit on the same wet-hands surface as the 56px targets.
    **Done — this PR.**
75. **[S] Collapse the summary tiles on mobile.** The six `grid-cols-2` tiles push the first
    diver below the fold; render two key tiles (Boarded / Awaiting) + a `<details>` for the
    rest at narrow widths in `manifest/page.tsx`.
    **Done — this PR.**
76. **[S] Fix the offline timestamp locale.** `OfflineManifestManager.tsx` uses
    `toLocaleString()`; use the same `formatDateTimeTz` + shop timezone as everywhere else.
    **Done — this PR.**
77. **[S] Make the offline entry point findable.** "Open offline roll call" is a normal button
    below the live manifest header. Add it to the command palette and give it boat-size on the
    manifest page; consider a nav presence when a snapshot exists on this device.
    **Done — this PR.**
78. **[S] Give WaterLocker an off switch.** It mounts unconditionally on the manifest —
    including desktops. Add a small "disable spray guard on this device" toggle persisted like
    the glare preference (`AmbientGlareDetector` shows the localStorage pattern).
    **Done — this PR.**

---

## 11. Kai — the day-one seasonal hire

First shift, handed a login, never seen DiveDay.

**What he hits today.** No onboarding exists outside demo shops (the role-tour banner is
demo-gated in `shop/[shopSlug]/layout.tsx`). The "More" menu is a raw `<details>` with no
click-outside or Escape dismissal that covers most of a phone viewport. Sign-out sits beside
Search with no confirmation — one mis-tap logs the crew out mid-shift. Authorization refusals
are inconsistent: some name roles nicely ("Building the board is limited to owners, managers,
and instructors"), some redirect to a *different page's* message (Promos → Settings' rentals
notice), some teleport silently (`waivers/page.tsx`, `settings/export`). The command palette —
the fastest way to learn the app — is desktop-keyboard-only knowledge (`⌘K` hint invisible on
mobile) and the "?" shortcuts dialog is an unlabeled icon.

### Tasks

79. **[M] First-run orientation for real shops.** Reuse the demo role-tour content pattern
    ("Try:" prompts per role) as a dismissible first-visit card on Today for newly invited
    staff (persist dismissal per account). Content varies by role — captain sees the manifest
    tour, front desk sees check-in.
    **Done — this PR.** `RoleOrientationCard.tsx` (new); dismissal persisted via a new
    `user_accounts.orientation_dismissed_at` column.
80. **[S] Fix the "More" menu.** Add click-outside + Escape dismissal (small client wrapper on
    `ShopNavLinks.tsx`), and a scrim at mobile widths.
    **Done — this PR.**
81. **[S] Confirm sign-out.** One-step inline confirm on the sign-out button in `ShopNav.tsx`
    (mis-tap protection matters more on boats than ceremony; a two-tap "Sign out? → Confirm"
    is enough).
    **Done — this PR.** `InlineConfirmButton.tsx` (new).
82. **[S] Route Promos' auth refusal to its own message.** `promos/page.tsx` redirects
    non-owners to `/settings?notice=not_authorized` (a message about rental prices). The
    correct promo-specific string already exists (`promos.notice.notAuthorized`) — redirect
    with that notice instead, and audit the other silent authorization redirects
    (`waivers/page.tsx`, `settings/export/page.tsx`) to land with an explanatory notice.
    **Done — this PR.**
83. **[S] Badge the nav with pending work.** Reviews "waiting on you" and Blockers counts
    exist on their pages; surface small count badges on the nav items (server-rendered in
    `ShopNavLinks.tsx`) so Maren and Kai discover work without visiting each page.
    **Done — this PR.**

---

## 12. Maren — the weekly-admin manager

Does promos, review moderation, settings, and reports on Monday afternoons.

**What she hits today.** The Reviews page's "Waiting on you: N" stat has no corresponding
filter — the list is strictly chronological, so she scans for grey badges
(`src/db/reviews.ts` orders by `createdAt` only). Hiding a published review (which changes the
public rating) has no confirmation, while resending a waiver does — the consequence hierarchy
is inverted. A 5★ review renders identically to a 1★: zero celebration on the one surface
where the shop's best news arrives. On Promos, a `failed` code has no retry or delete; codes
can't be copied to clipboard (the `CopyableUrl` component exists in calendar settings); the
`datetime-local` inputs are browser-local while the list renders shop-time. Settings is nine
stacked forms whose single success notice renders off-screen at the top after
`PreserveFormScroll` restores your scroll position. The course editor is one giant form whose
adjacent "Preview" link discards every unsaved edit without warning.

### Tasks

84. **[S] Float unmoderated reviews to the top.** Add "waiting first" ordering (or a filter
    tab) to the reviews query in `src/db/reviews.ts` + `reviews/page.tsx`, linked from the
    "Waiting on you" stat.
    **Done — this PR.**
85. **[S] Confirm hiding a published review.** Add the same confirm treatment other
    destructive actions get (see task 50's shared inline-confirm) to the hide toggle in
    `reviews/page.tsx`.
    **Done — this PR.**
86. **[M] Celebrate good reviews.** When a 5★ review is published, show it with the accent
    treatment (`EarnedMoment` pattern); add a small "this month: {n}★ average from {m}
    reviews" line to the stats row. Data already computed for the page.
    **Done — this PR.**
87. **[S] Copy button for promo codes.** Reuse `CopyableUrl` (generalize to `Copyable`) from
    `settings/calendar/CalendarFeedPanel.tsx` on the promo-code cell in `promos/page.tsx` —
    and fix its silent clipboard-failure path while there (show "copied" / "couldn't copy —
    select it manually").
    **Done — this PR.** `src/components/Copyable.tsx` (new, generalized).
88. **[S] Retry/delete for failed promos.** A `failed` Stripe promo shows a badge and nothing
    else. Add a "Try again" action (re-run creation) and allow deleting `failed`/`pending`
    codes (`promos/actions.ts`, `src/db/shop-promos.ts`).
    **Done — this PR.**
89. **[S] Label promo datetimes with the shop timezone.** Add "times are in {shop timezone}"
    hint under the `datetime-local` inputs in `promos/page.tsx`, matching how the list
    renders.
    **Done — this PR.**
90. **[M] Anchor Settings save notices to their section.** Nine forms share one top-of-page
    notice banner that's off-screen after scroll restore (`SettingsPage.tsx`). Carry a
    `?saved=<section>` param and render the success notice inside the section that was saved.
    **Done — this PR.**
91. **[M] Guard the course editor against silent data loss.** In `courses/[slug]/edit`, warn
    before navigating with unsaved changes (a small dirty-state client wrapper +
    `beforeunload`), and make "Preview" open in a new tab so it can't destroy edits.
    **Done — this PR.** `UnsavedChangesGuard.tsx` (new).
92. **[S] Say which field failed in the course editor.** `courses.edit.errorInvalid` ("Check
    the fields and try again") spans ~15 inputs. Return the failing field name in the error
    state and anchor/highlight it.
    **Done — this PR.** `FieldErrorFocus.tsx` (new).

---

## 13. Victor — the skeptical owner evaluating a switch

On DiveShop360 today; burned by lock-in before; evaluates on a laptop at night, off-season.

**What he hits today.** The top nav carries only Product and Pricing — the switching guides
(the highest-intent asset) and About (the strongest trust asset) are footer-only
(`MarketingNav.tsx`). The homepage's switching link lists "EVE, DiveShop360, DiveAdmin, or
Smartwaiver" — **the FareHarbor and Rezdy guides exist but are omitted** (three places:
`diver.json`, `switching/page.tsx` meta, pricing FAQ). The pricing FAQ contradicts the
switching guides on how imported cert cards arrive ("as claims to verify" vs "verified and
flagged imported"). "Trial" appears everywhere but no trial mechanism, length, or billing
exists — and there is no way to become a paying customer at all. The onboard form wipes every
field on a validation error, offers eight hardcoded timezones (no Caribbean, no Mexico, no Red
Sea, no Southeast Asia), and lands new shops on a completely empty Today with no first-run
checklist. Two Stripe strings tell a self-serve trial owner to "ask whoever runs your hosting."
The switching guides never address downtime, staff retraining, rollback, or running in
parallel; the starter CSV template ships headers with zero example rows. The demo — the site's
best asset — is sold as a blind button with no preview of what's inside.

### Tasks

93. **[S] Add Switching and About to the top nav.** `src/components/MarketingNav.tsx` — two
    links. Check the mobile nav variant too.
    **Done — this PR.**
94. **[S] Fix the stale competitor list in all three places.** Generate the list from
    `src/lib/migration-guides.ts` (the registry) instead of hand-written copy in
    `diver.json:switching` link text, `switching/page.tsx` meta description, and the pricing
    FAQ answer — so a new guide can never be omitted again.
    **Done — already resolved before PR #274** (all three spots were already generated from
    `MIGRATION_GUIDES` when checked; no diff needed).
95. **[S] Reconcile the imported-cards claim.** Pricing FAQ says cards arrive "as claims for
    staff to verify"; the import code and guides say "verified and flagged imported"
    (`src/lib/import.ts`). Fix the FAQ to match the code.
    **Done — already resolved before PR #274** (no "claims to verify" wording found anywhere
    in the codebase; the pricing FAQ has no dedicated imported-cards question and the claim
    doesn't appear elsewhere — no diff needed).
96. **[S] Preserve onboard form values on error.** `onboard/actions.ts` redirects with only an
    error code; echo the non-secret fields back (query params or cookie flash) and set
    `defaultValue`s. Also add `autoComplete` attributes (`organization`, `name`, `email`,
    `new-password`) — currently none, so password managers ignore the form.
    **Done — already resolved before PR #274** (landed in the earlier "starter dozen" commit;
    no diff needed).
97. **[S] Fix the timezone list.** Replace the eight hardcoded options in `onboard/page.tsx`
    with grouped IANA zones covering dive markets (Caribbean, Mexico, Red Sea, SE Asia,
    Pacific), or generate from `Intl.supportedValuesOf("timeZone")` with a curated
    dive-region group on top. The schema already validates real IANA zones.
    **Done — already resolved before PR #274** (landed in the earlier "starter dozen" commit;
    no diff needed).
98. **[M] First-run checklist for new shops.** On an empty real shop's Today, render a 5-step
    setup card: contact details → first dive site → first trip → public schedule link (with
    copy button) → Stripe (optional). Each links to the exact screen; steps check off from
    real data (all queries exist). This is the largest conversion lever in the product —
    the current landing is an empty work queue.
    **Done** — shipped in an earlier commit this session (`5c82a84`, predates this PR's doc
    tracking): `FirstRunChecklist.tsx`, rendered on Today when a real shop has no next
    departure.
99. **[S] Rewrite the two "ask whoever runs your hosting" strings.** `settings.main.stripe.notConfiguredWarning`
    and `settings.main.notice.notConfigured` are reachable by self-serve owners. Reword for
    the actual audience ("Online payments aren't configured for this DiveDay instance yet —
    contact support") with the support email.
    **Done — PR #274.** The doc's second key reference (`settings.main.notice.notConfigured`)
    was actually `settings.embed.notConfigured` — fixed both real occurrences.
100. **[S] State what "trial" means.** Add one honest sentence wherever "trial" appears
    (pricing FAQ, onboard button area): free while in early access, no card, no time limit
    yet — matching `docs/product/human-decisions.md`'s open pricing decision. Do not invent a
    trial length.
    **Done — PR #274.**
101. **[M] Answer the migration fears in the guides.** Add a short "Cutover without drama"
    section to each switching guide (`src/lib/migration-guides.ts` + the shared template):
    run both systems in parallel, switch in the off-season, what to do on a bad import
    (re-import updates in place — verify against `src/db/import.ts` behavior first and
    document what's actually true), and a rough time estimate per step. Conversion-sensitive:
    run the `conversion-reviewer` agent after drafting.
    **Done — PR #274.** The `conversion-reviewer` agent pass is still outstanding on this PR.
102. **[S] Ship example rows in the CSV template.** `public/diveday-diver-import-template.csv`
    is headers-only; add 2–3 realistic example rows (clearly fake names) and reconcile the
    column set with the columns the spreadsheet guide documents (dive insurance, specialty,
    refresher due are documented but missing from the template).
    **Done — this PR.**
103. **[M] Preview the demo before the click.** The five per-role "Try:" prompts already exist
    (`demo.roles.*`); surface them on the landing page as a role-picker under the demo CTA
    ("Enter as: Owner · Front desk · Captain…") wiring each to `enterDemoAction`. Turns a
    blind button into a menu.
    **Done — this PR.** `src/lib/demo-roles.ts` extracted so the landing page and the demo
    banner share one source of role metadata. Conversion-reviewer pass still outstanding.
104. **[S] Add canonicals + OpenGraph to the switching pages.** `/switching` and every
    `/switching/[competitor]` page lack canonical and OG metadata — these are the pages that
    get pasted into WhatsApp groups. Follow the metadata pattern on `/pricing`.
    **Done — PR #274.**

---

## 14. June — assistive-tech and low-vision users

Screen-reader user booking a trip; low-vision older diver reading in sunlight; colorblind
staff member scanning statuses.

**What she hits today.** Foundations are strong — every interactive element gets a 3px
`:focus-visible` outline app-wide, `min-h-11` targets are baked into the button/control
primitives, reduced-motion kills every animation including the celebration bubbles, the star
input is a model radio-group pattern, and the manifest has a real skip link, progressbar
semantics, and `aria-live` counts. Measured token contrast is AA-to-AAA across all four theme
skins. The gaps are specific and fixable: **only 2 of 52 pages have a skip link** while every
staff page fronts 10–15 header tab stops; the command palette portal has **no dialog role, no
focus trap, no focus restore**, and announces nothing when results arrive; `KeyboardShortcuts`
claims `aria-modal` without trapping; the `WaterLocker` overlay can lock a motor-impaired user
out of roll call with no announcement (its touch heuristic reads assistive gestures as spray);
`DigitalCardFlip` wraps the whole certification card in a button whose `aria-label` suppresses
every word inside it; the app's own **contrast slider is an unlabeled `<input type=range>`**;
`Field` folds long helper text into every accessible name instead of `aria-describedby`;
per-field error wiring (`aria-invalid`/`aria-describedby`) exists in exactly two components;
`prefers-contrast: more` only works inside `.boat-mode`; small badges at `success`/`warning`
tone compute ~4.38:1 (just under AA at 12px); `bg-success/warning/danger` are hash-assigned as
*decorative avatar colors* on the missing-divers grid (a red avatar reads as flagged); course
hero and gallery images are declared decorative (`alt=""`); required fields carry no visible
indicator; and status tones rely on hue + reading the words — no icon or sr-only prefix in the
`Badge`/`ShopNotice` primitives (the ●/✓ glyph pattern exists in two components already).

### Tasks

105. **[S] Real alt text for course images.** Course hero and gallery images render `alt=""`.
    Add an optional caption/alt field to the course photo editor
    (`courses/[slug]/edit`), falling back to "{course title} — photo {n}" rather than
    decorative silence.
    **Done — this PR.**
106. **[S] Mark required fields visibly.** `Field` in `src/components/ui/form.tsx` renders
    required and optional controls identically. Add a visible required marker (or an
    "all fields required unless marked optional" line at the top of each form — pick one
    convention, apply everywhere, document in `docs/design/forms-and-controls.md`).
    **Done — this PR.**
107. **[M] Audit icon-only controls.** Sweep `src/components/` and `src/app/shop` for
    icon-only buttons (`?` shortcuts trigger, unassign ×, calendar chevrons) and ensure each
    has an `aria-label` from the message bundles. Add a lint note to the forms doc.
    **Done — this PR.**
108. **[M] Keyboard-and-SR pass on the booking flow.** Tab-order and announcement walkthrough
    of schedule → trip → booking form → confirmation (the e2e flow exists; add an
    axe-core/playwright a11y assertion pass to it). Fix what it finds; keep the axe check in
    the spec so it ratchets.
    **Done — this PR.**
109. **[S] Skip links everywhere.** Generalize the manifest's skip-link pattern into the root
    and shop layouts (`src/app/layout.tsx`, `shop/[shopSlug]/layout.tsx`) so every page—not
    just two—lets keyboard users jump past the header.
    **Done — this PR.** `SkipLink.tsx` (new, shared).
110. **[M] Fix the two portal dialogs.** `CommandPalette.tsx`: add `role="dialog"`,
    `aria-modal`, focus trap, focus restore on close, and an `aria-live` region announcing
    result counts ("3 divers, 2 trips"). `KeyboardShortcuts.tsx`: same trap/restore (it
    already claims `aria-modal`). One shared focus-trap utility for both.
    **Done — this PR.** `useFocusTrap.ts` (new, shared).
111. **[S] Label the contrast slider.** `AmbientGlareDetector.tsx`'s range input needs
    `aria-label` + `aria-valuetext` mapping 0/1/2 → Auto/Standard/Full AAA (strings from the
    staff bundle via props).
    **Done — this PR.**
112. **[S] Un-suppress the digital cert card.** `DigitalCardFlip.tsx`'s wrapping
    `aria-label` overrides all inner text (agency, level, name, verification status). Move
    the flip affordance to a small labeled control, or use `aria-describedby` so inner
    content stays readable. Also fixes the `<h4>`-inside-a-button nesting.
    **Done — this PR.**
113. **[S] Give WaterLocker dialog semantics + an announcement.** `role="dialog"`,
    `aria-modal`, focus containment, and an `aria-live` explanation when it engages, so an
    assistive-tech user locked out of roll call knows why and how to unlock. Pairs with the
    off-switch in task 78.
    **Done — this PR.**
114. **[M] Wire `aria-describedby` in `Field`.** `ui/form.tsx` should emit an id for the
    description and reference it from the control instead of folding hint text into the
    accessible name of ~25 fields. While in the file: extend the per-field
    `aria-invalid`/`aria-describedby` error pattern (currently only `BookingPartyFields` and
    `ImageFileInput`) so page-level `role="alert"` banners also point at the failing control.
    **Done — this PR.**
115. **[S] Tone icons in the primitives.** Add a small glyph or `sr-only` tone prefix
    ("Error:", "Done:") to `Badge` and `ShopNotice` so status survives colorblind scanning;
    nudge the `success`/`warning` sm-badge text colors to ≥4.5:1. Neutral-color the
    missing-divers avatar hash (`MissingDiversGrid.tsx`) so red stops meaning nothing.
    **Done — this PR.**
116. **[S] Un-scope `prefers-contrast: more`.** `globals.css` limits both increased-contrast
    blocks to `.boat-mode`; honor the OS preference app-wide. Also: the glare-mode 16px text
    floor matches `text-xs`/`text-sm` but misses arbitrary sizes (`text-[10px]`,
    `text-[8px]` in `DigitalCardFlip`, `MissingDiversGrid`, the contrast slider ticks) —
    raise those to tokens the floor can catch.
    **Done — this PR.**
117. **[S] Define the missing tokens.** Three classes reference tokens that don't exist and
    render invisible UI: `bg-info` (`RollCallNote.tsx` — the queued-status dot),
    `bg-primary-sunken` (`WaterLocker.tsx` — the hold-to-unlock progress fill!), and
    `to-primary-sunken` (`DigitalCardFlip.tsx`). Define `--info` and `--primary-sunken` in
    `globals.css` (all four theme skins) or swap to existing tokens. The invisible unlock
    progress is a real boat-surface bug, not just polish.
    **Done** — shipped in an earlier commit this session (`5c82a84`, predates this PR's doc
    tracking); the rest of June's persona shipped in this PR.

---

## 15. Leo — anyone on a slow island connection

Diver on hotel 3G; divemaster on marina wifi; a shop where "the internet is down" is weather.

**What he hits today.** Every diver-facing route opts into dynamic rendering (correct for
live data) but many routes have **no `loading.tsx` and no Suspense boundary** — cold
navigation is a blank screen on exactly the token pages (`/ready`, `/recap`,
`/waivers/[token]`) a diver opens from email. There is **no `not-found.tsx` in the entire
app** (17 `notFound()` callers land on Next's unstyled English default) and exactly **one
`error.tsx`** — any other render throw replaces the whole layout with the crash screen. No
image goes through `next/image`: the dive-site satellite hero is an unlazied, dimensionless
`<img>` (guaranteed CLS on the page's biggest asset). Two analytics SDKs load on anonymous
diver pages before the booking form does. Despite a genuinely excellent service worker for
the offline manifest shell, there's **no web app manifest** — the roll call can't be
installed to a home screen — and offline coverage is exactly one surface: a divemaster
offline has no schedule, no briefings, no diver profiles; a diver offline can't open their
own `/ready` page. Emails ship as bare HTML fragments (no doctype, no viewport meta, no
max-width, no dark-mode handling) with one off-brand Tailwind-blue box in the booking
confirmation, no logo, and no unsubscribe link on the marketing-adjacent templates.

### Tasks

118. **[M] Add `not-found.tsx` and per-segment `error.tsx`.** Root + shop-level
    `not-found.tsx` (branded, translated, with a way back — merges with task 13), and an
    `error.tsx` for each top-level segment, prioritizing the diver token routes and Today.
    Follow the existing `trips/[id]/error.tsx` and address its documented i18n punt once
    rather than copying it.
    **Done (partial) — PR #274.** The root `not-found.tsx` (branded, translated, already
    good — task 13's ask) and most `error.tsx` boundaries (waivers, ready, recap, shop,
    trips/[id]) predate this PR; added the three still-missing ones (verify, invite,
    reset-password). Did not add a separate shop-level `not-found.tsx` — Next's
    `not-found.tsx` takes no props, so it can't read `shopSlug` to build a shop-specific
    link, and the shop layout's `ShopNav` already wraps any `notFound()` inside `/shop/**`
    for a staff visitor, making the root page's generic link-home sufficient. Did not touch
    `trips/[id]/error.tsx`'s i18n punt.
119. **[S] `loading.tsx` for the token routes.** Body-shaped skeletons (the house style —
    see `blockers/loading.tsx`'s comment) for `/ready`, `/recap`, `/waivers/[token]`,
    `check-in`, `reviews`, `promos`, `reports`. Also fix the two skeleton/page max-width
    mismatches (Appendix A).
    **Done (partial) — PR #274.** All seven named `loading.tsx` files added, each matching
    its page's own max-width. Did not touch the separate `schedule`/`schedule/[id]`
    max-width mismatch noted in Appendix A — a different pair of pages.
120. **[M] Adopt `next/image` (or lazy + dimensions) for content images.** `sharp` is
    already a dependency; the four unlazied `<img>`s (`DiveBriefingCard`,
    `DiveSiteFieldGuide`, waiver sites peek, course gallery) need lazy loading, dimensions,
    and responsive sizes. Watch the visual-regression suite — pixel diffs expected and
    explainable.
    **Done — PR #274.** Took the "lazy + dimensions" alternative the task itself offers,
    not full `next/image` (would need `images.remotePatterns` for the wildcard
    `*.public.blob.vercel-storage.com` blob host). Three of the four spots already had a
    CSS-reserved box (fixed height or `aspect-*`) and only needed `loading="lazy"`; the
    course gallery already had both — checked, not touched.
121. **[S] Add a web app manifest.** `src/app/manifest.ts` with name, icons (assets exist in
    `icon.tsx`/`apple-icon.tsx`), `display: standalone`, theme color from the token values —
    so crew can install the roll call to a home screen. Small file, big boat win.
    **Done — PR #274.**
122. **[M] Wrap emails in a proper document.** One shared wrapper in
    `src/lib/notifications/` (doctype, `<html lang>`, viewport meta, max-width container,
    plain-text-adjacent styling), replace the packing block's Tailwind-blue `#3b82f6` with
    the brand token value, add the shop name as a text header and an unsubscribe link on
    last-minute-deal / waitlist / recap templates. Keep deliverability-safe simplicity —
    no image-heavy layouts.
    **Done (partial) — PR #274.** `wrapEmailHtml()` wraps every outbound email via
    `messageFor()`, the brand-token swap and shop-name header are shipped. The
    unsubscribe-link half is deferred: there's no self-serve unsubscribe token/route today
    (only a staff-side `unsubscribeLastMinuteListEntry`), and building one — a new token
    type, a route, security review — is a real feature on its own, not a follow-on to a
    document-wrapper task.
123. **[S] Defer the analytics SDKs on public pages.** `observability-client.tsx` mounts
    `@vercel/analytics` + `@vercel/speed-insights` unconditionally; lazy-load them
    post-hydration (or drop speed-insights from anonymous diver pages) so 3G visitors get
    the booking form first.
    **Done — this PR.** Dynamic-imported, mounted post-hydration via `requestIdleCallback`.
124. **[M] Tell the crew about stale offline versions.** A deploy while a device is offline
    leaves it holding old shell assets with no signal (`manifest-sw.js` is hand-versioned,
    `skipWaiting` swaps silently). Surface "this saved copy is from an older version of
    DiveDay" in `OfflineManifestView` when the SW cache version and app version disagree,
    and add a visible refresh nudge when a new worker activates mid-session.
    **Done — this PR.** `OfflineShellVersionBanner.tsx` (new).

---

## 16. Lens: over-explained, over-technical copy

The pattern, stated once: **the product writes best where it names an outcome and worst where
it recently earned a hard-won correctness guarantee.** "It's on the board." / "Verified and on
file." / every email subject line — perfect. But wherever engineering solved something hard —
import fidelity, offline reconciliation, waiver integrity, Stripe coupon ownership, dive-site
template merges — the copy re-derives the guarantee for the reader instead of asserting the
result. The email bundle has **zero mechanism leaks** across 15 templates; it is the house
standard the import and offline surfaces should be held to.

**Mechanism leaks worth keeping** (trust that answers a real fear — trim, don't cut):
calendar "read-only, DiveDay never changes anything"; Stripe "DiveDay never holds your money";
calendar-link "treat it like a password"; "no silent passes"; the fill-station gas-analysis
scope note.

**Leaks that are noise**, with the worst offenders: the offline manifest explains its sync
algorithm on six surfaces ("Boarding goes by readiness as it stood when this copy was
saved…" — the captain, offline, cannot act on any of it); Promos explains that "the coupon
lives on your account, not DiveDay's" and that "Stripe enforces the expiry"; the waiver
settings page says "server-sealed HMAC over their signed metadata and template snapshot";
divers-remove says "This is a **soft delete**"; Reports says "Stripe was asked to do something
and the app never confirmed how it went" under a heading containing "reconciliation"; the
product hero says "roll-call event"; the marketing capability index says "negotiated
language," "append-only boarding history," and "command palette." Internal vocabulary verdicts:
*manifest*, *roll call*, *readiness*, *Today* — earned, keep; *blockers* (nav label),
*checkpoint*, *workspace*, *line-busting*, *demand signal*, *authoritative roster*, *soft
delete*, *reconciliation*, *coupon* — internal, rename.

**Caveat overload:** the import contract ("cards land verified and flagged imported, one-tap
confirm, specialty waits on the confirm, medical answers never reconstructed") is restated in
**~19 places** across `diver.json`, `staff.json`, `src/lib/import.ts`, and
`src/lib/migration-guides.ts` — including the same 82-word paragraph twice in one file, on
pages that also render the honesty table saying it a third time. Reassurances that raise the
fear they answer: "nothing here is private to anyone but you" (×2), "so you're never left
without one," three separate "nothing is ever quietly…" constructions on marketing pages.

**Walls of text:** `/product` ships 74 bullets (30 feature + 44 capability); the honesty
table's worst rows run 119/125/106/104 words; the course editor has 21 hint slots on one form;
the import wizard shows ~313 words of preamble before a file is chosen; the export page's
"not included" note is one 87-word paragraph.

### Tasks

130. **[M] One canonical import contract.** Trim every `IMPORT_HONESTY_TABLE` row
    (`src/lib/import.ts`) to ≤25 words with a one-line summary (move the 119/125-word rows'
    nuance behind the table's existing detail affordance or cut it), then delete the ~18
    restatements across `diver.json` (switching pages ×5, FAQ), `staff.json` (import wizard
    ×3, settings), and `migration-guides.ts` (×4), replacing each with one short sentence
    that defers to the table. The two byte-identical 82-word `importReadyBody` paragraphs
    collapse to one ~30-word version. Removes ~600 words; `pnpm check:copy --write` banks it.
    Conversion-sensitive pages → `conversion-reviewer` after.
    **Done — PR #269.**
131. **[M] Offline manifest: state, not story.** Across the six offline-manifest copy surfaces
    (`staff.json` offlineManifest/offlineManifestManager namespaces, `diver.json` product/FAQ
    notes): replace reconciliation narration with a two-state vocabulary (sent / needs a
    look) and one-line freshness ("Readiness as of {time}. We'll re-check when you're back in
    signal."). Also fix the unactionable stale-copy line ("don't rely on it until you've
    refreshed" — told to someone offline). ~250 words removed.
    **Done — PR #269.**
132. **[S] Strip engineering nouns from user-visible strings.** Rewrites, all in the bundles:
    "soft delete" → "They come off your active lists; bookings, cards, and sizes stay on
    file."; the HMAC waiver-integrity description → "Signed waivers are tamper-evident — if a
    record has been altered, we flag it." (the marketing phrasing is already better than the
    in-app one; converge on it); "reconciliation" report headings → "{n} payments we couldn't
    confirm. Check them in Stripe."; "roll-call event" → "head count"; "workspace" → "shop";
    "coupon lives on your account" → "codes are created on your own Stripe account";
    "command palette" (marketing) → "search that jumps straight to a diver or a trip";
    "line-busting check-in" → "counter check-in"; "demand signal" → "this boat could take
    more"; "authoritative roster" → "everyone aboard".
    **Done — PR #269.**
133. **[M] Rename the "Blockers" nav label.** Staff say "who isn't ready," not "blockers" —
    the page's own empty state ("Every boat is boarding-ready") proves the right register.
    Rename nav + page title to "Not ready" (bundle keys in `staff.json`, nav in
    `ShopNavLinks.tsx`); leave internal code names alone. Check the e2e specs that navigate
    by label.
    **Done — PR #269.**
134. **[S] Cut the fear-raising reassurances.** Remove "nothing here is private to anyone but
    you" (both places — also flagged as confusing in task 30's orbit), "better than quietly
    substituting one," and reduce the three "quietly/silent" marketing constructions to one.
    **Done — PR #269.**
135. **[M] Put the 44-bullet capability index behind disclosure.** `/product` renders 74
    bullets; keep the 30-bullet story inline and collapse `productCapabilityIndex` behind a
    "The full list" `<details>` (or a `/product/everything` page). `conversion-reviewer`
    after.
    **Done — PR #269.**
136. **[M] Halve the form-hint density on the two worst forms.** Course editor (21 hint
    slots) and new-trip (14): delete duplicate hints, move validation rules out of permanent
    hints into inline errors (e.g. the deposit "Ignored if it's blank or not below the
    price" rule), and show niche help only on focus. Follow
    `docs/design/forms-and-controls.md`.
    **Done — PR #269.**
137. **[S] Shorten the fifteen longest strings.** The audit's length table (94→36 words for
    the switching FAQ, 87→32 for the export exclusions, 64→18 for `blockedAfterDive`, etc.)
    is a ready-made worklist: apply the suggested rewrites via the `i18n-copy` skill, en +
    es, and bank the copy reduction. Protect the good-examples list (the done-states, the
    email bundle) as the register to match.
    **Done — PR #269.**
138. **[S] Dedupe the coexist blocks.** FareHarbor's and Rezdy's `coexist.runsInDiveDay`
    items in `src/lib/migration-guides.ts` differ only by competitor name in 4 of 6 items —
    extract the shared items into the registry's shared template so the two guides can't
    drift.
    **Done — PR #269.**

---

## 17. Lens: redundancy, coupling, and contextual findability

Three questions: where does the same capability exist twice (and is the duplication earning
its keep), what lives together that shouldn't (and apart that should), and when a user is in
situation X, can they reach the tool for X without a nav reset?

**Redundancy verdicts.** Deliberate and fine: reviews rendered in three places (public
schedule, moderation, diver's own echo — different personas, different jobs); the two
trip-creation forms (quick builder add vs. full form — the split is documented in the code).
Deliberate but unreconciled: the **two discount systems** (shop promo codes vs. per-trip
last-minute deals — the model split is intentional, but no single surface lists every live
code, and their valid ranges differ for no user-visible reason); the **wait list vs.
last-minute list** (per-trip queue vs. shop-wide deal alerts — neither form mentions the
other, and a deal blast can give away the seat a wait-lister was queued for). Drift: **crew
assignment has two write semantics against the same table** (Today's board assigns
per-person; the trip's CrewSection replaces the whole set — two staff can silently clobber
each other); **waiver sending exists as two UI generations** (the optimistic in-place
control vs. the roster's redirect variant — the code itself notes they run the same path);
**emergency contact is captured by two differently-labeled forms** on `/waivers` and
`/ready` writing the same columns — while staff, told by Today to "ask at the counter,"
**have no field anywhere to type it into**; `checked_in` has exactly one reader in the app —
the manifest never shows counter check-in, and the check-in page never shows boarding;
"instructor missing" is computed three different ways (only the trip page knows about
ratios); and the notice-code→copy map is re-implemented in ~11 files with tone drift.

**Coupling.** `/shop/[slug]/schedule` is four products on one 553-line route (staff KPIs +
builder, public calendar + booking list, reviews, last-minute signup, plus an embed mode) —
with a provably-dead `staffView` ternary inside the not-staff branch, and the anonymous
diver's signup action living in the same `"use server"` module as the auth-gated builder
mutations. The trip Guests tab carries seven jobs including a marketing blast and post-trip
photo moderation. Settings is an 11-card undifferentiated stack (still internally named
`PaymentsSettingsPage`). Reports carries two platform-health alert queues (stuck Stripe ops,
failed photo deletions) that belong on Today.

**Findability dead-ends.** The check-in page — the surface where a diver is standing in
front of you — contains **zero links**: diver names, trip titles, and blockers are all plain
text. The prep page (a Today destination) has zero links. Staffing's coverage gaps name a
trip they can't take you to. The trip Overview can't reach the course it teaches, the dive
site it visits, or the deal that applies. **No staff surface links to the public booking
page** — staff cannot preview or share the page divers buy from — and `/reviews`' "View
public page" button lands staff on the builder, which excludes reviews, so its promise is
structurally impossible for its only audience. Orders have no index and appear in no nav or
search — reachable only through a diver's payments section. The command palette can't find
check-in, staffing, dive sites, courses, reviews, reports, promos, or orders. Import (in
Settings) and the switching guides that sell it never link to each other in either
direction.

### Tasks

139. **[M] One write semantics for crew.** Make the trip `CrewSection` use the same
    per-person assign/unassign action as Today's `DepartureBoard` (replace-whole-set loses
    concurrent edits), and link each staffing coverage gap (`staffing/page.tsx`) to the
    trip's crew editor with a `#crew` anchor. Also give Today's `instructor_missing` row
    that anchor — it currently lands on the bare Overview.
    **Done — UXP session, 2026-07-31.**
140. **[M] One waiver-send control.** Extend `WaiverSendSurface` with `"roster"` and mount
    `WaiverSendControl` in `RosterSection`, deleting the redirect-based
    `issueWaiverAction`/banner variant so both surfaces share optimistic feedback and the
    no-email fallback.
    **Done — PR #274.** The roster's checkbox-driven bulk sender
    (`bulkSendWaiversAction`) is untouched — a different affordance the task didn't name.
141. **[S] Name the time windows.** Today (7 days), Blockers (next 40 trips), check-in
    (−6h/+36h) slice the same readiness data with undocumented horizons — a diver "cleared"
    on one list still shows on another. Say the window in each page's description line.
    **Done — UXP session, 2026-07-31.**
142. **[S] Rename the "Waivers" nav item.** It points at the release-template editor, not
    signature chasing. Rename to "Waiver template" and move it into the admin group in
    `ShopNavLinks.tsx`; longer term see task 155.
    **Done — UXP session, 2026-07-31.**
143. **[S] Deduplicate emergency-contact capture.** `/ready` and `/waivers` both collect it
    with different labels. Show it read-only with an "already on file" state on whichever
    surface the diver reaches second (both write through `saveBookingEmergencyContact`).
    **Done — UXP session, 2026-07-31.**
144. **[M] Let staff record an emergency contact.** Today tells staff to "ask at the
    counter" and links to a roster with no field. Add the two fields to the roster's
    per-diver card and the diver-record edit form (`divers/[personId]/actions.ts`
    `personSchema` has no contact fields). Prints on the manifest → safety-adjacent,
    failure-path tests.
    **Done — UXP session, 2026-07-31.**
145. **[S] Distinguish the two demo doors.** "Try the live demo" mints a staff demo;
    "See a live schedule" hard-links the seeded shop's diver view from a presentational
    component. Relabel ("Try the staff app" / "See a diver's booking page"), source the slug
    from `DEMO_SHOP_SLUG`, and tag the schedule link for funnel attribution.
    **Done — PR #270.**
146. **[S] Stop reusing the calendar page's keys in Settings.** The Settings card renders
    the calendar page's full title/description; add proper `settings.main.calendar.*`
    teaser keys like every sibling card.
    **Done — PR #270.**
147. **[M] Reconcile wait list and last-minute list.** Make the deal send offer wait-listed
    divers first (they hold "a place in line" the deal can currently sell out from under),
    and cross-reference the two diver forms ("Want any-trip deal alerts instead?"). Read
    `src/db/trip-promos.ts` + waitlist logic in `src/db/bookings.ts` first; tests on the
    ordering.
    **Done — PR #270.**
148. **[S] One page listing every live discount.** Add a read-only "Trip deals" section to
    `/promos` showing outstanding last-minute codes with links to their trips, and align
    the two systems' discount ranges (1–100% vs 5–90%) or say why they differ. Also fix
    `LastMinuteDealSection` rendering the raw status enum (`sent`/`pending`/`failed`) into
    a Badge — bundle keys.
    **Done — UXP session, 2026-07-31.**
149. **[S] Make check-in and boarding visible to each other.** Show a "Checked in ✓" pill
    on the manifest row and a "Boarded" pill on the check-in row (the check-in page's own
    description promises this split; the UI doesn't carry it through).
    **Done — UXP session, 2026-07-31.**
150. **[S] Flag unpriced builder trips.** A builder-created trip publishes to the public
    schedule with no price and the builder never says so. Show "No price set" on the
    builder card, linking to the trip's Details form.
    **Done — UXP session, 2026-07-31.**
151. **[M] One "course crew gap" computation.** The trip page, staffing page, and Today
    each compute "no instructor" differently (only the trip page knows PADI ratios).
    Extract one helper in `src/lib/` consumed by all three, with the ratio logic; unit
    tests move with it.
    **Done — UXP session, 2026-07-31.** Extracted to `src/lib/course-ratios.ts`.
152. **[S] Shared flash-notice helper.** ~11 files re-implement the `?notice=` →
    `{tone, copy}` map with tone drift for the same outcomes. One `noticeFromParam` helper
    + shared banner component.
    **Done — UXP session, 2026-07-31.** `src/lib/staff-notices.ts` + `StaffNoticeBanner`;
    migrated the files that fit the common shape.
153. **[L] Split the schedule route.** `/schedule` becomes the public, canonical,
    embeddable page (calendar, list, reviews, last-minute form); the staff builder + KPI
    tiles move to `/schedule/board` (staff-only), which links to the public page as its
    preview. Delete the dead `staffView` ternary inside the public branch, and move the
    anonymous `joinLastMinuteListAction` out of the builder's auth-gated action module.
    Big but high-value: it makes task 160 trivial and un-forks the page nobody can see
    whole. Route change → check e2e specs, sitemap, canonical metadata.
    **Deferred — UXP session, 2026-07-31.** Deliberately not attempted in this pass: it's
    the single highest-risk item in the doc (a route split touching e2e specs, sitemap,
    and canonical metadata across a page nearly every other task this session also
    touched), and task 160 — the thing it was meant to make trivial — already shipped
    without it. Left for a dedicated follow-up.
154. **[M] Group Settings.** Three labelled groups ("Your shop" / "Money" / "Data &
    integrations") with anchors, sub-page back-links (`settings/team`, `calendar`,
    `import`, `export` currently have no route back), and the founder mailto demoted to a
    footer. Rename the component from its stale `PaymentsSettingsPage`.
    **Done — UXP session, 2026-07-31.**
155. **[M] Give `/waivers` two tabs — Template and Signatures.** The template editor,
    signature chasing (Blockers/Today), and the signed-record evidence are three
    unconnected places today; a Signatures tab listing signed records (linked from blocker
    rows) closes the loop. Security-sensitive (waiver records) → reviewer per AGENTS.md.
    **Done — UXP session, 2026-07-31.** Security-reviewer pass pending before merge.
156. **[S] Slim the Guests tab.** Move the last-minute deal blast behind a "Promote" card
    or `/promos` (with trip picker) and recap-photo moderation to the trip Overview beside
    the crew shoutout — Guests returns to "who is attending."
    **Done — UXP session, 2026-07-31.**
157. **[S] Move ops alerts from Reports to Today.** Stuck Stripe operations and failed
    photo deletions are urgent chores gated behind the owner-only monthly report; surface
    them as `urgency: "now"` Today rows (Reports keeps the monthly view).
    **Done — UXP session, 2026-07-31.**
158. **[M] Give orders an index.** `/orders` with status/date/diver filters, added to nav
    (or Settings' Money group), command-palette go-tos, and linked from Reports revenue
    rows and roster payment cells. Today orders are reachable only via a diver's payments
    section.
    **Done — UXP session, 2026-07-31.**
159. **[S] Link the dead-end pages.** Check-in rows: diver name → record, trip →
    manifest, per-blocker fix buttons (extends task 68). Prep page: every named diver →
    their record, nitrox rows → their cards. Blockers and Reviews: link the diver name.
    Reports: link trip rows to their Guests tab. Dive-site page: "Upcoming dives here"
    list; trip header: link the site and the course title.
    **Done — PR #270.**
160. **[S] Let staff see and share the diver's booking page.** "View / share booking page"
    action on `TripHeader` (copy link + open), and fix `/reviews`' "View public page" to
    show a view that actually contains reviews (`?embed=1` or a diver-preview flag until
    task 153 lands).
    **Done — PR #270.**
161. **[S] Show a diver's upcoming trips on their record.** The diver page fetches
    upcoming trips only to populate the booking dropdown (filtered to trips they're *not*
    on). Add an "Upcoming" list above the history, each row linking to the manifest —
    answers "which boats is this person on this week?"
    **Done — PR #270.**
162. **[M] Widen the command palette.** Add every gated nav destination (check-in,
    staffing, dive sites, courses, reviews, reports, promos, orders) to the go-to list,
    and dive sites + courses + orders to `searchShop` in `src/db/search.ts`.
    **Done — PR #270.**
163. **[S] Connect import and the switching guides.** `settings/import` offers "Coming
    from EVE / DiveShop360 / a spreadsheet?" links to the matching guide; each guide's CTA
    deep-links signed-in owners to `/settings/import`. Zero links exist today in either
    direction.
    **Done — PR #270.**
164. **[S] Send signed divers back to readiness.** After `completeAction` on
    `/waivers/[token]`, redirect to the booking's readiness link (when it resolves) so the
    diver lands on "what's left" instead of the signed-waiver page with no forward path
    beyond one link.
    **Done — PR #270.**
165. **[M] Cross-link staffing shifts and trip crew.** A person can crew a boat with no
    shift or hold a shift with no boat, and neither surface knows. Show assigned trips in
    each staffing card and shift coverage inside `CrewSection`.
    **Done — UXP session, 2026-07-31.**

Each of these is a small task ("make X consistent with Y") suitable for a lesser model; file
refs above.

- **Full-boat badge:** grey `neutral` on the schedule builder vs. celebratory green `success`
  on trip pages (the trip page comment explains why success is right — align the builder,
  `ScheduleBuilder.tsx`).
  **Done — UXP session, 2026-07-31.**
- **Confirmation dialogs:** native `window.confirm` for deletes/resends/rotations; nothing at
  all for hiding reviews or signing out; the refund preview can't render in either. One shared
  inline-confirm component (tasks 50, 81, 85).
  **Done (partial) — UXP session, 2026-07-31.** `src/components/ui/InlineConfirm.tsx` (task
  50, cancel/reschedule) and `src/components/InlineConfirmButton.tsx` (task 81, sign-out) both
  shipped, built independently by concurrent batches — two similar components, not yet
  unified into one. Not adopted for every remaining `window.confirm` site; a follow-up should
  consolidate on one component and finish the sweep.
- **Failure feedback:** worded rollback (roll call) vs. silent revert (crew assign) vs. silent
  no-op (clipboard copy). Standard: every failed action says so in words (tasks 63, 87).
  **Done — UXP session, 2026-07-31.**
- **Copy-to-clipboard:** exists once (`CopyableUrl`); needed on promo codes, public schedule
  URL, payment links (task 87 generalizes it).
  **Done — UXP session, 2026-07-31.** Generalized to `src/components/Copyable.tsx`, used on
  promo codes; not yet swept onto every one of the five original call sites.
- **Empty states:** shared dashed `EmptyState` vs. bespoke emoji panels vs. bare `<p>` — pick
  the warm bespoke pattern for terminal pages, the compact one for sections; document in
  `design/principles.md`.
- **Date formatting:** `formatDateTimeTz` everywhere except `toLocaleString()` in
  `OfflineManifestManager`, device-locale `Intl` in the offline view (justified — offline),
  and `"en-US"` in `db/today.ts` (tasks 61, 76).
  **Done — PR #274 (task 61) + UXP session 2026-07-31 (task 76).**
- **Two price-entry patterns:** Settings' `PriceField` (`type="number"`) vs. course editor's
  free-text decimal inputs — unify on `PriceField`.
  **Done — UXP session, 2026-07-31.**
- **Skeleton/page mismatch:** `schedule/loading.tsx` and `schedule/[id]/loading.tsx` use
  different max-widths than their pages, causing a double reflow — match the layout constants.
  **Done — UXP session, 2026-07-31.**
- **Authorization refusals:** in-page notice naming roles (best) vs. wrong-page notice vs.
  silent redirect (task 82 is the sweep).
  **Done — PR #274/UXP session (task 82).**
- **ICU placeholder `fill()` re-implemented three times** in client components
  (`DepartureBoard`, `WaterLocker`, `OfflineManifestManager`) — none handle plurals, hence
  awkward `…One`/`…Other` prop pairs. Extract one shared helper.
  **Done — UXP session, 2026-07-31.** Extracted to `src/i18n/fill.ts` (`fill`/`pluralForm`).
- **Hand-rolled danger banners:** `bg-danger/10 …` is copy-pasted in seven places
  (`sign-in`, `reset-password`, `invite`, `onboard`, `dive-sites` ×2, `BookingSections`)
  with three different paddings while `ShopNotice` exists — unify.
  **Done — UXP session, 2026-07-31.**
- **`ShopPageHeader` skipped by five pages** (`settings`, `courses/[slug]`,
  `schedule/[id]`, `divers/[personId]`, `offline-manifest`) that hand-roll their `<h1>`.
  **Done — UXP session, 2026-07-31.**
- **Copy-to-clipboard implemented five times** with reset delays from 2000–4000ms — the
  `Copyable` generalization in task 87 should absorb all of them.
  **Done (partial)** — see the "Copy-to-clipboard" bullet above; `Copyable` exists, full sweep
  outstanding.
- **The embed snippet ships an off-token color:** `settings/embed/page.tsx` hardcodes
  `background:#0f766e` — not any DiveDay token (`--primary` is `#0e7490`). Every shop that
  pastes it gets an off-brand button.
  **Done — UXP session, 2026-07-31.**
- **Undo pattern used once:** `UndoToast` frames itself as the house alternative to
  blocking confirms but has exactly one call site — either adopt it for the destructive
  actions in tasks 50/85 or note why confirms won.
  **Deferred — UXP session, 2026-07-31.** Tasks 50/81/85 all shipped with the inline-confirm
  pattern instead (see above) rather than `UndoToast` — a destructive action (cancel a
  booking, sign out, hide a review) benefits more from a confirm-before-acting step than an
  undo-after-acting one, since some of these effects (a refund, a signed-out session) aren't
  cleanly reversible. Left as a real, unresolved inconsistency rather than silently reconciled.

## Appendix B — ranked quick wins

If handing a lesser model twelve tasks tomorrow, in order of leverage-per-effort:

1. Task 125 — `<html lang>` hardcoded to `en` (one line; every screen-reader + Spanish user).
2. Task 117 — undefined tokens rendering invisible UI (the hold-to-unlock progress fill on
   the boat surface is invisible today).
3. Task 10 — desync'd schedule calendar/list (public-facing correctness bug).
4. Task 40 — pre-answered medical questionnaire (safety + liability).
5. Task 98 — first-run checklist (largest conversion lever).
6. Task 67 — fast walk-in flow (highest-friction daily staff task).
7. Task 31 + 61 — domain-layer English leaks (`capacityLabel`, `db/today.ts`).
8. Task 94 + 95 — stale/contradictory marketing claims (trust damage, pure copy).
9. Task 118 — no `not-found.tsx`/`error.tsx` coverage (every stale email link today lands
   on an unstyled English 404).
10. Task 52 + 53 — recap ordering + missing tip-paid notice (revenue-adjacent).
11. Task 63 — crew assignment unusable on touch (daily staff pain).
12. Task 96 + 97 — onboard form data loss + timezone list (first-impression funnel).
13. Task 159 — the zero-link dead-end pages, starting with check-in (a diver is standing
    at the counter and the page can't take you anywhere).
14. Task 147 — the last-minute deal can sell a wait-listed diver's seat out from under
    them (fairness bug, not just polish).
15. Task 130 — the import contract restated ~19 times (largest single copy cleanup).

---

*Method note: findings compiled from seven parallel code explorations (public diver surfaces;
token surfaces; staff surfaces; marketing/onboarding; cross-cutting a11y/i18n/states;
over-explained copy; information architecture and findability) plus live-app screenshot passes
(desktop + mobile, signed-out + owner session) against the seeded demo shop on this date. File
references are anchors, not guarantees — re-verify line positions before editing.*
