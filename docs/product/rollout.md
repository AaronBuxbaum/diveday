# Rollout plan — from working product to paying shops

The 0→1 go-to-market plan: the phases, the gates that must clear before each one, who has to be
talked to, and the concrete channels and examples to use. Written 2026-07-24 against the shipped
state in [shipped.md](shipped.md). This is a **living plan owned by the product owner**; when a
phase completes or a gate clears, update this doc and [human-decisions.md](human-decisions.md) in
the same change.

Companions: [vision.md](vision.md) (what winning looks like),
[competitive-analysis.md](assessments/competitive-analysis.md) and
[competitive-strategy.md](assessments/competitive-strategy.md) (who we're up against and the
portability wedge), [marketing.md](marketing.md) (the public-page rulebook and claims policy),
[human-decisions.md](human-decisions.md) (the gate register this plan sequences).

## Where we stand

The product is feature-complete across the five pillars plus payments, notifications, owner
reporting, and the first two legs of the data-portability wedge (export, importer, migration
guides). **Nothing that blocks rollout is code.** What blocks rollout is:

1. **Legal reality** — waiver text, medical questions, e-signature sufficiency, and retention are
   provisional baselines awaiting counsel (H-01–H-03, V-03).
2. **Operational reality** — no named owner for secrets/backups/incidents (H-04), no live Stripe
   Connect platform application (H-07), no verified sender/consent policy (H-09), and the offline
   manifest is field-unproven (V-02).
3. **Commercial reality** — the $99 founding-shop price is approved for now (H-12, 2026-07-24;
   early-access, with billing/tax/support/contract terms still open), and no real shop has
   run a real dive day on the product (V-04).

The rollout is therefore sequenced as four phases, each with explicit entry/exit criteria. Do not
skip ahead: marketing that leans on an unproven safety claim, or a waiver flow without counsel
sign-off, converts our best differentiators into liabilities.

| Phase | What | Target window | Exit criterion |
| --- | --- | --- | --- |
| 0 — Get real | Legal, ops ownership, live credentials, field validation | now → ~6 weeks (early Sept 2026) | All launch-blocking gates cleared or consciously deferred |
| 1 — Design partners | 2–3 shops, free, concierge, weekly contact | Sept–Oct 2026 (in-season for real trips) | One shop runs whole dive days in DiveDay unprompted for 2+ consecutive weeks |
| 2 — Founding shops | Paid early access, capped cohort, switching funnel | Oct 2026 → DEMA (November) | 10–25 paying shops; first-month retention ≥ 90%; one public case study |
| 3 — Public launch | Self-serve, DEMA presence, press, review sites | Nov 2026 onward | Steady inbound signups without founder outreach |

## Phase 0 — get legally and operationally real (now → early Sept)

Everything here is a human conversation or an account setup, keyed to the
[decision register](human-decisions.md#decision-register). Work these in parallel; the critical
path is legal review (longest lead time) and the V-02 field test (needs a boat day).

### 0.1 Legal and policy (H-01, H-02, H-03, V-03) — start immediately, longest lead

- **Pick one operating jurisdiction and launch there only.** Recommendation: one US state with a
  dense shop population — Florida is the obvious first pick (the largest concentration of US dive
  operators and charter boats; year-round season). Every waiver/medical/retention question gets
  dramatically simpler with a single jurisdiction; expand jurisdiction-by-jurisdiction later.
- **Retain a recreational-liability attorney with scuba release experience.** Do not use a
  generalist. Ways to find one: DAN's (Divers Alert Network) risk-mitigation program maintains
  legal resources and can refer; the dive-industry insurance brokers (in the US, the
  PADI-endorsed broker historically Vicencia & Buckley / HUB International) work with these
  attorneys daily and will name names; DEMA membership includes access to business/legal resources.
  Deliverables to request, in one engagement: approved waiver template + medical questionnaire for
  the chosen jurisdiction (H-01), a retention/deletion policy for waivers and medical flags (H-02),
  and a written opinion on whether typed-name + consent + timestamp suffices or a specialist
  e-signature provider is required (H-03). Budget expectation: this is a review of existing
  artifacts, not drafting from scratch — the provisional baselines in
  [human-decisions.md](human-decisions.md#provisional-implementation-defaults--verify-before-production)
  exist precisely to make this a short engagement.
- **Insurance conversation (same weeks):** pilot shops will ask whether using DiveDay affects
  their liability coverage. Have the answer ready: talk to at least one shop-side insurance broker
  (the shop's own broker, or the agency-endorsed ones above) about whether digitally signed
  releases and our evidence model (immutable versioned templates, typed consent, timestamps,
  append-only roll-call ledger) meet their underwriting expectations. A one-page "what your
  insurer will ask, and our answers" doc is a sales asset, not just diligence.

### 0.2 Operational ownership (H-04, H-09 credentials, H-07 credentials)

Name a single accountable human (realistically the founder at this stage — the point is writing
it down) for each of:

- Production secrets, Neon backups, domain, and incident response (H-04). Record the backup
  cadence and a restore rehearsal date. **Do the restore rehearsal once before the first pilot** —
  a backup that has never been restored is a hope, not a backup.
- **Stripe:** submit the live Stripe Connect platform application (`STRIPE_CONNECT_CLIENT_ID`) and
  configure the production webhook secret. Stripe reviews platform applications; start now so
  approval isn't the pilot's blocker. Decide the platform-fee posture as part of H-12 (recommend:
  **no platform fee at launch** — "the shop keeps its own Stripe account and its own money" is a
  trust argument against FareHarbor-style 6%-of-volume platforms).
- **Resend:** verify the production sending domain, set `RESEND_FROM_EMAIL` on a real shop-facing
  identity (e.g. `bookings@…`), and write the two-paragraph consent/copy policy H-09 asks for
  (transactional-only today; reminders are courtesy; no marketing sends without explicit opt-in).
- **Twilio:** register the SMS sender (US A2P 10DLC registration takes days-to-weeks — start
  early), and name the `CRON_SECRET`/`TWILIO_*` owner.

### 0.3 Field validation (V-01, V-02, V-04 rehearsal)

- **V-02 is the single most important pre-pilot task.** The offline manifest is differentiator #2
  and it is unproven. Get on a boat — a friendly local charter or the first design-partner
  candidate — and run the full script in
  [human-decisions.md](human-decisions.md#human-verification-queue): glare, wet hands,
  airplane-mode reload, multi-checkpoint roll call, conflict reconciliation, print fallback.
  Record everything. **Until V-02 passes, no marketing claim about offline roll call** (per the
  [claims policy](marketing.md)); the feature ships, the claim waits.
- V-01 (browser pass) and a V-04 dry run (seed a fictional but realistic week and rehearse
  check-in → prep → roll call end-to-end yourself) are the cheap rehearsals that make the first
  real pilot day boring.

### 0.4 Commercial decisions (H-12, H-13)

- **Pricing: recommend the meet-the-market posture and close H-12.** Land on **$99 flat per
  location / month, everything included, no setup fee, no per-seat math, no platform fee, cancel
  anytime with the export button** — exactly where `src/lib/marketing.ts` already sits, now made
  official. Rationale is already argued in
  [competitive-analysis.md](assessments/competitive-analysis.md#pricing-posture): DiveAdmin tops
  out at $119, DiveShop360 starts at ~$149–199 *plus* $1,000–3,000 setup, and "no add-ons, no
  lock-in" only works as a headline if the number is unsurprising. Add a founding-shop sweetener
  that costs nothing now: **price locked for two years for the founding cohort.** Define the
  support promise as part of the same decision (recommend: founder-direct support, same-day
  response, for the founding cohort — it's honest, differentiating, and matches a capped cohort).
- **H-13 (email-identity reuse) needs a ruling before a real shop's data is live.** The
  domain-expert review flagged silent person-reuse on shared inboxes as unsafe; decide the
  safeguard (the light "is this you?" confirmation is the smallest honest fix) or explicitly
  accept the risk in writing. This is exactly the kind of thing a pilot shop will hit with a
  parent-and-teenager booking.

**Phase 0 exit:** H-01–H-04, H-07 (credentials + fee posture), H-09 (sender + consent), H-12, and
H-13 rows read Chosen/Implemented; V-01 recorded; V-02 recorded with sign-off (or a written
decision to pilot with print-backup-only and no offline claims).

## Phase 1 — design partners (Sept–Oct 2026)

Two to three shops, free, high-touch. The goal is not revenue; it is (a) proof the product runs a
real dive day, (b) the reference story Phase 2 sells with, and (c) the punch list only real
operations surface.

### Who to recruit — three deliberate profiles

1. **A boat-charter-heavy shop** (daily two-tank trips) — stresses manifests, roll call, prep, and
   the Today queue. This is where the safety spine either earns its keep or gets found out.
2. **A course-heavy shop** (steady Open Water pipeline) — stresses the course catalog, sessions,
   instructor staffing, and waiver/medical flow on students.
3. **An EVE or DiveShop360 defector** — stresses the importer and migration guides on real
   incumbent exports, and becomes the "Switching from EVE" case study. The EVE pool is the
   [freshest switching pool in the market](assessments/competitive-strategy.md#diveshop360--the-pe-owned-pos-incumbent)
   — these shops must migrate somewhere regardless.

### Where to find them, concretely

- **Warm/local first:** shops the founder already dives with; every certified diver knows three
  shop owners. A pilot needs trust more than reach.
- **ScubaBoard** — the "dive shop software" threads (the same ones our competitive research mined
  for EVE complaints) are literally shop owners describing their pain; respond to named problems,
  don't broadcast.
- **Facebook dive-industry groups** — shop-owner and dive-professional groups (e.g. the various
  "Dive Shop Owners" / "Scuba Instructors" groups) are where this demographic actually talks shop.
- **Scubanomics / Business of Diving Institute** (Darcy Kieran's newsletter and LinkedIn
  community) — the one publication squarely aimed at dive-shop economics; a guest piece or
  sponsorship reaches exactly the buyer.
- **Local directories as a call list:** the PADI and SSI shop locators for the chosen launch
  region give a complete, public list of every shop to visit in person. In-person beats email for
  a 0-reputation product; bring a phone, run the demo shop from the dock.

### The offer (write it down, say it the same way every time)

Free through the pilot, founder-run concierge migration (they send exports; we import — never
log into their incumbent system, per the
[legal guardrail](assessments/competitive-strategy.md#the-portability-wedge)), weekly 30-minute
call, a shared WhatsApp/SMS thread with the founder, and the founding-shop price + two-year lock
when the pilot converts. In exchange: they run real days on it, they let us watch, and (if it
goes well) a named quote/case study.

### How the pilot runs

- Week 0: concierge import (this is also the importer's real-data test), staff accounts, one
  training session with front desk + a captain; run V-04's rehearsal checklist against their real
  upcoming week.
- Weeks 1–4: they run real trips. The founder is present (physically if local) for the first boat
  day — that day is also V-02 evidence if not already recorded. Track the
  [metrics](#metrics--the-scoreboard) weekly; triage the punch list into the roadmap.
- The one rule: **never let a pilot shop discover a safety gap silently.** Any manifest/readiness
  defect found in the field is a stop-the-line fix per AGENTS.md safety-critical rules.

**Phase 1 exit (the [vision success signal](vision.md#success-signal), operationalized):** at
least one shop runs its complete dive days — bookings through roll call — in DiveDay unprompted
for two consecutive weeks; at least one diver-side compliment on the booking/ready flow; zero
open safety-severity defects; a written case study draft with the shop's numbers.

## Phase 2 — founding shops (Oct 2026 → DEMA)

Convert the pilot into a capped paid cohort. Cap it deliberately — **25 shops** — because support
is founder-direct and scarcity is honest ("founding cohort" means something when it's actually
bounded).

- **Turn on the switching funnel.** The `/switching` guides are live SEO surfaces; now feed them:
  the EVE case study as a linked story, and modest paid search on high-intent queries ("EVE dive
  shop software replacement", "DiveShop360 alternative") pointed at the guides — the documented
  Jane/anti-Mindbody pattern. Track guide → trial conversion via the existing analytics seam.
- **Direct outreach to the EVE pool:** the migration is forced; the pitch is concierge import +
  the honesty table + "leave anytime" export. Ten personal emails a week from the founder to
  shops in the launch region beats any campaign at this scale.
- **Ship the remaining wedge before shouting about openness** (per the standing rule: no pledge
  pages before the button works): scheduled backup export to shop-owned storage, then the read
  API + webhooks (ADR first) — both already sequenced in [roadmap.md](roadmap.md). "Openness"
  marketing stays scoped to what's live: export, importer, guides.
- **Plant the review-site flags now:** claim/create the Capterra listing (DiveAdmin's sits at 0
  reviews — the first product in this niche with even five real reviews wins the comparison page
  by default) and ask each happy founding shop for one review at their day-30 check-in.
- **Referral loop is already built:** the post-trip recap's bring-a-buddy nudge markets to divers;
  add a shop-to-shop founding referral (a free month both sides) — dive shop owners all know each
  other regionally.

**Phase 2 exit:** 10–25 paying shops, ≥90% month-1 logo retention, one published case study, and
support load per shop measured and sustainable (else the cap holds until it is).

## Phase 3 — public launch (November 2026 onward)

- **DEMA Show (the industry's annual November trade show)** is the natural coming-out moment:
  the entire buyer demographic in one hall, right in the off-season switching window. Decide by
  early September (booth economics vs. walking the floor with scheduled meetings — for a
  one-founder company, pre-booked meetings + an evening event for founding shops likely beats a
  booth). Join DEMA as a member regardless for the retailer research and legitimacy.
- **Seasonality is the strategy, not a footnote:** northern-hemisphere shops will not switch
  systems mid-peak-season. The Oct–Mar off-season is when a Florida/Caribbean-adjacent shop
  retools — which is exactly when Phases 2–3 land. Expansion outreach re-intensifies each fall.
- **Dive-media PR, in order of fit:** Divernet (already covered the EVE acquisition — the
  "what happens to EVE users now" angle is theirs), DeeperBlue.com, Scuba Diving magazine's gear
  and industry coverage, X-Ray Mag, and Scubanomics for the business-of-diving angle. The story
  is not "new software"; it is "the safety-first dive-ops system that lets you leave" — the
  roll-call-on-a-wet-phone demo is the visual.
- **Open the funnel fully:** self-serve trial (already built — the demo/trial shop split exists),
  pricing public and final, founding cohort closes, standard price honors the meet-the-market
  posture.
- **What we still don't do** (repeating [what NOT to do](assessments/competitive-strategy.md#what-not-to-do)
  because launch pressure will test it): no POS fight, no PADI-sync promises, no price war with a
  three-person studio, no openness claims ahead of shipped artifacts.

## Who needs to be talked to — stakeholder register

| Who | Why | When | Owner gate |
| --- | --- | --- | --- |
| Recreational-liability attorney (scuba experience, launch jurisdiction) | Waiver/medical/retention/e-sign sufficiency | Phase 0, first call this week — longest lead | H-01–H-03, V-03 |
| Dive-industry insurance broker (e.g. the agency-endorsed brokers; DAN risk-mitigation as referrer) | "Does DiveDay satisfy underwriting?" answer for shops | Phase 0 | Sales asset |
| Stripe (Connect platform review) | Live platform application + webhooks | Phase 0, submit immediately | H-07 |
| Twilio (A2P 10DLC registration) | Legal SMS sending in the US | Phase 0, submit immediately | H-09 |
| Dive operations lead + a friendly charter captain | V-02 field test on a real boat | Phase 0/first pilot boat day | V-02, H-05, H-06, H-11 |
| 2–3 design-partner shop owners (profiles above) | Pilot | Recruit now, run Phase 1 | V-04 |
| Pilot shops' front-desk staff and captains | The actual daily users; training + feedback | Phase 1 week 0 | — |
| DEMA (membership, show logistics) | November presence + retailer data | Decide by early Sept | Phase 3 |
| Darcy Kieran / Scubanomics; dive-media editors (Divernet, DeeperBlue) | The two channels that reach shop owners | Phase 2–3, warm up early with useful content, not pitches | Phase 3 |
| Founding-shop references | Reviews (Capterra), case studies, referrals | Phase 2, day-30 check-ins | Phase 2 exit |

## Metrics — the scoreboard

North star: **dive days run end-to-end in DiveDay per week** (a day counts when the trip had
bookings, readiness cleared divers, and a roll-call checkpoint was recorded). Everything else
serves it.

- **Activation (per shop):** time from signup → first real trip scheduled → first public booking
  → first pre-arrival signed waiver → first roll call. Concierge target: first real booking
  within 7 days of import.
- **Retention:** weekly active shop-days; month-1 and month-3 logo retention (≥90% / ≥80%
  targets for the founding cohort). Retention over feature count, per the vision.
- **Funnel:** `/switching` guide visits → trial shops created → pilot/founding conversions
  (instrumented via the existing `src/lib/analytics.ts` seam).
- **Quality:** open safety-severity defects (must be zero to exit any phase); support hours per
  shop per week (caps the cohort).

## Risks and pre-decided responses

- **V-02 fails on the boat** → pilot proceeds with live manifest + print backup; offline claims
  stay off all surfaces (claims policy already enforces this); fix and re-test before Phase 2.
- **Legal review demands a specialist e-signature provider (H-03)** → the `SignatureProvider`
  seam exists for exactly this; it becomes the one Phase-0 engineering task. Budget it, don't
  debate it.
- **Support load exceeds one founder** → the 25-shop cap holds; raising it is a deliberate
  decision, not drift.
- **DiveAdmin copies the messaging within months** (expected, per the competitive doc) → the
  moat is shipped artifacts and the founding cohort's stories, not copy; keep moving the proof.
- **A pilot shop churns loudly** → the export button is the answer working as designed: they
  leave with everything, and we say so publicly. The wedge is only credible if departures are
  graceful.
- **Seasonal mistiming** (slipping Phase 1 past October) → pilots move to year-round markets
  (Florida/Caribbean) rather than waiting for spring.

## The next 30 days, in order

1. Book the attorney (H-01–H-03) and submit Stripe Connect + Twilio A2P applications — the three
   long-lead clocks start today.
2. Name the ops owner, enable and **rehearse** a Neon backup restore (H-04).
3. Verify the Resend production sender and write the H-09 consent policy.
4. Close H-12 at $99/location/month with the two-year founding lock and the founder-direct
   support promise; close H-13 with the "is this you?" safeguard or a written acceptance.
5. Run V-01 and the V-04 rehearsal on the demo shop; script the V-02 boat day.
6. Draft the design-partner one-pager (the offer above) and open conversations with five shops
   across the three profiles; get one boat day scheduled — it doubles as V-02.
7. Decide DEMA posture (meetings vs. booth) and join DEMA.

## Review cadence

Revisit at each phase boundary, whenever a gate row in
[human-decisions.md](human-decisions.md) changes state, and immediately if either named rival
ships a direct response (per the re-check rule in
[competitive-strategy.md](assessments/competitive-strategy.md#implications-for-the-queue)).
