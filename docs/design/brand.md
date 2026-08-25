# DiveDay brand and voice

This is the working brand guide for DiveDay. It records the identity that exists in the product
today so agents, collaborators, and vendors can make consistent choices without inventing a new
look for each surface. It covers product UI, public copy, internal collateral, and physical merch.

This is a current-state guide, not a promise that every future brand decision is settled. If a new
direction is proposed, label it **proposed** and get product-owner approval before treating it as
the DiveDay brand.

## The brand in one sentence

**DiveDay is a calm, capable companion for the whole dive day — from booking to head count.**

The product should feel like a good divemaster's briefing: prepared, clear, warm, and never
performing for its own sake.

## Brand foundations

| Foundation | What it means | What it rules out |
| --- | --- | --- |
| Calm competence | Reduce noise and make the next useful action obvious. | Busy dashboards, frantic language, decorative complexity. |
| Trust at the dock | Be exact when a boat, certification, waiver, or roll call depends on the answer. | Vague reassurance, color-only status, invented certainty. |
| Earned delight | Use warmth and color for real moments of progress: a booking, a signed waiver, a completed roll call. | Turning every screen into a celebration. |
| Human freedom | The shop owns its records and can leave with them. | Lock-in language, pressure tactics, exaggerated promises. |
| Dive-native, not costume | Use real dive language when it helps, with respect for the work. | Puns everywhere, mascot voice, generic “adventure” clichés. |

The product vision and the testable interaction rules live in [product/vision.md](../product/vision.md)
and [principles.md](principles.md). This guide translates those rules into identity choices.

## Name and mark

### Name

- Write the name as **DiveDay**: one word, capital D and capital D.
- Do not write `Dive Day`, `diveday`, or `DiveDay™`.
- A period may appear as a visual flourish in a lockup (`DiveDay.`), but it is not part of the
  product name and should not be added to ordinary prose.
- When the product acts on someone's behalf, it may be the actor: “DiveDay will catch up when
  you're back in service.” Otherwise, let the shop and the user's work stay in the foreground.

### Bubble-trail mark

The current mark is three ascending bubbles. It suggests a calm, controlled ascent: one large
bubble, one smaller bubble, and one small coral bubble. The mark is implemented as
`LogoMark` in `src/components/Logo.tsx`.

Use the mark as a simple, recognizable signal:

- Keep the bubbles ascending from lower-left to upper-right.
- Keep the smallest/top bubble coral.
- Let the other bubbles inherit the surrounding color where possible; on a dark or solid lagoon
  background they may be white or a very light ink.
- Preserve the mark's proportions. Do not stretch it, rotate it, add a drop shadow, or redraw it
  as a generic scuba icon.
- Give it breathing room. At minimum, keep one small-bubble diameter of clear space around it;
  use more space when the mark is next to a wordmark.
- Do not use the mark to imply certification, safety approval, or an agency relationship.

**On a surface that belongs to a shop, the mark is a credit, not a headline.** A shop's public
schedule and its departure pages are the shop's own work, and so are the link-preview cards they
unfurl to when the shop posts one. Those cards led with the DiveDay wordmark at display scale and
closed with DiveDay's tagline — on the departure card, spliced onto the shop's own "3 spots left"
with a middot, so the two read as one claim (issue #810). The shop's name leads now; DiveDay is a
half-size mark and a 22px muted name at the foot, the way a venue's name sits on a ticket
(`ogCredit` in `src/app/_og/card.tsx`).

The tagline stays on DiveDay's *own* cards — the marketing root and anything else where DiveDay is
the subject. It never rides along inside a customer's social post, where the reader has no idea
what DiveDay is and no reason to care. The general rule is the one in **Voice** below: the product
may be the actor when it acts on someone's behalf, and otherwise the shop's work stays in the
foreground.

**The staff app is the shop's operational tool, wearing the shop's identity.** In the staff header
(`ShopNav` / `ShopIdentityMenu`), the shop's own logo — or its initials fallback in the primary square
when no logo is uploaded — leads the masthead beside the shop's name. A shop runs its whole day inside
DiveDay and should see its own identity leading the workspace rather than a permanent vendor mark.

There is currently no separate production-ready wordmark asset in `public/`. For a vendor proof,
use the mark with the word `DiveDay` set in Geist Semibold, or request a vector lockup derived from
the implementation. Do not send a screenshot of the website as the artwork.

## Color system

The product's source of truth is the semantic token set in `src/app/globals.css`, governed by
[ADR-0004](../architecture/decisions/0004-design-tokens.md). The table below makes the current
palette usable outside the app; the hex values are intentionally recorded here for print, textile,
embroidery, and vendor conversations.

### Core identity colors

| Color | Light value | Dark value | Role | Merch guidance |
| --- | --- | --- | --- | --- |
| Sunlit sand | `#FAF9F6` | — | Light background; warm, open, tactile. | Best garment or paper ground for a light application. |
| Open ocean | — | `#071720` | Dark background; deep, quiet, dependable. | Best dark garment, hat, tote, or sticker ground. |
| Deep-sea ink | `#0C2A35` | `#E9F3F4` | Primary reading color: grounded dark ink in light mode, soft light ink in dark mode. | Use the contrasting value for the wordmark and longer copy. |
| Lagoon | `#0E7490` | `#22D3EE` | Action color and primary brand signal. | Main imprint color on sand or ocean; use the darker light-mode value on light goods. |
| Lagoon hover/depth | `#155E75` | `#67E8F9` | Darker or brighter lagoon variant for contrast and depth. | Use sparingly for a two-tone mark or secondary imprint. |
| Coral | `#FF6F61` | `#FF8A7E` | Rare warm accent; the smallest bubble and earned moments of joy. | One small accent only: bubble, stitch, dot, or detail. Never make the whole item coral by default. |

### Supporting colors

| Token family | Current purpose | Brand use |
| --- | --- | --- |
| Surface / sunken surface | Quiet hierarchy between cards, pages, and recessed areas. | Optional background neutrals for paper, packaging, and layout; do not turn them into extra brand colors. |
| Border / strong border | Structure and control affordances. | Use for physical rules or labels only when needed; the brand is not a framed-box system. |
| Success / warning / danger | Operational feedback. | Keep these out of general merch and promotional art. They signal state, not identity. |

Color rules:

- The primary pairing is **lagoon + sand** or **lagoon + open ocean**.
- Coral is a punctuation mark, not a field color. It should usually occupy less than 10% of a
  composition.
- Never use safety colors as decoration or rely on color alone to communicate a status.
- For product UI, use semantic token names rather than raw values or palette-scale classes. For
  physical production, use the values above as the starting point and approve the vendor's actual
  ink, thread, vinyl, or textile swatch because substrates change color.
- A vendor's “close enough” teal is not automatically DiveDay teal. Ask for a proof on the actual
  garment or material.
- **Outbound email carries both columns literally.** A message cannot reach the tokens, so
  `wrapEmailHtml` (`src/lib/notifications/email.ts`) writes the light values inline and the dark ones
  — open ocean, deep-sea ink's dark value, dark lagoon — in the single `@media
  (prefers-color-scheme: dark)` block in its `<head>`. Both halves move together: the document
  declares `color-scheme: light dark`, which is a promise that it renders correctly in both and stops
  Apple Mail and Outlook inverting it themselves, so a colour added to an email in light only lands
  as unread dark-on-dark in somebody's inbox rather than merely off-brand (issue #771).

## Typography

The current product type system is:

| Use | Typeface | Weight / treatment |
| --- | --- | --- |
| Headings, labels, body copy, wordmark | **Geist Sans** | Regular for reading; Medium/Semibold for hierarchy. Keep tracking restrained. |
| Data, timestamps, credentials, technical utility | **Geist Mono** | Use only where fixed-width reading helps. It is not a display face. |
| Fallback | `system-ui`, sans-serif | Only when Geist is unavailable; do not substitute a script, condensed, retro, or novelty face. |

Typography should feel modern, open, and quietly capable:

- Prefer short lines, generous leading, and clear hierarchy over oversized display type.
- Use weight and spacing to organize information; do not use all caps as the default voice.
- For merch, use Geist Semibold for `DiveDay` and Geist Regular or Medium for a short supporting
  line. Keep the mark and wordmark legible at the actual decoration size.
- Do not use Geist Mono for a slogan, and do not mix in a second “dive” font to make merch feel
  more nautical.

## Visual language and concepts

The visual world is **sunlit sand above the surface and open ocean at depth**. It is tactile,
spacious, and gently in motion.

Good recurring concepts:

- ascending bubbles and buoyancy;
- gentle arcs, routes, and return paths;
- coral as a small living detail, not a loud pattern;
- dock-to-boat preparation: a clipboard made calm, a head count made clear;
- daylight, open water, and honest visibility;
- rounded forms, soft corners, and enough negative space to breathe.

Use real dive context when imagery is needed: a calm briefing, a hand on a boat rail, a diver
preparing gear, a reef with room around it, or a readable phone in daylight. Avoid generic extreme-
sports imagery, dark danger shots, distressed nautical textures, pirate motifs, anchor clichés, and
stock-photo grins that make the product feel like a tourism ad.

The design should be “gentle and nice,” never pointy or aggressive. Motion, routes, and decorative
lines should have a destination or explain a change; they should not wiggle for attention.

## Voice

### Voice attributes

| We sound like | We do not sound like |
| --- | --- |
| A competent divemaster giving a clear briefing | A lawyer hiding the answer in caveats |
| Warm and plainspoken | Cute, mascot-like, or full of forced puns |
| Precise where safety or money is involved | Overconfident or vague |
| Lightly playful when a real moment is complete | Loud, breathless, or celebratory all the time |
| Helpful about the next action | A software vendor talking about “solutions” and “platforms” |

Copy rules:

- Lead with the person's outcome: “Know who is ready before the boat leaves,” not “Advanced
  manifest orchestration.”
- Prefer concrete nouns: shop, counter, booking, waiver, card, boat, diver, head count.
- Use verbs on controls: “Add diver,” “Mark certified,” “Refresh now,” “Send waiver.”
- Keep errors calm and actionable: say what happened and what the person can do next.
- Teach an empty state instead of apologizing for it.
- Use real dive terms correctly; see [product/glossary.md](../product/glossary.md).
- Keep implementation language out of customer-facing copy. Say “saved on this phone” instead of
  “encrypted local snapshot,” and “checked again when you're back in service” instead of
  “reconciled.” The one page that may name the protection is `/privacy`, where what guards a
  shop's divers' data is the reader's own question rather than a capability being sold — see
  [principles.md](principles.md) §4.
- Never invent proof, customer counts, testimonials, certifications, or superlatives.

### Before / after examples

| Avoid | Prefer |
| --- | --- |
| “DiveDay is an all-in-one dive operations platform.” | “Run the whole dive day, from booking to head count.” |
| “No records found.” | “No trips yet — schedule your first charter.” |
| “Submit” | “Add diver” / “Save trip” / “Send waiver” |
| “Sync failed.” | “This phone could not refresh. Try again while you have service.” |
| “Our best-in-class solution.” | “A calmer way to run a dive day.” |

### Marketing boundary

Public and sales copy follows the full claims policy in [product/marketing.md](../product/marketing.md):
shipped-only, truthful, no fabricated proof, and no price literals outside the marketing source of
truth. Brand consistency never gives permission to make a claim the product cannot demonstrate.

## Merch buying brief

When buying shirts, hats, stickers, totes, cards, or other physical goods, start with one of these
combinations:

| Item | Ground | Artwork | Suggested copy |
| --- | --- | --- | --- |
| Primary dark shirt or hoodie | Open ocean | Lagoon mark/wordmark, white or light-ink wordmark, one coral bubble | `DiveDay` on front; optional back line: “A calmer way to run a dive day” |
| Light shirt or tote | Sunlit sand | Deep-sea ink wordmark, lagoon mark, one coral bubble | `DiveDay` or `DiveDay · from booking to head count` |
| Cap or small sticker | Lagoon | Light-ink bubbles with one coral bubble | Mark alone or `DiveDay` beside it |
| Small paper insert or thank-you card | Sand or white | Deep-sea ink body, lagoon heading, coral detail | One warm sentence and one useful next step |

Production defaults:

- Prefer one- to three-color decoration. A clean two-color mark will usually outlast a complex
  print.
- Use embroidery only when the vendor can preserve the three bubbles and the coral detail at the
  finished size; otherwise use a screen print, transfer, or woven patch with a proof.
- Avoid gradients, bevels, outlines added by the vendor, distressed effects, faux stitching, and
  extra nautical symbols.
- Do not make coral the main garment color unless a specific campaign has approved it. Coral is
  strongest as a small surprise.
- Request a physical or on-material proof. Check the smallest bubble, the wordmark at arm's length,
  contrast in daylight, and whether the colors still feel calm rather than neon.
- Keep slogans short. The default line is “A calmer way to run a dive day”; do not improvise a
  stronger claim such as “the world's best dive software.”
- Never order from a vendor proof that changes the name, stretches the mark, or substitutes a
  novelty typeface without review.

### Vendor proof checklist

- [ ] Name is `DiveDay` and is spelled correctly.
- [ ] Bubble trail ascends lower-left to upper-right.
- [ ] Smallest/top bubble is coral.
- [ ] Mark is not stretched, rotated, shadowed, or crowded.
- [ ] Artwork uses lagoon, sand/ocean, ink, and a restrained coral accent.
- [ ] Wordmark is Geist-like and readable at the finished size.
- [ ] Contrast works on the actual garment or material in daylight.
- [ ] No feedback colors, fake claims, agency logos, or unexplained symbols were added.
- [ ] A product owner has approved the final proof before purchase.

## Source map and maintenance

| Question | Source |
| --- | --- |
| What DiveDay exists to do | [product/vision.md](../product/vision.md) |
| What delight means in the interface | [principles.md](principles.md) |
| Current semantic colors and motion tokens | `src/app/globals.css` and [ADR-0004](../architecture/decisions/0004-design-tokens.md) |
| Current fonts | `src/app/layout.tsx` |
| Current bubble-trail mark | `src/components/Logo.tsx` |
| Public positioning and claims | [product/marketing.md](../product/marketing.md) |
| Domain words | [product/glossary.md](../product/glossary.md) |

Update this guide in the same change when the name, mark, font, token palette, positioning, or
voice rules change. If a merch request needs a new color, typeface, logo variant, or campaign line,
record it as proposed first; do not silently expand the permanent brand.
