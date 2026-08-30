# Responsive surface review

This is the review record for the 2026-08-30 consistency pass. The companion decision is
[ADR 20260830-responsive-surface-consistency](../architecture/decisions/20260830-responsive-surface-consistency.md).
The design canvases remain dated arguments; this checklist records the behavior the shipped
surfaces must keep.

## Shared contract

- The staff and public chrome use the shared --chrome-h height token.
- The live manifest is a phone-first instrument: no staff dock or staff header competes with roll
  call, and its dock clearance is zero. The deferred offline manifest keeps the staff shell.
- Secondary detail uses CompactDisclosureRow; the summary carries the useful value and the body
  opens in place.
- Repeated records use LedgerRow, InsetGroup, ListItemActions, and buttonClass. Content gets
  min-w-0, names may break, and actions wrap before a surface scrolls.
- Boat Mode uses the shared AmbientContrastControl presentation and the shared drawn
  DiveDayIcon set. State words remain present for color-blind and forced-color readers.
- A table has a phone list counterpart when columns do not need simultaneous alignment.

## Covered pages

| Surface family | Routes reviewed | Phone treatment |
| --- | --- | --- |
| Entry and marketing | /, /sign-in, /onboard, public shop shell | Compact marketing chrome; no duplicate entry descriptions |
| Shop home | /shop/[shopSlug] | First-run and quiet-day states own their hierarchy; next departure and actions wrap |
| Trip surfaces | /trips/[id], /manifest, /prep | Shared trip masthead; roster/list reflow; boat-mode manifest; pickup list at phone |
| Daily operations | /schedule/board, /staffing, /reports | Board controls, skeletons, report facts, and actions remain readable without forced width |
| Staff records | /divers, /courses, /dive-sites | Search/actions wrap; records stay grouped; editor fields and actions stack |
| Settings | /settings/team, /settings/safety-checklist | Languages, emergency details, and list actions are collapsible or wrapped |
| Offline | /offline-manifest | Shared settings group and shell behavior; safety state remains visible |

## Covered states

Review each covered route at 414px, 390px, 768px, and desktop width in both light and dark
schemes. Check:

- loading and skeleton geometry;
- empty and first-run states;
- normal, long-name, translated, and long-value rows;
- success, warning, error, and disabled states;
- keyboard focus and 44px-or-larger touch targets;
- horizontal clipping, unexpected page width, and fixed dock/chrome overlap;
- the live and deferred manifest shells separately.

## Code anchors

The implementation is anchored by the shared disclosure and ledger primitives, the trip masthead,
the live-manifest shell marker, the reports/divers/course/prep reflow rules, and the source-level
tests under src/components, src/app/shop, and src/db. When a new surface introduces a
different treatment for an existing intent, update the ADR and this review record in the same
change.
