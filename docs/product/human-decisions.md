# Human decision log

The durable worklist for decisions, approvals, and verification that need a human owner. It
complements the delivery sequence in [roadmap.md](roadmap.md): implementation can advance only
when the relevant row is **Chosen** or intentionally **Deferred**.

## How to use this log

1. The product owner assigns a named human owner and records the outcome and date in the relevant
   row. Link the approval, policy, or test evidence when it exists.
2. An implementer translates a product or technical outcome into the roadmap and, when it is
   significant and hard to reverse, an ADR. Then change the row to **Implemented**.
3. Do not mark a safety or production row complete based on a local demo. Record the required
   operational or legal evidence first.

**Status key:** **Ready** needs a human action now; **Deferred** is deliberately not needed for the
current slice; **Chosen** has an outcome awaiting implementation; **Implemented** is in the product
but still may need validation; **Validated** has the stated evidence.

## Immediate actions for the product owner

1. Name the operating jurisdiction(s) and the person responsible for legal approval. Have them
   review the waiver language, medical questions, typed-consent standard, and evidence-retention
   policy before production use.
2. Vercel is the selected production host and Neon (via Vercel's Marketplace integration) is the
   selected Postgres provider. Production builds run migrations automatically (see [Neon hosting
   ADR](../architecture/decisions/20260718-vercel-neon-hosting.md)). Still needed: name the person
   who owns production secrets, backups, domain, and incident response.
3. Assign the dive operations lead and run V-02 against the encrypted offline manifest before a
   production departure. Record the exact phone/browser, glare and wet-hand findings, airplane-mode
   reload result, multi-checkpoint roll call, conflict reconciliation, and print fallback.
4. Run the full browser verification for the merged gear and manifest work in light/dark desktop and
   phone viewports, keeping the automated offline Playwright scenario as regression evidence rather
   than a substitute for outdoor field validation.

## Decision register

| ID | Status | Human owner | Decision or approval needed | Minimum outcome to record | Unblocks / follow-up |
| --- | --- | --- | --- | --- | --- |
| H-01 | Ready | Product owner + qualified legal reviewer | Which jurisdiction(s), waiver text, and medical-question wording apply to the shop? | Jurisdiction, approved template/version, reviewer, and approval date. | Production waiver templates and any jurisdiction-specific questionnaire. The current PADI-style form shape is only a [provisional baseline](#waiver-and-signature). See [waiver ADR](../architecture/decisions/20260718-waiver-signature-retention.md). |
| H-02 | Ready | Product owner + qualified legal/privacy reviewer | What evidence-retention period, deletion-request process, and backup/audit exception apply to waivers and medical flags? | Retention duration, deletion workflow, permitted staff access, and any legal hold or audit exception. | Production data lifecycle, access controls, and deletion tooling. |
| H-03 | Ready | Product owner + qualified legal reviewer | Is the current typed name + explicit consent + timestamp sufficient for the intended release, or is a specialist e-signature provider required? | Accepted assurance level, required provider criteria (if any), and rollout boundary. | Keep the local signature provider or select and implement a vendor adapter. The current baseline is documented for review in the [provisional defaults](#waiver-and-signature). |
| H-04 | Implemented | Product owner / technical owner | Vercel is selected for web hosting and Neon (Vercel Marketplace integration) is selected as the Postgres provider. Still open: who owns secrets, backups, domain, and incident response? | Provider: Neon. Driver: `drizzle-orm/node-postgres`. Production builds run `pnpm db:migrate`; Vercel System Environment Variables are enabled. Still needed: region confirmation and named owner for secrets/backups/incident response. | Name the remaining owner and record backup/incident policy. See [Neon hosting ADR](../architecture/decisions/20260718-vercel-neon-hosting.md) and [Vercel hosting ADR](../architecture/decisions/20260718-vercel-hosting.md). |
| H-05 | Implemented | Product owner + dive operations lead | The product now uses explicit encrypted device snapshots rather than a live-only pilot. Approve or replace its 15-minute current / four-hour aging thresholds and retention at the earlier of 14 days after save or seven days after trip end. | Named operations/privacy owners, accepted thresholds and retention, and the production stop rule for a missing/expired/corrupt device copy. | Validate through V-02 before production. See [offline manifest ADR](../architecture/decisions/20260718-offline-manifest-snapshots.md). |
| H-06 | Ready | Dive operations lead | What is the initial gear policy for sizing, preferences, staff assignment, and substitutions? | Required measurements/preferences, who may override a request, and the safe fallback when a size is unavailable. | The booking-level rental request now uses a [standard provisional set](#rental-gear-request); approve or change it before production. |
| H-07 | In progress | Product owner + finance owner | What payment/deposit, cancellation, refund, tax, and provider policy should the first paid booking support? | Policy plus provider approval and webhook/account owner. | The provider decision is made and implemented: Stripe Connect (Standard, shop-owned accounts), orders/invoices, and webhook confirmation — see [20260719-stripe-connect-orders](../architecture/decisions/20260719-stripe-connect-orders.md). Public checkout-at-booking is also implemented on that substrate with a [provisional policy](#booking-checkout) — see [20260721-checkout-at-booking](../architecture/decisions/20260721-checkout-at-booking.md). The deposit and declarative-cancellation-window *mechanisms* are now shipped too (opt-in, off by default, no default values) — see [20260721-deposit-cancellation-policy](../architecture/decisions/20260721-deposit-cancellation-policy.md). **Automated refunds inside the cancellation window are now implemented** — a cancel inside a shop's stated window refunds a Stripe payment automatically through the shop's own account, degrading to the staff-run refund for counter payments, disconnected accounts, or Stripe failures — see [20260721-automated-cancellation-refund](../architecture/decisions/20260721-automated-cancellation-refund.md). Still open (policy, not mechanism): the deposit/window *values* shops should be guided toward, percentage vs. flat deposits (mechanism deferred by owner request), refund/tax policy, and whether the platform ever takes a fee; a live Stripe Connect platform application (`STRIPE_CONNECT_CLIENT_ID`) and Connect webhook secret (`STRIPE_WEBHOOK_SECRET`) — now also subscribed to the three `checkout.session.*` events — still need a named owner. |
| H-08 | Ready | Product owner + operations lead | Which certification levels, agency rules, and Discover Scuba Diver rules define a course booking? | Supported courses, prerequisites, expiration/verification rules, ratios, and exception process. | Course catalog/session admission now uses [conservative provisional rules](#course-admission); approve or replace them before operating courses. |
| H-09 | In progress | Product owner + communications owner | Which channel sends booking and waiver notifications, and what consent, copy, timing, and sender identity apply? | Provider: Resend. The implemented baseline is immediate transactional booking confirmation, staff-triggered waiver link, and — new — the wait-list freed-seat invite, all through the one `notify()` seam; `RESEND_FROM_EMAIL` is the verified sender. Each of these sends for real when Resend is configured and degrades to a copyable/mailto composer or a hand-off link when it isn't. The owner dashboard shows the latest failed or unconfigured send. **The remaining channel and cadence scope is now implemented:** SMS/WhatsApp via a Twilio `notifySms()` seam ([20260721-sms-whatsapp-notifications](../architecture/decisions/20260721-sms-whatsapp-notifications.md)) and scheduled pre-trip reminder cadences (7-day and 24-hour) sent by an idempotent cron endpoint ([20260721-scheduled-reminder-cadence](../architecture/decisions/20260721-scheduled-reminder-cadence.md)), both degrading to `not_configured` until their provider env is set. Still open (policy, not mechanism): opt-in/consent policy, sender ownership, approved copy, the `CRON_SECRET` and `TWILIO_*` credential owners, and per-channel delivery monitoring/retries. | Durable notification policy and multi-channel delivery. |
| H-10 | Dropped | Product owner + operations lead | ~~Request supported C-card verification access from PADI, SSI, and NAUI, then choose the authorized verification source for each agency.~~ | — | Dropped: no agency exposes a usable C-card verification API, so the automated seam was removed in favour of manual staff certification — staff look the number up with the agency and mark the card certified. See [20260721-manual-certification](../architecture/decisions/20260721-manual-certification.md). |
| H-11 | Ready | Dive operations lead + gas-blending authority | Which nitrox fill-station procedure, ppO₂ ceilings, mix band, O₂-clean tank tracking, and blender qualifications apply? | Approved fill-log of record, accepted ppO₂ limits, EANx band, and any per-agency card-acceptance rules. | Nitrox fill logging now uses [provisional dive parameters](#nitrox-fills) (22–40% O₂, MOD at ppO₂ 1.4/1.6); approve or replace them before operating a fill station. |
| H-12 | Ready | Product owner + finance owner | Is the public founding-shop price, commercial term, support promise, and multi-location policy correct? | Approved monthly price, billing cadence, support/onboarding commitment, taxes/fees policy, and public contact/contract flow. | The public pricing page uses a [provisional per-location monthly price](marketing.md#pricing-boundary) set in `src/lib/marketing.ts` (the source of truth; early-access and still moving). Validate or replace it before customer-facing launch. |
| H-13 | Ready | Product owner + `dive-domain-expert` reviewer | CR-008 made `(shop_id, lower(email))` a hard uniqueness constraint for active people and, per the existing pattern, self-service paths (booking, wait-list, import) silently *reuse* the matching person on any email match — the submitted name is never compared. A `dive-domain-expert` review of that diff flagged this as **unsafe**: a shared-inbox submission (a spouse, or a minor booked under a parent's email — see the glossary's Junior-certification rules) can silently attach a new diver's booking to an existing person's verified cert/current waiver, skipping medical-questionnaire collection and cert verification for someone who never provided either. Decide whether email-only reuse is acceptable as-is, or requires a name-mismatch safeguard (e.g. route a mismatched name to a staff-verify state instead of auto-"ready", surface `findOrCreatePerson`'s `created: false` to staff, or a light "is this you?" confirmation) before a live shop relies on it. The same review separately flagged the soft-delete-frees-the-email window: if staff soft-delete the wrong person and a genuinely *different* new person claims the freed email before the mistake is caught, that new person gets a blank record with no link back — bounded (fails closed, no data ever becomes ambiguous) but worth a deliberate policy call rather than leaving implicit. | Accepted behavior or a chosen safeguard design, and whether the soft-delete window needs a mitigation before production. | Any UX/policy change to `findOrCreatePerson` (`src/db/people.ts`) and its booking/wait-list callers; record the outcome in the [identity match key glossary entry](glossary.md#modeling-notes) and [20260723-person-email-uniqueness ADR](../architecture/decisions/20260723-person-email-uniqueness.md). |

## Human verification queue

| ID | Status | Human owner | Work to perform | Evidence of completion |
| --- | --- | --- | --- | --- |
| V-01 | Ready | Product owner or QA owner | Browser-check the merged M5/M6 experience in light and dark mode on a desktop viewport and a phone viewport: pack and return gear, service and retire eligible gear, view a manifest with blockers, board an eligible diver, reject a blocked diver, and print/save the manifest. | Browser/OS, viewports, test data, result, defects, and screenshots or a short screen recording. |
| V-02 | Ready | Dive operations lead + `dive-domain-expert` reviewer | Field-test the manifest on a phone outdoors with realistic marina connectivity. Include glare/wet hands, save + airplane-mode reload, a blocked diver, before-departure and after-dive roll calls, a deliberately newer live event conflict, reconnection, device-copy deletion, and print/PDF fallback. | Date, device/browser, network conditions, scenarios, freshness shown, reconciliation results, findings, screenshots/video, reviewer sign-off, and whether production departures may proceed. |
| V-03 | Ready before production | Product owner + qualified legal reviewer | Review the configured waiver/medical flow against the approved H-01–H-03 policies and confirm staff know how to handle a medical-review blocker. | Signed-off policy version, staff training owner/date, and escalation contact. |
| V-04 | Ready before production | Operations lead | Load real initial inventory, staff roles, trips, and pilot bookings; then rehearse check-in, packing, return, and roll call. | Pilot checklist, discrepancies found, and any required data cleanup. |
| V-05 | Ready before production | `dive-domain-expert` reviewer | Review the nitrox fill slice for domain correctness: EANx mix band, MOD formula and ppO₂ ceilings, the verified-card gate, and analysis-signature evidence. | Reviewer sign-off, any corrections to the [provisional parameters](#nitrox-fills), and confirmation the write-time gate matches shop policy. |

## Existing implementation boundaries

- **Waiver evidence:** the first release keeps immutable local records with typed consent; it does
  not claim cryptographic non-repudiation. The unresolved policy work is H-01 through H-03.
- **Manifest:** the live source remains derived and append-only. Offline use is an explicitly saved,
  encrypted device snapshot; it can disappear with browser storage, does not update across devices,
  and displays stale readiness rather than presenting it as live. Print/PDF is the independent
  fallback. Production operation remains blocked on H-05 policy approval and V-02 field evidence.
- **Provider choices:** payment, notification, signature, and similar integrations must remain
  behind a small provider seam rather than spreading vendor SDK calls through the application. See
  the provider-seam rule in [architecture/overview.md](../architecture/overview.md#cross-cutting-rules).
- **Rental requests:** the first request is an editable planning input, never an inventory
  reservation or fit/weight authorization. Staff allocation remains the conflict-safe source of
  truth.

## Provisional implementation defaults — verify before production

These are practical starting points used by the first course, gear, nitrox, and hosting slices.
They are not legal, agency, medical, or operations policy — the decision register above remains the
source of approval work; each row here maps to the H-row that must sign it off.

### Waiver and signature

- **Starting form shape:** liability release / assumption of risk / non-agency acknowledgement plus
  a medical questionnaire. This follows the structure of PADI's commonly encountered digital form
  set, not copied PADI text. The shop must use approved, jurisdiction-appropriate language before
  it sends a real waiver.
- **Starting signature:** typed full name, explicit agreement, timestamp, immutable template
  snapshot, and an expiring private completion link. This is a convenient electronic-consent
  baseline, not a claim of cryptographic non-repudiation or a substitute for legal advice.
- **Must verify (H-01–H-03):** jurisdiction, approved template and medical questions, age/guardian
  rules, retention/deletion, privacy notice, and whether a specialist e-signature provider is
  required.

Sources: [PADI digital forms](https://pros-blog.padi.com/digital-forms-expand/),
[PADI general-training release](https://pro-cms.padi.com/sites/default/files/documents/training-hub/10072_Liability_Release_v403_FF_EN.pdf),
and [PADI diver medical questionnaire](https://www.padi.com/sites/default/files/documents/2020-08/10346E_Diver_Medical_Form.pdf).

### Course admission

- **Starting rules:** Discover Scuba Diving and Open Water have no pre-existing C-card gate;
  Advanced Open Water and a refresher require a verified Open Water card. Instructor-led sessions
  cannot accept a booking until an instructor is assigned.
- **Must verify (H-08):** agency, local regulatory, insurer, ratio, depth, age, medical, and
  exception rules for every course/environment. The current C-card gate is conservative but
  intentionally incomplete.

### Rental gear request

- **Starting rental set:** BCD, regulator, wetsuit, mask/fins, weights, and tank; dive computer
  is opt-in. The request asks for BCD/wetsuit size, boot/fin size, usual weighting, and notes.
- **Safety boundary:** a request is not a reservation or fit approval. Staff still assigns a real,
  available item and confirms fit/weight at check-in.
- **Must verify (H-06):** shop inventory packages, thickness/temperature guidance, measurement
  method, substitution authority, computer/tank policy, and the safe fallback when a requested size
  is not available.

Source: [example dive-rental reservation form with package and size fields](https://www.sailcaribbeandivers.com/wp-content/uploads/2024/10/SCD-RENTAL-FORM-2024-25.pdf).

### Booking checkout

- **Starting policy:** the full per-diver price (trip price, or the course's priced pair) is asked
  for at booking through one hosted Stripe Checkout on the shop's connected account; no tax lines,
  no platform fee, no automated refund. Refunds stay staff-initiated from the diver's payment
  context.
- **Deposit (opt-in, shipped):** a shop may set an optional per-diver `deposit_cents` on a trip. It
  charges that at booking (labelled a deposit on the Stripe page), settles the booking to
  `deposit_paid`, and shows the diver the balance still due at the dock. Off by default (null =
  full fare); a deposit at or above the price is ignored and charges full. DiveDay ships no default
  deposit amount — the value is the shop's commercial term. See
  [20260721-deposit-cancellation-policy](../architecture/decisions/20260721-deposit-cancellation-policy.md).
- **Cancellation window (opt-in, shipped):** a shop may set `cancellation_window_hours` (hours
  before departure a diver can cancel for a refund). It is *shown* to divers at booking and on the
  confirmation, and to staff as a "refund-eligible until" cue on paid seats. Off by default (null =
  no stated window); DiveDay ships no default window.
- **Automated refund inside the window (shipped):** cancelling a paid booking inside a stated window
  now refunds the Stripe payment automatically through the shop's own connected account and settles
  the booking to `refunded`. It moves money only on a confirmed Stripe reversal; a counter/cash
  payment, a disconnected account, a past-deadline (forfeit) cancel, or a Stripe failure all degrade
  to the staff-run refund, surfaced in the trip notice. No stated window = no automation. See
  [20260721-automated-cancellation-refund](../architecture/decisions/20260721-automated-cancellation-refund.md).
- **Safety boundary:** payment never gates the capacity-safe booking transaction — a diver who
  abandons checkout keeps the seat as an ordinary unpaid booking, surfaced by the existing
  `payment_due` blocker where the trip requires payment. Paid/deposit state is recorded only from
  Stripe's own webhook or API responses, never from a return URL.
- **Opt-out:** leave the trip unpriced or the Stripe account unconnected and the public flow stays
  book-now-pay-later.
- **Must verify (H-07):** the deposit-amount and cancellation-window *values* a shop should be
  guided toward (DiveDay ships none), percentage vs. flat deposits (mechanism deferred by owner
  request), tax treatment, any platform fee, and whether unpaid bookings should auto-expire.
  Automated refunds inside the window are now implemented; the remaining refund question is only
  whether a partial-refund tier is ever wanted.

### Nitrox fills

- **Starting mix band:** whole-percent recreational EANx from 22% to 40% oxygen. Below 22% is
  treated as air; above 40% is a technical mix outside this slice. Non-integer and out-of-band
  values are rejected rather than logged.
- **Starting MOD basis:** maximum operating depth is derived as `10·(ppO₂/FO₂ − 1)` metres, floored,
  at a default working ppO₂ of **1.4 bar** with a **1.6 bar** contingency option. The value is
  computed from the analyzed mix, never entered by hand.
- **Starting gate + evidence:** a fill is only logged for a diver with a **verified** nitrox
  specialty card, and it records the diver's typed analysis signature, the mix, the ppO₂ ceiling,
  and the deriving staff member. It does not replace the diver's own pre-dive O₂ analysis.
- **Must verify (H-11, V-05):** agency/blending-facility fill-station procedure, whether a signed
  analysis sticker or fill log of record is required, the accepted ppO₂ ceilings for the shop's
  diving, gas-blender qualifications, O₂-clean tank tracking, and any per-agency EANx card
  acceptance rules.

Sources: [DAN — enriched air nitrox and ppO₂/MOD limits](https://dan.org/alert-diver/article/the-basics-of-nitrox/),
[NOAA Diving Manual oxygen exposure limits](https://www.noaa.gov/).

### Vercel hosting

Vercel is the selected web host and Neon (through Vercel's Marketplace integration) is the
production Postgres provider. The Vercel production build applies committed Drizzle migrations
before building the application; preview builds intentionally skip them. Vercel System Environment
Variables are enabled, so the build can identify production through `VERCEL_ENV`. Backups, domain,
secrets, and incident ownership still need H-04 completion. See the [Neon hosting
ADR](../architecture/decisions/20260718-vercel-neon-hosting.md).

## Change history

| Date | Change | Owner |
| --- | --- | --- |
| 2026-07-18 | Created from the remaining product and operational work after M5 gear and M6 live manifest. | Product team |
| 2026-07-18 | Selected Vercel hosting; added provisional waiver/signature/course/gear baselines for human review. | Product team |
| 2026-07-18 | Implemented Neon as the H-04 Postgres provider (node-postgres driver, `pnpm db:migrate` runbook); owner/backup/incident-response naming still open. | Engineering |
| 2026-07-18 | Configured Vercel production builds to run committed Drizzle migrations before building the app; preview builds remain read-only. | Engineering |
| 2026-07-18 | Shipped the M7 nitrox fill-log slice; added H-11 fill-station policy and V-05 dive-domain review. | Product team |
| 2026-07-18 | Added public homepage, product, and pricing surfaces with real-demo screenshot capture; recorded H-12 for commercial approval. | Product team |
| 2026-07-18 | Researched PADI, SSI, and NAUI verification access; added agency-specific gateway configuration and the credential setup runbook. | Engineering |
| 2026-07-18 | Connected a private Vercel Blob store for certification-card uploads and configured its token in Vercel; updated the card-image ADR and roadmap. | Engineering |
| 2026-07-18 | Enabled Vercel System Environment Variables so production builds can identify `VERCEL_ENV` and run the documented migration path. | Engineering |
| 2026-07-18 | Implemented the M6 offline snapshot/reconciliation policy and expanded V-02 into the required outdoor safety review. | Engineering |
| 2026-07-19 | Implemented Stripe Connect (Standard) so shops bring their own account, plus orders/invoices with webhook-confirmed payment; updated H-07 to reflect the settled provider/mechanism decision, with deposit/cancellation/refund/tax policy and a Connect platform-credential owner still open. | Engineering |
| 2026-07-21 | Implemented public checkout-at-booking on the Connect substrate (hosted Stripe Checkout after the capacity-safe booking, webhook + API-read confirmation); recorded the provisional full-price/no-deposit policy for H-07 review. | Engineering |
| 2026-07-21 | Shipped the H-07 deposit and declarative cancellation-window *mechanisms* (opt-in per-trip `deposit_cents` charging to `deposit_paid`; `cancellation_window_hours` shown to divers and staff, refunds still staff-run); off by default, no default values — the policy values remain H-07. Wired the H-09 wait-list freed-seat invite through the `notify()` seam so it sends for real by default, with the composer as fallback. | Engineering |
| 2026-07-21 | Owner chose to automate the H-07 refund and close the remaining H-09 channel/cadence scope. Shipped: automated refund inside a stated cancellation window (Stripe reversal on the shop's account, degrading to staff-run everywhere else); SMS/WhatsApp via a fetch-based Twilio `notifySms()` seam; and scheduled 7-day/24-hour pre-trip reminder cadences sent by an idempotent `GET /api/cron/reminders` endpoint (Vercel Cron, `CRON_SECRET`-guarded), with a courtesy SMS alongside email. Percentage deposits deferred by owner request. All off until their provider env is set. | Engineering |
