# Journey-by-journey assessment

This assessment combines rendered screens, focused interaction probes and source review. It is not a
usability scorecard based on participant testing. See [coverage](coverage.md) for the exact browser
scope, and [findings](findings.md) for baseline defects and their reconciliation. All observations
refer to baseline `f3bfde4604ea0090eba3143986f01001dbaefab0`. Opportunity paragraphs retain that
dated rationale; issue references outside the approved groups have not been refreshed into a current
backlog. See [publication groups](opportunities.md#approved-publication-groups) for prepared A–D
work and [Shipped](../../shipped.md#ux-audit-continuity-and-operational-trust-merged-2026-10-21) for
merged slices.

## A prospective owner deciding whether to try DiveDay

**What works.** The product has a coherent dive-shop proposition and a working demo path. Manual
setup is a deliberate service model, with a thank-you page and migration guidance rather than an
empty self-service account. The visual language is consistent with the application.

**Opportunity.** The most useful question is whether the owner can quickly prove that DiveDay
handles their actual day: preparing a trip, finding paperwork, making a change and closing the
money. Test those tasks in the demo rather than adding broad feature claims. A safe setup receipt
(O-06) would let the requester recover the next step after closing the browser.

**Boundary.** The audit did not submit a real setup request or test email delivery. The operator
alert contains a founder-only capability; a customer receipt must be a separate, minimal message. Do
not replace manual onboarding or invent a response-time promise.

## A first-time diver choosing a departure

**What works.** Public schedule and departure pages expose real trip context, availability and
booking. The local Discover Scuba booking accepted ordinary contact details and an adult
attestation, then handed off directly to readiness. The confirmation moment was specific to the
reservation and did not interrupt the next task.

**Opportunity.** Course date requests should remain possible without a shop email (UX-07). The
first-dive course experience also has known work around included gear, the correct meeting time and
a beginner's packing list (#2795/#2796). These reduce uncertainty more directly than adding another
promotional module.

**Boundary.** The successful local booking was a pay-at-shop demo. It proves that path only, not
card authorization, refunds, multi-person payment, guardian consent or a live email arrival.

## A returning diver being recognized

**What works.** The code distinguishes recognizing a returning identity from exposing private
history before possession of the email address is established. This is an important example of
reassurance with a privacy boundary. Find-your-booking exists as a recovery door.

**Opportunity.** Improve continuity around interrupted or expired journeys without relaxing that
boundary. The existing #2691 privacy work should remain authoritative. A prefilled form is useful;
unverified access to someone else's booking or medical history is not.

**Boundary.** This audit did not complete every returning-person/email-possession branch. It does
not classify existing protective friction as an unnecessary step.

## A diver getting ready on a phone

**What works.** The readiness page gives a clear next action, arrival information, payment terms,
shop contact and practical preparation. The fresh-document screenshot shows that this hierarchy
survives beyond the immediate booking confirmation. Sections disclose detail without making every
step compete at rest.

**Opportunity.** Keep the preparation list appropriate to the actual activity and experience level.
For a pending move request, show the submitted request and when it was made (O-04), while making
clear that the shop still decides. The existing reminder opportunity (#2794) brings a useful planned
fly-safe fact to the moment before the trip.

**Boundary.** A pending request is not a changed reservation. An offline readiness copy is not proof
of current boarding clearance. The map area in this local environment had external HTTP disabled; it
is not evidence of a broken production map.

## A diver signing paperwork or facing a referral

**What works.** Release, medical questions and signature form one understandable progression. The
rendered questionnaire started with zero answers; no radio option was selected. The source/tests
keep a referral unresolved on repeat submission and refuse held identities even when they possess an
earlier link. “Signed” and “cleared” remain distinct.

**Opportunity.** Private physician-document delivery and approved official wording are existing
high-value work (#2797/#2793). A first-time participant should understand the next practical step
when they cannot finish. Measure the “about two minutes” expectation against actual completion;
never shorten or preanswer medical content to make the promise true.

**Boundary.** The audit opened but did not answer or sign the medical/waiver form. It did not
validate medical content, legal sufficiency or physician decisions. English legal/medical wording is
deliberate pending human approval.

## A diver changing plans or canceling

**What works.** The local unpaid booking exposed an inline confirmation with the consequence at the
point of commitment. Canceling returned “This booking was canceled,” said the seat was no longer
held and offered upcoming departures. This is a useful terminal state rather than a dead capability
page with no explanation.

**Opportunity.** The pending request receipt (O-04), whole-party move (#2556) and reminder re-keying
(#2554) should form one coherent lifecycle: asked, answered, changed, then correctly reminded. Avoid
making users infer a move from an acknowledgment.

**Boundary.** The audit did not exercise a paid cancellation or refund. The source review confirms
that action helpers reload state and reject canceled/held authority; implementation must keep those
checks even if the UI becomes more convenient.

## A desk worker finding a person during an interruption

**What works.** Search is a shared, fast entry point and already reaches useful gear identifiers.
The diver record brings booking, history and related work together. This is the right place for
contextual actions.

**Opportunity.** UX-05 makes the local booking picker complete beyond its first 50 scanned
departures. O-02 keeps duplicate comparison available after the first five candidates without
restoring an enormous list. Both are prepared in A. The baseline search failures UX-01/02 have a
resolution link in [findings](findings.md); their recommendations are no longer open work here.

**Boundary.** A failed search must not retain private results after authorization is lost. Duplicate
handling must continue through side-by-side comparison and live merge safety checks. The audit
proved wrong navigation, not an unauthorized read or a wrong-person mutation.

## A desk worker starting a form, then answering the phone

**What works.** Staff draft support exists for new diver, new departure and took-a-call forms,
scoped to staffer/shop with expiry. A positive browser control demonstrated recovery after a normal
blur-and-save.

**Baseline evidence.** Immediate navigation canceled the pending save and lost the latest entry
(UX-03), subsequently resolved in #2873. The Start over failure path also supported UX-04 at the
baseline; its current implementation and tracker state are unknown here. This audit does not
establish a current draft-expansion recommendation.

**Boundary.** Current sensitive-field exclusions are based on field names, not content
classification. An arbitrary note can still contain sensitive prose. Expanded coverage needs
explicit allowed fields, session-derived ownership and no persistent browser cache of personal or
medical information.

## A desk coordinating requests and helpers

**What works.** Inbox, requests and staffing are dedicated operational surfaces, rather than
miscellaneous notes on a calendar. Existing product decisions recognize that the desk may speak to
the helper and record the arrangement.

**Opportunity.** Finish named helper assignment and outcomes (#2851), recorded date-request replies
(#2555), and the approved Interest design (#2656). Each should answer three questions: who is
responsible, what happens next, and what actually happened. Avoid another parallel queue or an
acknowledgment button that can be mistaken for completion.

**Boundary.** Interest is approved terminology and architecture. The unavailable design document
must be recovered before implementing its six-PR scope; the audit is not a substitute design.

## A captain preparing and running a departure

**What works.** Owner and captain views of Today/manifest rendered at phone and desktop sizes.
Preparation and manifest content are organized around the boat's work. The source separates
confirmed roll call from queued offline actions and preserves after-dive rescue counting when a
readiness lookup fails. Printed people counts include crew and passenger types.

**Baseline evidence.** The audit prioritized offline certified capacity, boat-swap evidence and
buddy checks (#2742/#2727/#2807). These merged in #2906 and are recorded in
[Shipped](../../shipped.md#ux-audit-continuity-and-operational-trust-merged-2026-10-21). Unknown-age
handling (#2808) retains its baseline issue context; its current state was not revalidated here.

**Boundary.** Actual head counts must remain recordable. Do not apply a booking gate to rescue
counting or describe a local queued mark as saved. No physical offline phone, glare or wet-hand
trial was conducted; source/test review cannot replace that field check.

## An instructor managing a multi-meeting course

**What works.** Courses and public course discovery exist as first-class surfaces. The product has
the necessary concepts to present course-specific preparation rather than treating every booking as
a generic fun dive.

**Opportunity.** Existing per-meeting time and Today/readiness work (#2557/#2558), plus included
gear (#2795/#2796), should be considered together. The student and instructor need to agree on which
meeting happens when and what to bring. Course interest should still be captured when a session is
not yet scheduled (UX-07).

**Boundary.** A course fee is not necessarily the cost of each meeting. Preserve the distinction
between enrollment, the session's timetable and each departure's operational readiness.

## A counter worker renting or repairing gear

**What works.** Rental tickets, gear inventory, global identifier search and the repair bench
already exist. Repair history is reachable from the diver record. This is considerable operational
depth, not a missing rental subsystem.

**Opportunity.** UX-06 records collected-repair ordering at the baseline; its current state is
unknown. Approved D prepares local unit lookup in a large
rental cart (O-03) and preserve selections after a refusal (#2723). Both reduce repeated scanning
and rebuilding without changing the inventory model.

**Boundary.** Availability, maintenance restrictions and price must be checked at commitment.
Filtering a cart must not hide selected items or make a blocked unit available. The audit did not
simulate a complete busy rental day or a physical return inspection.

## An owner or bookkeeper closing the month

**What works.** Reports present the month and then linked departure detail in a ledger. This is a
better fit than another card dashboard. Export exposes the crew sheet and broader data bundle;
revenue and payment history have explicit meanings.

**Opportunity.** Approved A prepares exact shares for UX-08: a $675 pool displayed as two $338
shares is visibly inconsistent even if the ledger is correct. UX-10 records decision amounts and
waiver statuses below the product's 16px standard at baseline; its current state is unknown.
Existing bounce reporting (#2798) closes the handoff when an email does not arrive.

**Boundary.** This is not an accounting certification. The audit did not reconcile live processor
settlements, taxes or bookkeeper records. Keep exact payout formatting separate from intentionally
rounded summary KPIs.

## An owner setting up and maintaining the shop

**What works.** Settings are discoverable doors into focused editors. Import explains what comes
across and requires preview confirmation. Calendar subscriptions explicitly warn that feeds can lag.
Rental pricing explains set-versus-piece behavior. Demo billing truthfully says the shop is not
billed.

**Opportunity.** Raw active-session strings make the device decision unnecessarily technical (O-01).
The branding editor would benefit from a direct view of saved public output (O-05). Team's many
maintenance disclosures are a candidate for observation with a larger crew, not a confirmed need for
a new layout.

**Boundary.** Most setting mutations were deliberately not performed. Integration “not available”
states reflect this local environment's configuration. No real OAuth, provider connection, WhatsApp
approval, export download or import commit was validated.

## A guest remembering and sharing the dive

**What works.** Recap/photo consent, review text, postcard saving and native sharing have existing
implementations. The product already supports a meaningful post-dive artifact rather than a purely
transactional receipt.

**Opportunity.** Clear consent and withdrawal (#1213/#2806) make sharing feel controlled. Preserve
textual review value for a guest who does not share a photo. One relevant memory is more valuable
than repeated prompts or generic achievements.

**Boundary.** The audit did not exercise a live completed-dive recap. A withdrawal feature must
verify the owner and distinguish hiding future gallery access from recalling copies someone has
already downloaded. A forwardable recap link is not deletion authority.

## Accessibility, localization and speed across journeys

Six sampled phone surfaces had zero violations under the repository's selected axe rules. The mobile
dock's two focus-edge defects were confirmed and already tracked (#2848). These facts coexist:
automated rule success is not complete accessibility. Report labels measured at 14px violate the
product's stronger dock standard (UX-10), which axe does not enforce.

Spanish public schedule, reports and branding layouts were sampled separately. Broader language
quality, recovery copy and real screen-reader use remain research work. Preserve the reader's
language preference and the existing Latin American terminology decisions.

No production latency claim is made. Development compilation, a frozen clock and disabled external
HTTP make this environment unsuitable for performance benchmarking. Prioritize correct pending and
failure states under delay before interpreting a faster-looking screen as a faster workflow.
