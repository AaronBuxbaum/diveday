# Documentation idea coverage: 10 November 2026

A source reconciliation at `69b23d33c3ab1981d76e70876e3029ce8322f892`, after the earlier
[documentation cleanup](https://github.com/AaronBuxbaum/diveday/pull/4225) merged. This records
coverage and dispositions, not another implementation queue. GitHub owns delivery status;
accepted ADRs and human decisions own policy. A recorded idea is not new approval to build it.

## Coverage

The tracked `docs/` inventory contained 982 files: 754 Markdown documents, 187 HTML artboards,
19 JSON files and 22 historical JPGs. The pass inventoried all paths and searched the Markdown
corpus for pending, deferred, follow-on and superseded work. Substantive idea/review reading covered
17 product/brainstorm/archive documents, 20 assessment documents and seven engineering audit
records. ADRs, human decisions, canvas indexes and current implementation records supplied the
later decisions and targeted source checks. The original review board had 146 ideas; its existing
IDs and historical owner verdicts were retained when adding the omitted entries.

GitHub reconciliation included 2,027 issue titles/bodies across all states, the 100 most recent
pull requests, and targeted issue comments, timelines and merge records. The issue corpus was
captured before the three recovery tickets below were filed. No matching open ticket is not by
itself proof that an idea is new or approved.

## Three recovered device slices

The accepted [In your hands ADR](../../architecture/decisions/20260907-in-your-hands.md) and
[recorded owner decision](../human-decisions/H-20260907-where-device-already-knows.md) contain
three slices absent from the review board and without a matching implementation ticket or source
mechanism found in this pass:

| Slice | Recovered scope | Tracker |
| --- | --- | --- |
| 19a | Staff passkey sign-in and device-verified, session/purpose-bound step-up, retaining password recovery and current security contracts | [#4232](https://github.com/AaronBuxbaum/diveday/issues/4232) |
| 19d | Upward-only iPhone system text-size adaptation, unchanged minimum size and no first-paint jump, with actual platform validation | [#4234](https://github.com/AaronBuxbaum/diveday/issues/4234) |
| 19e | Contextual phone/tablet installation affordance, dismissed per device and absent when installed, desktop or embedded | [#4233](https://github.com/AaronBuxbaum/diveday/issues/4233) |

These are recovery tickets on the idea shelf. They retain the historical design decision and require
reconciliation against the current auth, type and Logbook surfaces. Filing them does not enroll
credentials, change production security or promise an implementation date.

19b shared-device counter signing is superseded by the
[22 October phone-only decision](../../architecture/decisions/20261012-course-forms-on-charters-and-counter.md).
19c's stored-photo premise was declined. Later scan-and-discard assistance has a different accepted
boundary; neither earlier slice is revived by this pass.

## Remaining source detail

The full 62-row September register, raw brainstorm, AI prompts and major deferred subsystems
already had review-board entries. Smaller omissions are preserved as research or conditional
inventory, not promoted into an audit-sized issue queue:

- Five [UX observation questions](assessments/ux-delight-20261021/opportunities.md): waiver duration,
  finding product proof/demo, booking Back continuity, larger-team maintenance and expired-password
  recovery. Spanish interrupted-task recovery belongs with existing #4217.
- Font-preload measurement from [performance finding FE-11](assessments/performance-cost-audit-20261021.md),
  preserving glyph coverage and layout stability; no waste or regression was freshly measured.
- Legacy Visible Divers/DiveCentreHQ import-header research from the
  [switching landscape](assessments/switching-guide-landscape.md), conditional on representative
  user-exported files, not new dead-vendor marketing pages.
- [Course-form non-material edits](../../architecture/decisions/20261008-course-forms.md) and
  [per-shop Stripe Customer reuse](../../architecture/decisions/20260719-stripe-connect-orders.md).
  The first requires legal/safety review; the second waits for observed duplicate-customer cost.
- Operational quality measures in the [old roadmap](roadmap-20261110.md#measures), distinct from
  founder activation totals; and conditional
  [Stripe promotion-code reconciliation](../../architecture/decisions/20260729-shop-promo-codes.md).
- Existing engineering entries retain the scenario-state coverage audit, production-sized
  migration rehearsal and collision-driven orchestration ideas. Existing shop-agent exploration
  retains staff Q&A as an alternative to an MCP endpoint.

The thin resort-market payment-receipt upload suggestion remains dormant source detail. It is
neither a demonstrated gap for this market nor a new payment commitment.

## Completed, partial and superseded work

- The [85 visual-polish proposals](../../engineering/audits/20261026-visual-polish-plan.md) are
  fully dispositioned: 75 implemented, seven already done and three owner-retained. RP04's final
  merge is #3123; the old 74-of-75 and unpublished wording was stale.
- Pickup ordering, root crash reporting and report facts landed in #4199, #4206 and #4204.
  Group holds/payment ledger, native Wallet implementation, drysuit short sizes and measured text
  contrast landed in #4222, #4228, #4226 and #4224. Wallet still needs owner credentials #4208.
- Fixed-amount discount codes already exist. The nitrox planning line is verified EAN32 only,
  not the proposed general calculator. Instructor cohort preparation is not proof of every
  historical group-claim idea. Conservation records are not REEF/iNaturalist sightings exports.
- The current [top-of-stack CI policy](../../architecture/decisions/20261105-ci-runs-on-the-top-of-the-stack.md)
  supersedes every-layer research; branch protection remains deliberately unchanged. Removed task
  packets are not a current context-selection mechanism.

## Verification limits

This was source reconciliation with targeted code and GitHub evidence, not a fresh usability,
security, legal, production, competitor or performance audit. Historical images/artboards were
inventoried, not rerendered. Not every issue comment or historical commit was searched. A partial
implementation does not complete its broader proposal, and a merged PR does not establish provider
activation, deployment or field validation. New evidence can change these dated dispositions.
