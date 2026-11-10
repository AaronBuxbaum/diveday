# Roadmap

Current priorities, reconciled 2026-11-10. GitHub issues own implementation scope, claims and
status. This page explains direction; it is not a second checklist. A draft PR is work in review,
not proof of delivery or production activation.

## Where we are

The five pillars and substantial follow-ons are built. Boats, private charters, participant types,
per-seat checkout, seat claims, the read API/webhooks, counter rentals and gas records exist. Do
not rebuild them from the older roadmap's missing-feature descriptions. See [shipped.md](../shipped.md),
the current code and the relevant ADR before proposing a delta.

Aaron confirmed on 2026-11-10 that there are no shops or pilot partners yet. He did not impose a
pilot-only engineering boundary: UX/design exploration and polish remain wanted. Keep public
claims within [marketing.md](../marketing.md); website work is a discussion, not an included
custom-build promise.

<a id="18-nothing-from-nowhere-18a18e-shipped-2026-09-07-18f-waiting-on-h-20260907-diveday-move-like-thing-b"></a>

## Approved work and ownership

- **Group coordination:** expiring holds plus an organizer payment ledger, [#4209](https://github.com/AaronBuxbaum/diveday/issues/4209).
  Implemented in draft [#4222](https://github.com/AaronBuxbaum/diveday/pull/4222) on top of per-seat
  checkout and seat claims; no new split-payment prerequisite or seat cap. Unmerged work is not
  production activation.
- **Native Apple/Google Wallet passes:** build dark in [#4218](https://github.com/AaronBuxbaum/diveday/issues/4218);
  owner-controlled accounts and credentials are [#4208](https://github.com/AaronBuxbaum/diveday/issues/4208).
  The saved HTML arrival card is the fallback, not native Wallet delivery. The approved contract
  remains [slice 18f](../../design/canvases/20260907-nothing-from-nowhere/SPEC.md).
- **AWS hosting:** serverless-first OpenNext/CloudFront go/no-go spike, [#4219](https://github.com/AaronBuxbaum/diveday/issues/4219).
  Keep Neon for now. Preview URLs remain an owner question. No production migration or purchase
  follows from the spike; see [the current dossier status](../../architecture/aws-migration-dossier.md#current-direction--2026-11-10).
- **Drysuit short cuts:** retain the existing grid, add short variants, retain Not sure and collect
  no body measurements, [#4221](https://github.com/AaronBuxbaum/diveday/issues/4221).
- **Contrast:** [#4211](https://github.com/AaronBuxbaum/diveday/issues/4211) owns fresh measurement and
  raising text combinations below 4.5:1, implemented in draft
  [#4224](https://github.com/AaronBuxbaum/diveday/pull/4224). Its current evidence is linked below.

The leave-it guide pricing link is already on `main` through
[#4207](https://github.com/AaronBuxbaum/diveday/pull/4207), implementing #4205. #4210 duplicated
that request; it is not another feature to build.

## Human-owned production gates

- Contracting entity and counsel review before the first paid contract: [#4212](https://github.com/AaronBuxbaum/diveday/issues/4212).
- Florida waiver/medical wording and typed-consent review before real use: [#4213](https://github.com/AaronBuxbaum/diveday/issues/4213).
  The current typed-signature provider and indefinite-retention working default stay in place.
- Before the first pilot departure: outdoor/offline manifest V-02 [#4214](https://github.com/AaronBuxbaum/diveday/issues/4214),
  legal/medical operations V-03 [#4215](https://github.com/AaronBuxbaum/diveday/issues/4215), and real-shop
  rehearsal V-04 [#4216](https://github.com/AaronBuxbaum/diveday/issues/4216). Reconcile current gas
  records before V-05; the historical claim that no fill record exists is not a current baseline.
- Native Spanish review before a Spanish-speaking launch: [#4217](https://github.com/AaronBuxbaum/diveday/issues/4217).
- Existing owners remain: billing configuration [#2948](https://github.com/AaronBuxbaum/diveday/issues/2948),
  production deploy gate [#2987](https://github.com/AaronBuxbaum/diveday/issues/2987), agency forms/standards
  #2264/#2829/#2681, and cron operational completion #3838/#3691. Do not duplicate these.

These tickets track work; they do not grant legal, credential, financial or deployment authority.
Policy outcomes and their earlier rationale remain in the [human decision log](../human-decisions/README.md).

## Ideas and historical scope

[brainstorm.md](brainstorm.md) and [ai-ml.md](ai-ml.md) retain unpromoted ideas. The
[roadmap snapshot](../archive/roadmap-20261110.md) retains earlier candidate subsystems, deferred
ideas, design sequencing and measures. Those entries are not newly approved work. Search the
tracker and shipped history before promoting one; create or reuse a concrete issue rather than
reviving a dated checklist.

## Accessibility contrast fixes

<a id="accessibility-contrast-fixes-blocked-on-a-color-guide-decision"></a>

The approved current-palette text work is built in #4211; see
[the shipped entry](../shipped.md#text-contrast-measured-on-the-current-palette-built-2026-11-10)
and [fresh measurements and scope](../../design/text-contrast.md). This is not a WCAG-conformance
claim. No contrast item remains blocked on the former color-guide decision.
