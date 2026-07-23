# Product-space investigation — what to do next

> ## 📦 Archived — historical assessment (2026-07-20)
>
> This is a snapshot, not live work. Its core finding ("we built the pillars but not the limbs") was
> **acted on**: the blocker queue, one-screen check-in, and `/ready` page shipped, and its "convert
> the spine into surfaces" recommendation became the [UX audit](ux-audit-20260721.md), which has
> itself since fully shipped. Its cut list was largely executed (Checkout seam and agency plumbing
> removed; monster pages decomposed). Retained for the rationale; for current state see
> [shipped.md](../shipped.md) and for open work see [roadmap.md](../roadmap.md). The one live residue
> — pausing/hiding the dive-site CMS and global catalog behind unproven value — is not yet on the
> roadmap; raise it there if it still matters.

> A strategic read of where DiveDay actually is versus where the vision says it should be, and an
> opinionated recommendation for the next arc of work. Written 2026-07-20 from a full pass over
> [vision](../vision.md), [roadmap](../roadmap.md), [next-steps](../next-steps.md),
> [human-decisions](../human-decisions.md), [glossary](../glossary.md),
> [design principles](../../design/principles.md), the 2026-07-19 cleanup audit (executed and retired
> 2026-07-20; its lasting rulings live in
> [architecture/overview.md](../../architecture/overview.md#settled-shape-decisions)),
> the five [brainstorm lenses](../brainstorm/README.md), and the shipped code
> (`src/app/**`, `src/lib/**`, `src/db/schema.ts` — 33 tables).
>
> This is an assessment, not a commitment. Items that survive review move into
> [roadmap.md](../roadmap.md) with a milestone; hard-to-reverse choices become ADRs.

## The finding in one paragraph

DiveDay has **over-built the table stakes and under-built the differentiator.** The vision is explicit:
feature parity on the five pillars is *table stakes*; we win because staff **want** to open the app
([vision](../vision.md#the-bet)). Seven milestones later, the pillars are done — and then some: nitrox
fill logging, an automated marine outlook, Stripe Connect orders/invoices, a dive-site content
library with a global catalog, recurring trip series, a course catalog. Meanwhile the surfaces the
*vision itself* names as the win — the calm daily staff loop, the confidence-building diver arc — are
still sitting in `brainstorm/`. We built the parity we called table stakes and postponed the delight
we called the bet. The good news: the hard part is done. The connected data model is a genuine moat,
and most of what's missing is *surface* over data that already exists.

## What is actually built (the substrate is large)

The data model reaches further than the roadmap headline suggests — **33 tables**, one person-spine,
one readiness engine, multi-tenant to the core. Concretely shipped and working:

- **The safety brainstorm is essentially complete.** Nearly every idea in
  [safety-and-trust.md](../brainstorm/safety-and-trust.md) exists in code: the typed fail-closed
  readiness result ([`src/lib/readiness.ts`](../../../src/lib/readiness.ts)), no-silent-disappearance +
  two-phase roll call, an encrypted offline manifest snapshot with explicit freshness and idempotent
  reconciliation, immutable versioned waivers, verified-vs-claimed cert states, nitrox write-time
  gating, un-assignable out-of-service gear.
- **The booking spine is deep:** public sub-minute party booking, capacity-safe transactions,
  courses on the trip spine, recurring series, a durable waitlist, per-dive briefings.
- **Provider seams exist for every external capability** (payments, storage, notifications,
  signatures, cert-verification) behind a clean stub-first pattern — good architecture.

The engine room is well-built. That is exactly why the imbalance matters: the substrate is ready to
be turned into felt product, and it mostly hasn't been.

> **Update 2026-07-21:** the three "unbuilt limbs" below have since shipped — the staff blocker
> queue (`/shop/[shopSlug]/blockers`), one-screen check-in (`/trips/[id]/check-in`), and the
> no-login diver readiness page (`/ready/[token]`) all exist. The current state and the next work
> arc are assessed in [ux-audit-20260721.md](ux-audit-20260721.md); this section stands as the
> historical rationale.

## The core problem: the spine has no limbs

The single most-cited idea across all five brainstorm lenses is **one readiness engine, three
views** — the same result feeding the staff roster, the diver confirmation, and the manifest
([safety](../brainstorm/safety-and-trust.md) "one source, three views";
[staff-ops](../brainstorm/staff-operations-efficiency.md) readiness roll-up;
[diver](../brainstorm/diver-experience-and-growth.md) readiness page;
[platform](../brainstorm/platform-data-and-intelligence.md) generic core). **The engine is built. Two of
the three high-value views are not.** `readiness.ts` is consumed only *inside* two 1,000+-line pages
(`trips/[id]/page.tsx` — 1,278 lines; `divers/[personId]/page.tsx` — 1,132 lines). There is **no**
staff blocker queue, **no** one-screen check-in, and **no** no-login diver readiness page (verified:
no `check-in`, `blocker`, `ready`, or `today` route exists under `src/app/shop/[shopSlug]/`).

This is the crux. The front desk's *entire job* is coordination — who's coming, who's ready, who to
call ([staff-ops](../brainstorm/staff-operations-efficiency.md)). We have the data to answer that in one
glance and we make staff assemble the answer by hand across a 1,300-line trip page. We built the
brain and skipped the face.

## What we're missing or not solving effectively

Ranked by leverage against the north star (less staff coordination · more diver confidence · safer
departure):

1. **The staff blocker queue with one-tap actions** — the front desk's whole day as one actionable
   list. Unbuilt. ([staff-ops](../brainstorm/staff-operations-efficiency.md) #1.)
2. **One-screen check-in** ("ready to board" at a glance, one tap to board) — the daily-throughput
   surface where safety and efficiency converge. Unbuilt.
3. **The no-login diver readiness page** — the diver-side mirror of the blocker queue; the thing that
   kills the "did you get my waiver?" call and raises confidence. Unbuilt.
   ([diver](../brainstorm/diver-experience-and-growth.md) #1.)
4. **Notifications don't actually send in a default deployment.** The Resend seam is real but resolves
   to a disabled stub without `RESEND_API_KEY`; policy (H-09) is unowned. So "chasing missing
   waivers" is still manual, one-tap nudges are hollow, and the waitlist recovers **zero** revenue
   (no auto-notify on cancellation). This quietly undercuts the blocker queue's value — an action
   list whose actions can't reach the diver is half a feature.
5. **The manifest — the safety differentiator — has never been field-tested** (V-02 open). The one
   surface the vision stakes trust on has not met a wet phone in glare. Automated Playbook coverage
   is not the outdoor sign-off.
6. **Finding a diver or trip is navigation, not search.** No command palette, no global search — a
   daily task made slow.
7. **The cheap delight wins are unspent:** per-pillar earned moments, confirmations that state *what's
   next*, forgiving inputs (email-typo/autocomplete), undo-over-confirm, an empty-state/microcopy
   pass, per-role landing + saved views. These are mostly S-effort over existing data and are the
   literal definition of "staff want to open it." ([delight](../brainstorm/delight-and-experience.md).)
8. **DAN / dive-insurance field** — glossary calls it "worth a field"; not captured. Small gap, real.

## What we're adding that isn't solving a problem (the cut list)

Surface that carries maintenance, review, and cognitive cost without moving the north star. Each
should be retired, gated, or paused — not extended:

- **A dive-site content CMS.** `dive_site_moments` (a moderated diver **photo feed**) and
  `dive_site_creatures` (marine-life field cards) are community/content-app features orthogonal to
  running a dive day — and they flirt with the explicit *"not a dive-log social network"* non-goal
  ([vision](../vision.md#non-goals-for-now)). Plus `dive-site-landmarks.ts` / `dive-site-map.ts` are
  **hardcoded, keyed by literal site name** ("Molasses Reef") — demo dressing that doesn't scale past
  the seed shop.
- **The global dive-site catalog + immutable version snapshots** (`global_dive_sites`,
  `global_dive_site_versions`, `source_template_version`) — heavy provenance machinery for a
  DiveDay-maintained catalog whose real inventory is the hardcoded content above.
- ~~**Two parallel payment paths.**~~ ✅ **Done (2026-07-20).** The superseded Stripe **Checkout**
  seam (`src/lib/payments/index.ts`) was removed; the Connect + invoicing order flow the UI actually
  uses is the single payment path.
- ~~**The cert-verification agency-gateway plumbing**~~ ✅ **Removed (2026-07-21).** No agency
  exposed such an API ([H-10](../human-decisions.md)), so the per-agency PADI/SSI/NAUI plumbing always
  resolved to the stub. The whole seam was removed in favour of manual staff certification (staff
  look the number up and click Mark certified) — see
  [20260721-manual-certification](../../architecture/decisions/20260721-manual-certification.md). The
  original note read: keep the interface, shed the per-agency machinery until an
  API is real.
- **Nitrox's disproportionate footprint** — 🔁 **Trimmed (2026-07-20).** The standalone shop-wide
  fill-log page and its dedicated nav slot were removed; fills are now logged per departure at
  `/trips/[id]/nitrox`. The safety-critical parts (verified-card fill gate, readiness blockers, the
  math lib, the two tables) were **kept intact** — the cut was surface, not the workflow. Deeper
  reduction still waits on the H-11 policy decision.
- ~~**Navigation debris.**~~ ✅ **Done (2026-07-20).** The `shop/page.tsx` alias, the `reports`
  duplicate page, and the `certifications`/`orders` bookmark shims were all deleted (no redirects —
  there are no users to keep bookmarks for), the four flash/notice mechanisms were unified on
  `ShopNotice`, and "Shop" now means one thing ("Settings" → `/settings/payments`).
- **A `recurrence` enum with a single `weekly` value** — additive hedging for cadences that don't
  exist yet.

Common thread: much of this is **built ahead of the human decisions needed to run it.** Nitrox
(H-11), courses (H-08), payment policy (H-07), notifications (H-09), and waiver legal (H-01–03) are
all *provisional* and unapproved ([provisional defaults](../human-decisions.md#provisional-implementation-defaults--verify-before-production)). A large slice of
shipped surface **cannot go to production** as-is — and in a default deploy with no keys, no email
sends, no image stores, no payment processes. We are polishing rooms in a house that has no plumbing
connected.

## The staff app is also confusing to use

✅ **Addressed 2026-07-20.** What existed had accreted structural confusion — the exact "hostile,
forms-that-fight-you" quality the vision mocks in competitors: a redirect hop between the two trip
detail surfaces, four notice mechanisms, copy-pasted button strings, a trial/demo identity bug (a
real trial shop got a "Reset demo data" button), and marketing that claimed tracked real screenshots
which never existed. The 2026-07-19 cleanup audit catalogued all of it and its work packages shipped
in full. This was never a separate workstream from delight — it *is* the delight work, and the staff
shell no longer contradicts itself. The durable "don't undo this" rulings live in
[architecture/overview.md](../../architecture/overview.md#settled-shape-decisions).

## Recommendation: three moves, in order

The strategy is a pivot from **breadth to depth**: stop adding pillars, start converting the
substrate into felt product, and cut the surface that isn't earning its keep.

### Move 1 — Simplify (weeks, low risk, do first)

Shrink the surface so every later change is cheaper and the app stops contradicting itself.

- ✅ **The 2026-07-19 cleanup audit shipped in full (2026-07-20)** and its plan document has been
  retired: navigation unification, one notice system, `reports` and `shop` cut, the trial/demo split
  fixed, marketing made honest, `db/queries.ts` split, a shared db/e2e test context, and the
  server-action convention documented.
- Act on the cut list above: ✅ the superseded Checkout seam was removed and nitrox's footprint was
  trimmed (2026-07-20); ✅ the cert-verification agency plumbing was removed for manual certification
  (2026-07-21). Still open: pause/hide the dive-site CMS (moments/creatures) and global catalog
  behind their unproven value.
- ✅ The oversized pages are decomposed (2026-07-20): `trips/[id]` 1,296 → 277 lines,
  `divers/[personId]` 1,140 → 64, `schedule/[id]` 719 → 167, `gear` 526 → 84 — each now an
  `actions.ts` plus colocated `_components/`. New readiness surfaces no longer fight 1,300-line
  files.

Outcome: less to maintain, less to confuse, a clean base to build delight on.

### Move 2 — Convert the spine into surfaces (the actual differentiator)

Build the limbs the readiness engine is waiting for. All three sit on data that already exists, so
this is surface work, not new domain machinery:

1. **Staff blocker queue** — every departure-blocking item across upcoming trips as one list, each
   with a one-tap action. Reuses `readiness.ts` verbatim.
2. **One-screen check-in** — per diver: waiver ✓ / cert ✓ / gear / medical on one card, one tap to
   board; big targets, fast next-diver.
3. **No-login diver readiness page** — a secure link showing the diver exactly what's done and what's
   left, in plain language. The diver-side mirror of #1.

Then spend the cheap delight budget across shipped surfaces: earned moments, "what's next"
confirmations, forgiving inputs, undo-over-confirm, an empty-state + microcopy pass, per-role landing,
command palette + global search. These are the S/M items that make the app one staff *want* to open.

Outcome: the moat becomes visible. This is where "win on experience" is actually won.

### Move 3 — Make what's built real (de-risk to production)

Delight over a product that can't operate is theater. In parallel with Move 2:

- **Field-validate the manifest (V-02)** on a phone, outdoors, wet hands, airplane-mode. Until this
  passes, the safety differentiator is unproven and unclaimable.
- **Make notifications actually send** — close H-09, wire a real provider — so the blocker queue's
  one-tap nudges and waitlist auto-notify are real, not stubs. This is the multiplier that makes
  Move 2 pay off.
- **Pick and finish one monetization path** (the Connect/invoicing flow), retire the other, and close
  the H-07 policy gaps enough to take a real deposit.
- Drive the open [human decisions](../human-decisions.md) for anything presented as shippable. Don't
  present provisional-policy surfaces (nitrox, courses) as done until their H-row is Chosen.

## Sequenced queue

**P0 — simplify and unblock**
1. Cleanup plan Track 0 (docs/dead-code/notice-system), then Tracks 1–2 (nav + public-site unification).
2. Cut list: ✅ superseded Checkout seam removed and nitrox footprint trimmed (2026-07-20); still
   to do — pause the dive-site CMS + global catalog.
3. Decompose the two monster pages (WP-3.3).

**P1 — the differentiator**
4. Staff blocker queue on the existing readiness engine.
5. One-screen check-in.
6. No-login diver readiness page.
7. Real notifications (H-09 + provider) → one-tap nudges + waitlist auto-notify.
8. Delight pass: earned moments, "what's next" confirmations, forgiving inputs, undo, microcopy,
   per-role landing.

**P2 — de-risk and prove**
9. V-02 manifest field validation.
10. Finish one payment path; close H-07 deposit policy.
11. Command palette + global search.
12. Owner dashboard / readiness analytics from real data (once instrumentation exists).

## What NOT to do

- **Don't add a sixth pillar or a new integration** before Moves 1–2 land. Breadth is not the problem.
- **Don't build the heavy agent-platform machinery** (sharded docs, task manifests, module-folder
  reorg) before a real collision demands it — the brainstorm itself parks these ("earn it first").
- **Don't extend the dive-site CMS** or lean further into content/community features — it drifts
  toward the social-network non-goal.
- **Don't fork the person/trip spine** for any feature's convenience — the connectedness is the moat.
- **Don't present provisional-policy surfaces as production-ready** while their human decision is open.

## How we'll know it worked

The [next-steps measures](../next-steps.md#measures) become checkable once Move 2 + real notifications
land: median time to resolve a booking blocker, waiver completion rate before arrival, % of
departures fully ready before trip day. The qualitative bar from the vision is the real test — *staff
run the whole day from it, unprompted, and a diver compliments the booking flow.* We are not there
yet, not because a pillar is missing, but because the daily loop that earns that sentence hasn't been
built. Build it next.
