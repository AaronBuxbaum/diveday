# 20260901-diveday-reimagined — Choose one bold direction for the whole product

- **Status:** Proposed — three directions drawn, the pick pending
- **Date:** 2026-09-01
- **Scope:** Every surface — the design system, the staff app, the public shopfront, the marketing pages

## Context

The Clearwater language ([20260827-clearwater-surface-language](20260827-clearwater-surface-language.md))
made the product calm, consistent and honest, and the 2026-09-01 interface review found little left
to tidy at the component level. The owner's brief on the same day set a higher bar than tidy:
*"nothing here needs to stay the way it is — I want people to think 'wow' when they're using DiveDay,
and I want potential customers to be easily swayed to join, especially when leaving FareHarbor."*

That is a direction question, not a refinement, and the repo's own rule for a direction question is
to argue it on paper before arguing it in TypeScript ([design-artifacts.md](../../design/design-artifacts.md),
"When a canvas is warranted"). Committing to one aesthetic without the owner's pick is how a product
gets a generic face, so the canvas draws three genuinely different directions and this record holds
the decision open until one is chosen.

## Decision (proposed)

Draw three directions on one canvas, each redrawing the same four surfaces for the same shop on the
same day so they compare like for like: the design system sheet, the staff shop home on the morning
of the fiction's day, the public storefront a diver books from, and the page a shop reads when it is
leaving FareHarbor.

| Direction | Axis | The bet | The tradeoff it must answer |
| --- | --- | --- | --- |
| **Tide** | Editorial daylight | Big, confident display type; generous space; sunlit sand and lagoon; drawn water forms. The wow is restraint plus one perfect earned moment. | Restraint asks the most of every sentence and gap; a dense counter morning must stay legible without chrome. |
| **Deck** | The instrument | The product speaks the grammar of the boat's own instruments: large tabular figures lead, dark-at-depth is the default scheme, structure is hairline and dense. The wow is speed and legibility on a wet deck. | Precision can read as cold to a diver booking a holiday; the storefront has to be warmer than the console without becoming a second product. |
| **Reef** | Warm and alive | A fuller lagoon-to-coral range used with intent, soft forms, a line-drawn reef and its creatures as an illustration system, moments that feel like a good day on the water. | Personality drifts toward mascot; the safety surfaces stay exact and the illustration rule says where a drawing may never appear. |

Every direction keeps what is not a matter of taste: the name and the bubble mark
([brand.md](../../design/brand.md)), the divemaster's voice, the dock test (44px targets, readable
in glare, never colour alone for a status — [principles.md](../../design/principles.md) §2 and §6),
the coral discipline in spirit (each direction may argue its own budget, in writing), and the
marketing claims policy ([marketing.md](../../product/marketing.md)): nothing on a marketing board the
demo cannot do today.

**What the pick decides.** When the owner chooses a direction this record moves to **Accepted**,
names the chosen direction, and gains the decisions the pick implies — the type pairing, the palette
and token changes, the elevation and radius rules, the illustration rule (or its absence), the coral
budget, and which Clearwater decisions survive. The unchosen directions stay on the canvas as the
dated argument. Implementation then proceeds as slices in the canvas README's slice table, tokens
first (so every surface moves together), then the staff app, the storefront, and the marketing pages,
each slice pinned by a test that names this ADR.

## Alternatives considered

- **Refine Clearwater further.** Rejected for this decision: the review that preceded it found the
  remaining gaps mechanical (a chevron, a search box, a caption), and mechanical fixes do not produce
  "wow". They shipped separately (#1225–#1228) so this decision starts from a clean base.
- **Pick a direction without asking.** Rejected: an aesthetic chosen by the agent is the one most
  likely to be generic, and the owner is the one person whose taste this product has to carry.
- **One direction, three surfaces.** Rejected: a single candidate cannot be judged; three candidates
  on the same four surfaces can.

## Consequences

Until the pick, nothing in code changes on this decision's account and the canvas is illustrative.
After the pick, the token layer changes first and every surface inherits it in one release; the
existing visual-regression baseline will move on essentially every capture, and the slice that moves
tokens explains that in its pull request as the direction landing. Two directions' worth of artboards
become the dated argument and are never freshened.
