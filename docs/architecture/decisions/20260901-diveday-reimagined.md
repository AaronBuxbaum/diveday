# 20260901-diveday-reimagined — Reef for the shop, Harbor for the diver

- **Status:** Accepted — decided 2026-09-01 (Aaron Buxbaum, in session; H-64)
- **Date:** 2026-09-01
- **Scope:** Every surface — the design system, the staff app, the public shopfront, the embeds a shop
  puts on its own website, the marketing pages, and the offer

## Context

The Clearwater language ([20260827-clearwater-surface-language](20260827-clearwater-surface-language.md))
made the product calm, consistent and honest, and the 2026-09-01 interface review found little left
to tidy at the component level. The owner's brief on the same day set a higher bar than tidy:
*"nothing here needs to stay the way it is — I want people to think 'wow' when they're using DiveDay,
and I want potential customers to be easily swayed to join, especially when leaving FareHarbor."*

That is a direction question, not a refinement, and the repo's own rule for a direction question is
to argue it on paper before arguing it in TypeScript ([design-artifacts.md](../../design/design-artifacts.md),
"When a canvas is warranted"). The canvas drew three directions for DiveDay's own face — **Tide**
(editorial daylight), **Deck** (the instrument), **Reef** (warm and alive) — on the same four surfaces
for the same shop on the same day, so they compared like for like.

A second brief the same day asked what a dive shop's identity looks like, and for an embed system to
match FareHarbor's. The research (public dive-shop websites in Key Largo, agency portfolios that build
for dive shops, logo galleries, FareHarbor's public plugin listings — recorded in the canvas README,
nothing copied) found strong, personal shop brands — ocean blue with one warm accent, underwater
photography on every page, a creature for a mark, a wall of badges — and every one of them ends at a
"Book Now" button that hands the diver to a page that looks nothing like the shop. FareHarbor's
answer is a modal over the shop's site plus a hosted website product sold for about $10,000 a year.
The canvas's second page drew **Harbor**: DiveDay wears the shop's brand, not its own.

## Decision

The owner picked on 2026-09-01. Two axes, answered separately, because they are separate questions.

### 1. The staff app wears Reef — with Geist, not Fraunces

Every `/shop/**` surface takes Reef's warmth: the warmer sand ground, the opened lagoon-to-coral
range, the soft panel, the drawn hand, and the three earned moments. **The type does not change.**
Reef as drawn paired Fraunces with Geist; the owner declined the display face because it moves
DiveDay's brand voice too far, so Geist stays the only face on every staff surface, and Reef's
display-scale moments are made with Geist's own weight and size, never a second family.

What lands, and where each rule comes from:

| Rule | Value | Supersedes |
| --- | --- | --- |
| Ground | sand `#fbf7ef`, shell (surface) `#fffdf8`, tideline (sunken) `#f3ecdd`, rope (border) `#e6dcc8`, rope-strong `#8a8065` | Clearwater's `#faf9f6` / `#ffffff` / `#f1efe9` / `#e3e0d7` / `#8a8577` |
| Ink | ink `#0c2a35`, muted `#5b6f77` | unchanged |
| Lagoon | primary `#0e7490`, hover (lagoon-deep) `#0a4d61`, wash (tint) `#dceef0`, and a new decorative **shallows** `#7fd0d6` for water fills that carry no fact | hover `#155e75`; tint was a 10% mix |
| Coral | `#ff6f61`, deep `#a83a2c` as ink on a coral wash `#ffeee9` | unchanged values; the wash is new |
| Signals | success / warning / danger keep their values; each gains a wash (`#e6f0e8`, `#f8eee2`, `#f8e8e6`) as its tint | tints were 10% mixes |
| Radii | control 10 · inset 18 · panel 28 · pill 999 | panel 16 (`rounded-2xl`), control 10 |
| Elevation | a resting panel sits on the **warm bed**, `0 2px 10px rgba(88, 66, 30, 0.06)`; menus, sheets and toasts keep their own lift | Clearwater decision 1 ("a panel at rest is flat"), deliberately, and only for the panel — the header tiles, logos and markers retired in #1228 stay flat |
| Coral budget | three sanctioned appearances per surface, and a harder ban: never a status, never a fill behind reading text, never on a manifest, roll call, cert, waiver or payment surface | Clearwater's one earned moment |
| Illustration | a line-drawn reef and its creatures, one hand, used as a departure's site mark and in the three moments; **no drawing may appear on a manifest, roll call, cert check, waiver or payment surface** | none existed |
| The three moments | the water closing over a departure's finished work; the count that fills as divers come back; the diver's day drawn as a postcard on the recap | Clearwater's earned-moment ration |
| Dark scheme | Reef drew none. The current night palette stays until one is drawn; only the tokens whose *shape* changed (the washes, the radii, the bed) apply in both schemes | — |

The safety floor is untouched: 44px targets, 16px critical text, AA contrast, never colour alone, and
principle 9 in full.

### 2. The diver-facing surfaces wear Harbor — the shop's brand, with whatever it has set

`/s/<slug>/**` and every embed a shop pastes on its own website take the **shop's** brand: its
colour, its mark, one display face it chose from a curated list, its photographs, its badge wall,
its review quotes and its boats. DiveDay is three bubbles and a credit line in the footer. A shop
that has set nothing sees today's storefront in DiveDay's own tokens — the brand layer is an
overlay with a default, never a requirement.

- **What the shop owns** (`shops` gains these, edited in Settings under a new *Brand* group):
  `brand_color` (one hex), `brand_display_font` (one of six curated Google faces, or none),
  `brand_hero_image_url` + alt, `established_year`, and an ordered list of badges chosen from a
  fixed code list (`shop_badges`: PADI 5★, PADI IDC, SSI, NAUI, TripAdvisor, Blue Star, Green Fins,
  DAN partner, Readers' Choice — codes, so they arrive in every language and no logo is drawn that
  DiveDay has no right to show). `logo_url` and `tagline` already exist.
- **The derivation rule** (`src/lib/brand.ts`, pure): the brand colour is checked for 4.5:1 against
  the shop's ground and against white; if it fails as a button fill it is darkened until it passes
  and the storefront says nothing about it; hover is the colour darkened 12%; the tint is an 8% mix
  over the surface (10% until 2026-09-02, when the text-on-tint check joined the rule); ink-on-brand is white or ink by contrast. The result is emitted as the public
  layout's `--primary`, `--primary-hover`, `--primary-tint`, `--primary-foreground` — so every
  existing primitive re-skins with no per-component work.
- **Amended 2026-09-02 — one colour, two derivations** (issue #1265). The rule above describes the
  *light* scheme, and until this date it was the only one that ran: `BrandStyle` emitted a single
  `:root` block, which — rendering after globals.css, where a media query adds no specificity — won
  in **both** schemes. So a colour derived to read on sand went to the dark ground unchanged, and by
  construction it cannot read there: the demo shop's green derives to `#13795a`, measuring 3.39:1 on
  `--background #071720` and 3.05:1 on `--surface #0d222d`. DiveDay's own lagoon `#0e7490` measures
  3.40 / 3.05, which is why the dark palette carries its own `--primary: #22d3ee` at 10:1 — every
  branded shop was giving that up. `deriveDarkBrandTheme` runs the same rule with every polarity
  flipped: lighten toward white rather than darken toward black, prefer ink on the fill rather than
  white, and check **both** dark surfaces, because at depth the shell is the lighter of the two and
  so the binding one. `BrandStyle` emits it as a second block under
  `@media (prefers-color-scheme: dark)`, which is the whole mechanism available — `data-theme`
  appears nowhere in globals.css. **Not a per-shop dark picker**: a shop chooses one colour and
  DiveDay is responsible for it reading in both schemes. The three class-scoped skins that redeclare
  `--primary` — boat mode, glare mode, print — still out-specify both blocks, which is right; each
  is a deliberate override for a reader who asked for it.
- **The display face** labels headings only — the shop's name, a section title, the trip's title.
  Every fact (a time, a price, a seat count, a state, a control) stays in Geist and in ink.
- **Where the brand may never go**: the waiver text, the payment step, any status, the manifest,
  roll call, cert check — those keep DiveDay's tokens whatever the shop chose.
- **The embeds**: one loader, `/embed.js`, and one `data-diveday` element per widget. The catalogue:
  **button** (a link in the shop's colour), **lightbox** (the booking page in an overlay sheet over
  the shop's site; payment still opens the real page, stated), **calendar** (the inline week ledger),
  **grid** (trips and courses as cards), **one departure** (a card for a blog post), **courses** (a
  list), **QR code** (for the counter and the boat), **partner link** (a referral URL for a hotel or
  resort). Each is chosen in Settings → Website embed from what it shows (everything, one departure,
  one course, a named set), how it looks (**inherit the host page** — the loader reads the page's
  font and link colour and passes them to the frame — or DiveDay light or dark) and which language
  (follow the visitor's browser, or fixed). The snippet is the same HTML on every platform;
  WordPress, Squarespace and Wix get their own instructions, not their own code. This amends
  [20260726-schedule-embed](20260726-schedule-embed.md), which rejected a script loader when the
  only embed was one iframe; a catalogue of eight is what a loader is for.

### 3. The offer gains a hosted website, built to order

Alongside Harbor's storefront — which is already a website a shop can point a domain at — DiveDay
offers **a website, built for you**: a shop asks, and DiveDay builds it for them (with Claude, when
someone asks; nothing is built ahead of a request). It is an **authorized service offer** under the
marketing claims policy, not a product feature: phrased as a human commitment, never a turnaround
time, never a page-count. It appears on `/pricing`, `/product` and the FareHarbor guide, priced as
part of the subscription until the owner says otherwise (H-65 asks). FareHarbor's equivalent is a
$10,000-a-year line item, and that comparison may be stated as the number they publish, never as
the shop's own cost.

### 4. What does not change

The name and the bubble mark, the divemaster's voice, the door order (the demo leads, the trial
follows — [marketing.md](../../product/marketing.md), 2026-08-22), the single-sourced price, the
claims policy, and every safety surface's vocabulary.

## Slices

Sequenced so the tokens land before anything that reads them, and the shop's brand settings before
the surfaces that wear them. Each slice ends with the standing obligation: the component that must
not drift names this ADR in its doc comment, and a test pins the rule. The canvas README's slice
table is the record of which have landed.

| Slice | What | Depends on |
| --- | --- | --- |
| 13a | Reef's tokens for the staff app: ground, lagoon, washes, radii, the warm bed, `shallows`; `SectionCard` at 28px on the bed; brand.md updated | — |
| 13b | The shop's brand: schema (`shops` columns + `shop_badges`), `src/lib/brand.ts` (derivation, curated faces, badge codes), the Settings *Brand* group, the demo shop seeded with a brand | — |
| 13c | Harbor's storefront: the public layout emits the brand tokens; hero photo, badge wall, review quotes, boats, established year, the credit line; embed mode inherits | 13b |
| 13d | The embed catalogue: `/embed.js`, the widget views (`calendar`, `grid`, `departure`, `courses`) under `/s/<slug>/embed/*`, host-inherit look, the lightbox, the QR code, the partner link; Settings → Website embed as the generator; the embed ADR amended | 13c |
| 13e | The offer: `/pricing`, `/product` and the FareHarbor guide say Harbor, the embeds and the built-to-order website; the switching page's mapping ledger | 13d |
| 13f | Reef's site mark: each departure's marker on the home and the board is a drawn site mark, the illustration set's first use | 13a |
| 13g | The water closes over finished work: a station's rows settle into one warm sentence when its last blocker clears | 13a, 13f |
| 13h | The count that fills: roll call's head count raises the water as divers are counted back; "All home" is the word, the fill is decoration | 13a |
| 13i | The diver's day, drawn: the recap becomes a postcard in the shop's brand with the site in the illustration hand | 13c, 13f |
| 13j | The night palette for Reef, drawn and applied | 13a |

## Alternatives considered

- **Refine Clearwater further.** Rejected: the review that preceded this found the remaining gaps
  mechanical, and mechanical fixes do not produce "wow". They shipped separately (#1225–#1228).
- **Tide or Deck for the staff app.** Not chosen: the owner's read was that Reef is the one that
  feels like the water the product is about; Deck's severity and Tide's air were the costs named on
  the canvas, and both stand as the dated argument.
- **Reef with Fraunces.** Declined by the owner: the display face moves DiveDay's brand voice too far
  for a product whose brand is "calm competence". Geist stays.
- **DiveDay's brand on the diver's screen.** Rejected by the research: the shops' identities are the
  asset, and every competitor spends them at the button.
- **Build the hosted website product.** Rejected: nothing is built ahead of a request. The storefront
  already is a website; the offer is a person who will make a fuller one when asked.
- **Keep a single iframe as the whole embed story.** Rejected: FareHarbor's shops arrive expecting a
  catalogue, and one loader serving eight widgets is less to maintain than eight snippets.

## Consequences

- The token layer changes first and every staff surface inherits it in one release; the visual
  baseline moves on essentially every capture, and 13a's pull request explains that as the direction
  landing, family by family.
- The panel regains a shadow. That is a reversal of Clearwater decision 1 for exactly one element
  and it is written here so the next reader does not "fix" it back.
- The storefront becomes conditionally the shop's: a shop with an ugly brand gets an ugly
  storefront, and DiveDay's own brand is a footer line to divers. That is the point and a marketing
  cost the owner accepted.
- A script loader is a maintained surface with a compatibility promise: a snippet a shop pasted must
  keep working, so `embed.js`'s data attributes are a contract with a test.
- Two directions' worth of artboards and Harbor's alternates stay on the canvas as the dated argument
  and are never freshened.
