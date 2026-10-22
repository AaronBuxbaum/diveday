# DiveDay UX and delight audit

**2026-10-21 · audit baseline `f3bfde4604ea0090eba3143986f01001dbaefab0`**

The observations and images below describe that baseline. Delivery status was reconciled on
2026-10-21 (America/New_York); it does not turn the original evidence into a test of later changes.
Search/draft continuity and operational safety fixes have merged; their delivery is recorded in
[Shipped](../../shipped.md#ux-audit-continuity-and-operational-trust-merged-2026-10-21).
Visual PR [#2910](https://github.com/AaronBuxbaum/diveday/pull/2910) is open and unmerged. Manual
Settings work and UX groups A–D are prepared for serial publication, not merged or deployed. The
nine UX issues [#2858–#2866](opportunities.md#approved-publication-groups) are approved work.

DiveDay's biggest opportunity is making an already coherent product dependable through the
interruptions of a real dive shop. The visual language, day-oriented navigation, contextual
preparation and restrained moments of recognition are strong. The baseline exposed gaps in search
and interrupted drafts that have since merged fixes. The remaining approved work closes operational
handoffs, completes contextual retrieval and makes displayed numbers reconcile.

A broad visual redesign would spend effort away from the most consequential gaps. The product needs
fewer dead ends and more reliable continuity, followed by targeted improvements to finding,
recovering and confirming work.

## Read this report

| Document | What it contains |
| --- | --- |
| [Findings](findings.md) | Ten defects or standards violations, evidence, priority, source anchors and acceptance scenarios |
| [Opportunities](opportunities.md) | Six approved opportunities, publication groups, baseline backlog context and research questions |
| [Journey assessment](journeys.md) | What works and what needs attention across the product's main jobs |
| [Coverage and limits](coverage.md) | Route inventory, browser scenarios, accessibility checks, reviewer scope and untested conditions |
| [Evidence](evidence/README.md) | Selected screenshots and how to interpret them |

This audit inventories all **110 page routes** and reviews shared components, product rules,
relevant domain behavior, tests and the existing backlog. It does **not** claim that every branch of
every route was exercised. Targeted browser coverage and source-only conclusions are marked
separately. The audit used synthetic local data, not a production shop.

The requested eight-hour window included an interruption and quota-limited reviewer attempts;
elapsed wall time is not presented as eight hours of continuous hands-on testing. Work resumed when
requested, and all four specialist review passes subsequently completed.

## Current publication focus

The nine approved UX issues are grouped in
[opportunities](opportunities.md#approved-publication-groups): A covers staff discovery and exact
tip display; B covers course-request and pending-move continuity; C covers the setup receipt; D
covers cart-local rental lookup and refusal recovery. These groups have prepared source work.
Publication and integrated verification remain outstanding; this audit's captures do not validate
them. Manual Settings and the unmerged visual layer precede A.

The previously recommended search/draft continuity and offline capacity, boat-history and buddy
fixes are recorded in
[Shipped](../../shipped.md#ux-audit-continuity-and-operational-trust-merged-2026-10-21). Do not plan
those merged slices from this historical audit. Merge does not establish production deployment.
Other issue references below retain their baseline context unless expressly refreshed.

## Baseline findings at a glance

P1 means a core interaction can lose work or mislead selection. P2 means a material contextual
answer or output is wrong/incomplete. P3 means a narrower trust or presentation defect. These
priorities are product judgments, not measured incident rates.

| ID | Priority | Finding | Evidence | Tracker / reconciliation |
| --- | --- | --- | --- | --- |
| UX-01 | P1 | Failed search leaves Add diver as the highlighted outcome | Browser fault injection + source | [#2857](https://github.com/AaronBuxbaum/diveday/issues/2857); resolved in [#2873](https://github.com/AaronBuxbaum/diveday/pull/2873) |
| UX-02 | P1 | Enter can open a result from the previous query | Browser delayed response + source | [#2855](https://github.com/AaronBuxbaum/diveday/issues/2855); resolved in [#2873](https://github.com/AaronBuxbaum/diveday/pull/2873) |
| UX-03 | P1 | Immediate navigation loses a new form draft | Browser reproduction with positive control | [#2856](https://github.com/AaronBuxbaum/diveday/issues/2856); resolved in [#2873](https://github.com/AaronBuxbaum/diveday/pull/2873) |
| UX-04 | P2 | Failed Start over can leave draft saving disabled | Source failure-path review | Unfiled at audit snapshot; current state unknown |
| UX-05 | P2 | Diver-record booking filters only the first 50 departures | Source bounded-query review | [#2859](https://github.com/AaronBuxbaum/diveday/issues/2859) |
| UX-06 | P2 | Recently collected repairs use intake ordering | Source query review | Unfiled at audit snapshot; current state unknown |
| UX-07 | P2 | Course date request disappears without shop email | Source capability-gate review | [#2860](https://github.com/AaronBuxbaum/diveday/issues/2860) |
| UX-08 | P2 | Displayed crew tip shares do not add to the pool | Rendered demo + source | [#2858](https://github.com/AaronBuxbaum/diveday/issues/2858) |
| UX-09 | P3 | Global error claims telemetry delivery before it is known | Source failure-path review | Unfiled at audit snapshot; current state unknown |
| UX-10 | P3 | Report decision amounts/statuses render below the dock text standard | Browser computed style + source | Unfiled at audit snapshot; current state unknown |

Six defects were filed at the baseline; UX-01–03 are retained here as dated reproduction evidence
with their resolution link. Their implementation recommendations have been removed from
[findings](findings.md). UX-05/07/08 belong to approved groups A/B and are prepared, not delivered.
UX-04/06/09/10 were unfiled at the then-40-ticket inbox ceiling. Their current implementation and
tracker state were not established by this reconciliation; their baseline briefs are not a verified
current backlog. No new issue was filed for them here. The six opportunities are approved work,
although their original issue labels may still say `idea`.

## Preserve the strengths

**The staff workspace starts with the day.** Today, Schedule, Divers and Inbox are understandable
operational destinations. Role-aware navigation removes actions someone cannot perform. The manifest
and preparation pages organize around the departure, which matches the crew's task.

**The diver journey has a useful next step.** The local booking journey led directly to a readiness
page with arrival information, the next paperwork step, payment expectations and shop contact. The
waiver has a clear release → medical → signature progression. No medical answer was preselected.
Cancellation confirmed the consequence and returned an understandable terminal state with a way back
to upcoming departures.

**The product already has substantial depth.** Prepaid packages, counter rentals, gear search by
tag/serial/brand, repair history on the diver record, returning-diver recognition, postcard sharing
and export are present. They should not be re-proposed as missing features. Some of the best
opportunities are shorter paths into capabilities already built.

**Safety state is deliberately more conservative than visual state.** A signed waiver is not a
medical clearance. A booking is not boarding permission. A local queued mark is not a confirmed
server outcome. A stored offline page cannot know about a later cancellation. These distinctions are
part of a trustworthy experience, even where they add a step.

**Delight is restrained and contextual.** Recognition after booking and earned completion moments
fit the product. An unfinished waiver, unresolved request or financial discrepancy does not need
celebration. The audit does not recommend more confetti, generic gamification, standing praise or
additional dashboard widgets.

## What “cleaner” should mean here

Clean up the user's work before cleaning up the visual surface. A reliable draft is less clutter in
the staffer's head. A clear pending request removes a follow-up phone call. A complete search result
avoids another record. Exact shares remove a spreadsheet reconciliation.

Keep the existing primitives and page grammar. Target places where the representation loses meaning:
raw device strings, capped lists with no continuation, an outage that looks like absence, and
success wording that outruns persistence. The detailed opportunities identify local seams; this
report does not justify a whole-app architecture rewrite.

The documentation also needs selective reconciliation. Older persona and roadmap assumptions about
hard-coded USD and the absence of a boat entity no longer describe the current code. Review those
statements when planning work so the next audit does not spend its effort rediscovering shipped
functionality. Dated assessments should remain clearly dated rather than silently becoming new
product truth.

## How to decide whether the next work helped

Use small, representative task observations before setting numeric targets. The audit establishes
reproduction evidence, not a baseline conversion rate or a measured time saving.

| Job | Observable success |
| --- | --- |
| Find a diver during a slow connection | The selected record always belongs to the current query; an outage offers recovery |
| Answer a phone interruption while adding a diver | Returning restores the latest allowed draft without mixing shops or people |
| Resolve a date/move request | Both sides can identify what is pending, who acts next and whether anything changed |
| Prepare a boat after a late change | Hull, people count, crew, buddy state and offline freshness agree or clearly warn |
| Close a month | Visible crew allocations reconcile with the exact pool and export |
| Select rental gear | A staffer finds a known tag or size without abandoning the cart or losing selections |
| Get ready for a first dive | The diver finds arrival instructions, understands what remains and never mistakes signed for cleared |

A pilot should include a busy desk worker, a captain using an actual phone, a first-time diver, a
returning diver and an owner/bookkeeper. Include interruptions, slow/offline transitions, long
names, a large fleet and Spanish. Test in glare and with real assistive technology; desktop browser
emulation cannot validate wet-finger use, iOS feedback or screen-reader comprehension.

## Delivery boundary

The original audit changed no product behavior. Its report and selected evidence are prepared for
publication with UX group A, which also carries runtime changes. This evidence remains tied to the
original baseline; source preparation is not final integrated verification. Production payments,
provider delivery and physical dock use remain outside the demonstrated coverage. See the
[coverage ledger](coverage.md) before treating an absence of findings as proof of correctness.
