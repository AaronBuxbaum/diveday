# Roadmap

Direction only, reconciled 2026-11-10. **GitHub issues are the work queue**: scope, claims and
status live there, and this page does not copy them. A draft PR is work in review, not proof of
delivery or production activation.

## Where we are

The five pillars and substantial follow-ons are built. Boats, private charters, participant types,
per-seat checkout, seat claims, expiring group holds with an organizer ledger, the read API and
webhooks, counter rentals and gas records exist. Do not rebuild them from an older document's
missing-feature description. See [shipped.md](../shipped.md), the current code and the relevant ADR
before proposing a delta.

Contextual home-screen entry is built; see [its shipped record](../shipped.md#contextual-home-screen-entry-built-2026-11-10).

Aaron confirmed on 2026-11-10 that there are no shops or pilot partners yet. He did not impose a
pilot-only engineering boundary: UX and design exploration and polish remain wanted, and a change
may be as large or as breaking as it needs to be. Keep public claims within
[marketing.md](../marketing.md); website work is a discussion, not an included custom-build promise.

## Where to look for work

- **Open work and its acceptance:** [open issues](https://github.com/AaronBuxbaum/diveday/issues).
  Production gates only a human can clear (legal review, credentials, billing, real-shop
  rehearsals, native Spanish review) carry the `human-task` label.
- **Decisions already made:** the [human decision log](../human-decisions/README.md). A policy
  outcome and its rationale live there, not in an issue.
- **Ideas:** filed as issues with the `idea` label, which keeps them out of the triage inbox and
  the work queue until you relabel one. The old brainstorm is archived in
  [brainstorm-20261110.md](../archive/brainstorm-20261110.md); how the Claude assists work is in
  [claude-assists.md](../../engineering/claude-assists.md).
- **Earlier candidate subsystems, sequencing and measures:** the
  [roadmap snapshot](../archive/roadmap-20261110.md). Its entries are history, not approved work.
  Search the tracker and shipped history before promoting one.

These tickets track work; they do not grant legal, credential, financial or deployment authority.

## Promote an idea once

Search current code, issues and PRs before filing. Preserve the human's actual decision; an audit
recommendation is not approval. Reuse an existing issue, or file a narrowly scoped one (an `idea`
when it is not yet ready to work) with acceptance and verification. Follow
[the issue workflow](../../agents/issue-tracker.md).

The old persona story backlog and participant-type plan are [archived](../archive/README.md):
participant types shipped, and the old minimum-age proposal was superseded by the recorded
[minimum-age policy](../human-decisions/H-20260724-minimum-age-gate-fail.md) and
[birth-date decision](../human-decisions/H-20260730-minimum-age-gate-data.md). Do not reopen either
from an old missing-feature description.

## Accessibility contrast fixes

<a id="accessibility-contrast-fixes-blocked-on-a-color-guide-decision"></a>

The approved current-palette text work is built; see
[the shipped entry](../shipped.md#text-contrast-measured-on-the-current-palette-built-2026-11-10)
and [fresh measurements and scope](../../design/text-contrast.md). This is not a WCAG-conformance
claim. No contrast item remains blocked on the former color-guide decision.
