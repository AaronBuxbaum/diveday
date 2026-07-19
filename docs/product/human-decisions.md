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
   selected Postgres provider. Enable Vercel's System Environment Variables so production builds
   run migrations automatically (see [Neon hosting
   ADR](../architecture/decisions/20260718-vercel-neon-hosting.md)). Still needed: name the person
   who owns production secrets, backups, domain, and incident response.
3. Decide whether the live-only manifest is acceptable for the first pilot. If it is, schedule the
   outdoor phone and connectivity field test below; if not, authorize the offline design decision
   before operating from a dock.
4. Run the browser verification for the merged gear and manifest work on a browser-capable machine.
   The automated browser suite was not runnable in the implementation environment because Chromium
   was unavailable.

## Decision register

| ID | Status | Human owner | Decision or approval needed | Minimum outcome to record | Unblocks / follow-up |
| --- | --- | --- | --- | --- | --- |
| H-01 | Ready | Product owner + qualified legal reviewer | Which jurisdiction(s), waiver text, and medical-question wording apply to the shop? | Jurisdiction, approved template/version, reviewer, and approval date. | Production waiver templates and any jurisdiction-specific questionnaire. The current PADI-style form shape is only a [provisional baseline](defaults-to-verify.md#waiver-and-signature). See [waiver ADR](../architecture/decisions/20260718-waiver-signature-retention.md). |
| H-02 | Ready | Product owner + qualified legal/privacy reviewer | What evidence-retention period, deletion-request process, and backup/audit exception apply to waivers and medical flags? | Retention duration, deletion workflow, permitted staff access, and any legal hold or audit exception. | Production data lifecycle, access controls, and deletion tooling. |
| H-03 | Ready | Product owner + qualified legal reviewer | Is the current typed name + explicit consent + timestamp sufficient for the intended release, or is a specialist e-signature provider required? | Accepted assurance level, required provider criteria (if any), and rollout boundary. | Keep the local signature provider or select and implement a vendor adapter. The current baseline is documented for review in [defaults-to-verify.md](defaults-to-verify.md#waiver-and-signature). |
| H-04 | Implemented | Product owner / technical owner | Vercel is selected for web hosting and Neon (Vercel Marketplace integration) is selected as the Postgres provider. Still open: who owns secrets, backups, domain, and incident response? | Provider: Neon. Driver: `drizzle-orm/node-postgres`. Production builds run `pnpm db:migrate`; enable Vercel System Environment Variables. Still needed: region confirmation and named owner for secrets/backups/incident response. | Name the remaining owner and record backup/incident policy. See [Neon hosting ADR](../architecture/decisions/20260718-vercel-neon-hosting.md) and [Vercel hosting ADR](../architecture/decisions/20260718-vercel-hosting.md). |
| H-05 | Ready | Product owner + dive operations lead | Is a live, online-only manifest acceptable for the first pilot? | Pilot decision, acceptable connectivity conditions, and stop rule if connectivity is lost. | A live-only pilot, or an offline-manifest design ADR before use. See [manifest ADR](../architecture/decisions/20260718-manifest-live-first.md). |
| H-06 | Ready | Dive operations lead | What is the initial gear policy for sizing, preferences, staff assignment, and substitutions? | Required measurements/preferences, who may override a request, and the safe fallback when a size is unavailable. | The booking-level rental request now uses a [standard provisional set](defaults-to-verify.md#rental-gear-request); approve or change it before production. |
| H-07 | Deferred | Product owner + finance owner | What payment/deposit, cancellation, refund, tax, and provider policy should the first paid booking support? | Policy plus provider approval and webhook/account owner. | M7 payment scope and a payment-provider ADR. Stripe is only a leading candidate, not a decision. |
| H-08 | Ready | Product owner + operations lead | Which certification levels, agency rules, and Discover Scuba Diver rules define a course booking? | Supported courses, prerequisites, expiration/verification rules, ratios, and exception process. | Course catalog/session admission now uses [conservative provisional rules](defaults-to-verify.md#course-admission); approve or replace them before operating courses. |
| H-09 | In progress | Product owner + communications owner | Which channel sends booking and waiver notifications, and what consent, copy, timing, and sender identity apply? | Provider: Resend. The implemented baseline is immediate transactional booking confirmation and staff-triggered waiver link; `RESEND_FROM_EMAIL` is the verified sender. The owner dashboard shows the latest failed or unconfigured send. Opt-in policy, sender ownership, approved copy, delivery monitoring, retries, and any SMS scope still need an owner. | Durable notification policy and multi-channel delivery. |
| H-10 | Ready | Product owner + operations lead | Request supported C-card verification access from PADI, SSI, and NAUI, then choose the authorized verification source for each agency. | Agency contacts, account/partner status, approved request fields and retention policy, endpoint/auth documentation, test-card approval, and a named credential owner. | Configure the agency pair in [the integration runbook](../integrations/certification-agencies.md); card capture and fail-closed review already work without an API. |
| H-11 | Ready | Dive operations lead + gas-blending authority | Which nitrox fill-station procedure, ppO₂ ceilings, mix band, O₂-clean tank tracking, and blender qualifications apply? | Approved fill-log of record, accepted ppO₂ limits, EANx band, and any per-agency card-acceptance rules. | Nitrox fill logging now uses [provisional dive parameters](defaults-to-verify.md#nitrox-fills) (22–40% O₂, MOD at ppO₂ 1.4/1.6); approve or replace them before operating a fill station. |
| H-12 | Ready | Product owner + finance owner | Is the public founding-shop price, commercial term, support promise, and multi-location policy correct? | Approved monthly price, billing cadence, support/onboarding commitment, taxes/fees policy, and public contact/contract flow. | The public pricing page currently uses a [provisional $249 per-location monthly price](marketing.md#pricing-boundary). Validate or replace it before customer-facing launch. |

## Human verification queue

| ID | Status | Human owner | Work to perform | Evidence of completion |
| --- | --- | --- | --- | --- |
| V-01 | Ready | Product owner or QA owner | Browser-check the merged M5/M6 experience in light and dark mode on a desktop viewport and a phone viewport: pack and return gear, service and retire eligible gear, view a manifest with blockers, board an eligible diver, reject a blocked diver, and print/save the manifest. | Browser/OS, viewports, test data, result, defects, and screenshots or a short screen recording. |
| V-02 | Ready after H-05 | Dive operations lead | Field-test the manifest on a phone outdoors with realistic marina connectivity. Include a temporary network loss, a readiness blocker, boarding, and the print/PDF fallback. | Date, device, network conditions, scenarios, findings, and whether the pilot can proceed. |
| V-03 | Ready before production | Product owner + qualified legal reviewer | Review the configured waiver/medical flow against the approved H-01–H-03 policies and confirm staff know how to handle a medical-review blocker. | Signed-off policy version, staff training owner/date, and escalation contact. |
| V-04 | Ready before production | Operations lead | Load real initial inventory, staff roles, trips, and pilot bookings; then rehearse check-in, packing, return, and roll call. | Pilot checklist, discrepancies found, and any required data cleanup. |
| V-05 | Ready before production | `dive-domain-expert` reviewer | Review the nitrox fill slice for domain correctness: EANx mix band, MOD formula and ppO₂ ceilings, the verified-card gate, and analysis-signature evidence. | Reviewer sign-off, any corrections to the [provisional parameters](defaults-to-verify.md#nitrox-fills), and confirmation the write-time gate matches shop policy. |

## Existing implementation boundaries

- **Waiver evidence:** the first release keeps immutable local records with typed consent; it does
  not claim cryptographic non-repudiation. The unresolved policy work is H-01 through H-03.
- **Manifest:** the first release is live, derived, append-only, and intentionally not offline.
  Cache freshness, encryption/retention, reconciliation conflicts, and per-dive checkpoints need a
  later ADR if offline capability is approved.
- **Provider choices:** payment, notification, signature, and similar integrations must remain
  behind a small provider seam rather than spreading vendor SDK calls through the application. See
  [next steps](next-steps.md#adopt-with-the-first-external-integration-m3).
- **Rental requests:** the first request is an editable planning input, never an inventory
  reservation or fit/weight authorization. Staff allocation remains the conflict-safe source of
  truth.

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
