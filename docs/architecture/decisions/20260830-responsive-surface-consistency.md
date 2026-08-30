# 20260830-responsive-surface-consistency — Responsive surface consistency

- **Status:** Accepted
- **Date:** 2026-08-30
- **Owners:** Product and design
- **Scope:** Staff and diver-facing surfaces

## Context

The design canvases cover the same working surfaces at wide and phone widths, but several
implementations let content compete horizontally instead of changing composition. The result was
especially visible at iPhone Air width: secondary staff details expanded every roster row, tables
forced a wide scan, and controls that represented the same intent acquired different geometry on
different pages. Languages and emergency contacts in Team, Boat Mode controls in the manifest and
offline manifest, and the Divers and Reports lists were the clearest examples.

A phone is not a clipped desktop. A staffer on a dock needs the same facts and actions, with less
reach and less visual competition. The responsive treatment therefore belongs to the surface
contract, not to one page's incidental Tailwind classes.

## Decisions

### Secondary detail is a disclosure

Details that are useful for editing or reference but not for the first scan are collapsed into a
compact, accessible disclosure row. The summary is a label plus a truncated or wrapped value; the
body opens in place and keeps the same form action. This applies to Team languages, emergency
contacts, per-device manifest settings, and equivalent secondary panels. A saved notice may reopen
the relevant row so the result of an action remains visible.

The summary is never used to hide a safety state, payment state, waiver state, or other fact the
reader needs to make the current decision. Those facts stay in the row or the page header.

### Lists reflow before they scroll

A repeated record remains a ledger row. At phone widths, its primary content owns the line, long
names break at words, and trailing actions wrap below or to a second line. A table that has no
essential column relationship becomes a compact list with the same facts; a table that does need
alignment stays available at larger widths. Horizontal scrolling is reserved for genuinely
relational data, not used as a blanket response to insufficient space.

The shared row primitives own this geometry so Divers, Courses, Reports, safety checklist items,
prep pickup rows, and first-run rows do not invent competing phone grammars.

### Shared intent uses shared geometry

Controls with the same intent share the same button, disclosure, status-mark, icon, and spacing
primitives. Boat Mode is one three-state contrast control wherever it appears. Navigation chrome
uses one height token; the live manifest's phone surface hides the staff dock and staff header, while
the deferred offline manifest keeps the staff shell. Emoji and standalone platform-dependent marks
do not carry state.

### Phone is a first-class state

The review target is 414px wide (iPhone Air), with 390px retained as the narrow regression case,
then tablet and desktop widths. Every page must preserve readable hierarchy, 44px-or-larger
interactive targets, visible focus, keyboard access, and semantic words for color-coded states in
light and dark mode. Loading, empty, error, and long-content states are part of the same review.

## Alternatives considered

- Keep independent per-page cards and controls: rejected because equivalent intent drifts in
  geometry and requires readers to relearn the interaction.
- Hide columns on narrow screens: rejected because it silently removes facts from staff work.
- Make every table horizontally scroll: rejected because it makes the primary record and action
  compete off-screen and performs poorly for one-handed scanning.
- Treat the phone as a clipped desktop: rejected because it preserves desktop spacing while
  sacrificing reach, hierarchy, and readable content.

## Consequences

The app has a small set of responsive contracts that can be reviewed and tested mechanically:
compact disclosure rows, stacked ledger rows, wrapped list actions, and shared controls. Components
need deliberate min-w-0 boundaries and explicit phone compositions, but individual pages no
longer need to solve the same width problem independently.

The live manifest is intentionally a full-viewport exception on a phone. Its staff chrome and dock
do not consume roll-call space; the separately routed offline manifest remains in the staff shell
until it receives its own surface slice. Design artifacts remain illustrative, while this decision
and the companion review checklist are the normative record for responsive behavior.
