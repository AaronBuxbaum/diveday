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
bubble, one smaller bubble, and one small amber bubble. The mark is implemented as
`LogoMark` in `src/components/Logo.tsx`.

Use the mark as a simple, recognizable signal:

- Keep the bubbles ascending from lower-left to upper-right.
- Keep the smallest/top bubble amber.
- Let the other bubbles inherit the surrounding color where possible; on a dark or solid sea teal
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
use the mark with the word `DiveDay` set in Plex Sans Semibold, or request a vector lockup derived from
the implementation. Do not send a screenshot of the website as the artwork.

## Color system

> **Direction change, 2026-10-01 (H-91, ADR 20261001-logbook).** The staff app and the default
> storefront move to **Logbook**: paper with a faint sea-green cast, slate ink, one sea-teal action
> color and a rare marine-amber accent, with a designed deep-slate dark scheme. The roll call wears
> **Boat mode** (Night Dive): navy and marine safety yellow in both schemes. Diver-facing surfaces
> still wear the **shop's** brand color, with these tokens as the default for a shop that has set
> none. The values below are the tree.

The product's source of truth is the semantic token set in `src/app/globals.css`, governed by
[ADR-0004](../architecture/decisions/0004-design-tokens.md). The table below makes the current
palette usable outside the app; the hex values are intentionally recorded here for print, textile,
embroidery, and vendor conversations.

### Core identity colors

| Color | Light value | Dark value | Role | Merch guidance |
| --- | --- | --- | --- | --- |
| Paper | `#F4F6F4` | — | Light background; the page a logbook is written on. | Best garment or paper ground for a light application. |
| Deep slate | — | `#0F171C` | Dark background; quiet and dependable. | Best dark garment, hat, tote, or sticker ground. |
| Slate ink | `#16232C` | `#E4EBEF` | Primary reading color. | Use the contrasting value for the wordmark and longer copy. |
| Sea teal | `#0B6E8A` | `#4FBCD8` | Action color and primary brand signal. | Main imprint color on paper or slate. |
| Sea teal, deep | `#08566C` | `#7FD0E4` | Hover and depth. | Use sparingly for a two-tone mark. |
| Marine amber | `#D97A1E` | `#F0A24A` | Rare warm accent; the smallest bubble. Its wash (`#FBEFE0` / `#33240F`) is the bed it sits on; its deep (`#8A4A0C` / `#F6C27F`) is ink on that wash. Never a status. | One small accent only. |
| Safety yellow (Boat mode) | `#FFD23F` on navy `#0A141C` | same | The roll call's one action color, in both schemes. | Not a merch color. |

### Supporting colors

| Token family | Current purpose | Brand use |
| --- | --- | --- |
| Surface `#FFFFFF` / sunken `#EAEDEA` (dark `#162129` / `#0B1216`) | Groups and wells; a resting panel is set off by a hairline and a 12px corner, not a lift. | Optional neutrals for paper and packaging. |
| Border `#DDE2DF` / border-strong `#78838A` | Hairlines between rows; form control edges (≥3:1). | Physical rules only when needed. |
| Success / warning / danger | Operational feedback, each with a drawn wash in both schemes (by day `#E2F2E8` / `#FBEFDC` / `#FBE6E7`, at night `#123022` / `#33280F` / `#3A191C`). | Keep out of merch and promotional art. They signal state, not identity. |

Color rules:

- The primary pairing is **sea teal + paper** or **sea teal + deep slate**.
- In the product itself, amber's every sanctioned appearance is one table — **the amber budget**,
  [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md)
  decision 11: earned, transient moments only, at most one per surface — plus, since Reef
  (2026-09-01), the drawn hand's single warm detail beside it — and a new one takes a table row in
  the same change. Brand and collateral work follows the same instinct at its own
  scale; the budget is the register to check before putting amber anywhere a shop will see daily.
- Amber is a punctuation mark, not a field color. It should usually occupy less than 10% of a
  composition.
- Never use safety colors as decoration or rely on color alone to communicate a status.
- For product UI, use semantic token names rather than raw values or palette-scale classes. For
  physical production, use the values above as the starting point and approve the vendor's actual
  ink, thread, vinyl, or textile swatch because substrates change color.
- A vendor's “close enough” teal is not automatically DiveDay teal. Ask for a proof on the actual
  garment or material.
- **Outbound email carries both columns literally.** A message cannot reach the tokens, so
  `wrapEmailHtml` (`src/lib/notifications/email.ts`) writes the light values inline and the dark ones
  — deep slate, slate ink's dark value, dark sea teal — in the single `@media
  (prefers-color-scheme: dark)` block in its `<head>`. Both halves move together: the document
  declares `color-scheme: light dark`, which is a promise that it renders correctly in both and stops
  Apple Mail and Outlook inverting it themselves, so a color added to an email in light only lands
  as unread dark-on-dark in somebody's inbox rather than merely off-brand (issue #771).

## Typography

> **Settled 2026-10-01 (H-91, ADR 20261001-logbook):** IBM Plex Sans is the face on DiveDay's own
> surfaces, with IBM Plex Mono for fixed-width utility. Boat mode (the roll call) sets Atkinson
> Hyperlegible, a face drawn for legibility. A shop's storefront may carry the shop's own display
> face for headings only, never for a fact.

> **Settled 2026-09-10 (#1367):** the apostrophe is `’` (U+2019) everywhere a person reads it — every
> message bundle, every locale, every route's `metadata` literals. The straight `'` survives only
> inside an ICU-quoted span (`'{depth18}'`, `'{{1}}'`), where it is what makes the span a literal
> rather than punctuation. Both spellings had been landing since the bundles existed and neither
> looks wrong on screen; `pnpm check:voice` now refuses the straight one, because Playwright matches
> the two as different strings and every e2e spec hard-codes its English.

> **Settled 2026-09-16 (#1664):** quotation marks are `“ ”`, never `"`, in every message bundle and
> every locale — including Spanish, where `es-ES/README.md` had already chosen them over the
> peninsular `« »`. The same collision as the apostrophe above at a fifth of the volume: 24
> strings carrying 54 straight characters against 238 spelling them curly, with two marketing guides
> one scroll apart making the same rhetorical move in different characters. `pnpm check:voice`
> refuses the straight one with **no ICU exemption** — unlike `'`, a `"` carries no meaning to ICU, so
> no value needs it and the rule landed at zero.


The current product type system is:

| Use | Typeface | Weight / treatment |
| --- | --- | --- |
| Headings, labels, body copy, wordmark | **IBM Plex Sans** | Regular for reading; Medium/Semibold for hierarchy; tabular figures for times and counts. |
| Data, timestamps, credentials, technical utility | **IBM Plex Mono** | Only where fixed-width reading helps. Not a display face. |
| Boat mode (roll call, manifest) | **Atkinson Hyperlegible** | Regular and Bold at large sizes. |
| Fallback | `system-ui`, sans-serif | Only when Plex is unavailable. |

Typography should feel calm, plain and capable:

- Prefer short lines, generous leading, and clear hierarchy over oversized display type.
- Use weight and spacing to organize information; do not use all caps as the default voice.
- For merch, use Plex Sans Semibold for `DiveDay` and Regular or Medium for a short supporting line.
- Do not use Plex Mono for a slogan, and do not mix in a second "dive" font to make merch feel
  more nautical.

## Visual language and concepts

The visual world is **sunlit sand above the surface and open ocean at depth**. It is tactile,
spacious, and gently in motion.

Marketing motion is earned, quiet, and progressive: sections that begin below the first viewport
rise once as they enter it, while the first screen stays visible in the server-rendered paint. The
hero roll-call mockup settles into place and its two rows arrive in sequence. These entrances use
only `transform` and `opacity`, the shared `--ease-out-soft` curve, and a short 150–250ms window;
`prefers-reduced-motion` removes both the entrance and the stagger. Keep the `/product` paint
measurement in the visual suite when changing this: if the motion makes the page feel late or
janky, remove the effect rather than adding more choreography.

Interface icons come from the one drawn `DiveDayIcon` family in
`src/components/StaffDestinationIcon.tsx`: a 24px grid, shared stroke language, and
`aria-hidden` artwork beside words that carry the meaning. Do not add an icon library or a text
codepoint as a one-off substitute. The status tones are the exception and stay exactly as the
emoji vocabulary in `src/components/ui/tone.ts` — emoji carry their own two-color artwork,
whereas text dingbats such as `✓`, `▲`, and `✕` inherit the surrounding font and read like stray
glyphs at badge size.

Good recurring concepts:

- ascending bubbles and buoyancy;
- gentle arcs, routes, and return paths;
- amber as a small living detail, not a loud pattern;
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
| On the public pages, what a shop gets, proved on the product's own screen with the builder's notes beside it, and on `/about`, someone who dives answering a shop owner's questions out loud | A landing page describing the screen, or a brand talking about itself |

Copy rules:

- Lead with the person's outcome: “Know who is ready before the boat leaves,” not “Advanced
  manifest orchestration.”
- Prefer concrete nouns: shop, counter, booking, waiver, card, boat, diver, head count.
- Use verbs on controls: “Add diver,” “Mark certified,” “Refresh now,” “Send waiver.”
- Keep errors calm and actionable: say what happened and what the person can do next.
- Teach an empty state instead of apologizing for it.
- Use real dive terms correctly; see [product/glossary.md](../product/glossary.md).
- Spell in American English, everywhere a shop or a diver reads: *color*, *center*, *meter*,
  *gray*, *canceled*, *enroll*, *enrollment*, *judgment*, *catalog*, *license*, *organize*,
  *recognize*, *toward* (Aaron, 2026-10-06; H-95). One reader meeting *colour* on one screen and
  *color* on the next hears two writers. `pnpm check:voice` refuses a British spelling in an
  English bundle, in a route's metadata and in any prose literal under `src/` (the course and site
  templates, the demo seeds); the list is `BRITISH_SPELLINGS` in `scripts/check-voice.mjs`. Two
  things keep their spelling: a proper name (the demo's Harbour Lantern Dive Co, an address) and
  another system's own words carried in verbatim (an imported booking's "Cancelled" status).
  Code comments and internal docs are not copy and are not swept.
- Keep implementation language out of customer-facing copy. Say “saved on this phone” instead of
  “encrypted local snapshot,” and “checked again when you're back in service” instead of
  “reconciled.” The one page that may name the protection is `/privacy`, where what guards a
  shop's divers' data is the reader's own question rather than a capability being sold — see
  [principles.md](principles.md) §4.
- Never invent proof, customer counts, testimonials, certifications, or superlatives.

### The two registers of the public pages

**Decided 2026-09-24** (Aaron Buxbaum; H-89 in [product/human-decisions.md](../product/human-decisions.md)):
of the six voices drawn in [voice-strategies-20260917.md](voice-strategies-20260917.md), the public
pages speak in **6, Margin Notes**, and `/about` in **4, Over a Beer**. That document is the dated
record of the alternatives and the diagnosis; this section is the voice.

**Amended 2026-10-05** (H-93): the sale goes back in front of the notes. Under H-89 alone a page
showed the screens and annotated them and never said why a shop would want any of it, so the
headlines described the page ("Four screens from a dive shop's day, with notes from the person who
made them") and the owner's brief was that the pages were not selling. A section now says **what
the shop gets, then shows the screen that proves it, then opens the demo on that screen**. The
builder's notes stay, as the proof's captions, and `/about` keeps its spoken register.

**The selling register** (every public page but `/about`).

- **The heading and the lede say what the shop gets**, as a fact about the shop's own day: "Waivers
  and medical forms come back signed before the diver walks in." It is a result an owner wants,
  never an evaluation of DiveDay ("easy", "powerful", "calm") and never a mood to adopt. The
  rival-paste test in [product/marketing.md](../product/marketing.md) binds it: a sentence any
  booking app could print truthfully names no result.
- **The screen is the proof**, and the notes beside it are how a reader checks the heading against
  it. A feature page carries three.
- **The demo opens on that screen.** A feature page's own "Try the live demo" carries the page's
  role and landing (`src/lib/feature-pages.ts`), so the visitor arrives on the screen they just
  read about rather than on Today. A page that shows several screens on the way to its argument
  (the homepage's five steps) links each to its feature page instead, whose door opens the demo on
  that screen; the switching hub's annotated screen keeps its link-weight `ScreenDoor`, as below.

**The builder's note** is the caption under a screen, wherever one is drawn: the product's own
screen, with short notes from the person who built it pointing at specific things.

- A note is under twenty words and names **one visible thing** on the screen beside it. It may give
  a reason or a limit. It never gives an evaluation ("fast", "simple", "calm"), and it never asks
  for anything.
- The app's own words are quoted as they appear on the screen: “Ready when saved”,
  “Not recognized, so ignored”. The mockup mirrors the real screen element for element, so a note
  is re-read whenever the screen it annotates changes.
- What is deliberately missing gets a note too ("There is no percentage bar; the count is the
  count").
- First person is allowed, and a fact only the builder would know is the kind of note worth
  writing ("I tried a spinner here and the captain read it as the phone thinking").
- Every screen a visitor could open leads to **one door into the demo as that role**, and the
  page's one primary stays the shared pair. On a feature page that door is the hero's; under a
  screen on a page that argues something else it is the screen's own (`ScreenDoor`, link-weight,
  tagged per screen in `src/lib/funnel.ts`), or, on the homepage, the feature page's name, one tap
  from that page's door. The homepage's screens carried `ScreenDoor`s until 2026-10-05, when its
  steps began to end in their feature pages (H-93).
- A heading over a screen says what the shop gets from it, and the screen's name in the builder's
  words ("The manifest, on a phone with no signal.") is a fine way to say it when the name is the
  result. It never says what the reader should feel.
- Prose that is neither a heading nor a note (the steps, what a feature does not do, the price, the
  terms, the export claim, the FAQ answers) is the notice-board register: the fact, in the order a
  buyer asks for it, with no sentence spent on how to feel about it.

**The spoken register** (`/about` only). Write the way the best diver in the shop explains the
software to a mate after the boat is tied up.

- Who talks: someone from DiveDay who dives, to a shop owner who asked. The founder's own parts
  are first-person singular; what both people here share is "we"
  ([product/marketing.md](../product/marketing.md)'s biography rules are unchanged).
- Every heading is **the owner's question, repeated back** the way a person repeats a question
  before answering it: no question mark, no full stop ("Why did you build this", "What's the
  catch", "What happens to my records if I go"). The band under it is the answer, and the
  headline test binds the first sentence of that answer rather than the question.
  `src/app/about/copy.test.ts` holds the arithmetic for the exit band.
- Contractions always. "Honestly" and "look" get a budget of one each on the page. Paragraphs run
  from one line to eight and stop where the speaker stops caring. No bullet lists.
- One joke on the page, about the work, never about the product. No "people love the…": with no
  customers yet there are no people.
- A fact is conceded flat, with no flinch and no flourish after it. "I don't know yet" is allowed.
- Everything the page says is still shipped-only and checkable in the demo. The register changes
  how a fact is said, never which facts are said.

Both registers keep every rule under "What gives us away" below. The one they bend is the heading
rule: a selling heading states what the shop gets, which the screen under it can be checked
against, and a spoken heading is a question with the mark left off. Neither is an aphorism.

### Before / after examples

| Avoid | Prefer |
| --- | --- |
| “DiveDay is an all-in-one dive operations platform.” | “Run the whole dive day, from booking to head count.” |
| “No records found.” | “No trips yet. Schedule your first charter.” |
| “Submit” | “Add diver” / “Save trip” / “Send waiver” |
| “Sync failed.” | “This phone could not refresh. Try again while you have service.” |
| “Our best-in-class solution.” | “A calmer way to run a dive day.” |

### What gives us away

Agents write every word of DiveDay, and a language model has a house style whether or not it
means to. On 2026-09-03 the marketing bundle alone carried an em-dash in one sentence out of five,
the "not a project, a file" contrast twenty-eight times, four "Here's how" lead-ins, a
"No X. No Y. No Z." hero, and "actually" nine times. Each read as a good sentence on its own.
Together they read as the voice a buyer has met a thousand times this year and learned to skim,
and on a page whose one job is to be believed, that is the worst thing a sentence can do.

The rule underneath every item below is the same: **a divemaster giving a briefing says the thing.**
They do not set it up, pivot to it, contrast it with what it is not, or tell you it is true. The
briefing is plain sentences in the order the day happens, and the confidence is in the facts.

**Punctuation**

- **No em-dashes in prose.** Not one. The dash is the single strongest tell, because a model reaches
  for it every time two clauses want joining and a person almost never does. Use what the dash was
  standing in for: a full stop, a comma, a colon, or "so"/"and"/"because". A dash that survives is
  a label separator in a short string ("Boarded — tap again to undo", "Checked in — 2"), never a
  hinge inside a sentence. `pnpm check:voice` refuses the rest.
- **A colon introduces a list, not a punchline.** "A file, not a project: the importer shows…" is a
  drum roll. Say the fact.
- **A sentence fragment is not emphasis.** "One sitting, not a project plan." "Plainly." A fragment
  after a full sentence reads as a beat for effect, and effect is what we are not doing.

**Shapes**

- **Say what it is, not what it is not.** "A brief in plain words, not a form letter", "A person,
  not a wizard", "A head count, not a printout", "not a spec written far from the water". The
  contrast frame is the second-strongest tell and it is everywhere. Name the thing and stop; the
  reader supplies the alternative. The one exception is a *factual* refusal the reader needs
  ("No retail register and no agency sync"), which is a scope statement, not a rhetorical shape.
- **No staccato runs.** "No setup fee. No per-seat math. No feature tiers. No cut of your bookings."
  Four fragments in a row is a cadence, not a claim. Write it as a sentence with the facts in it.
- **No triplets for rhythm.** Three parallel nouns or clauses because three sounds finished. A list
  has however many items are true. The mechanical half is the **anaphoric triplet**, a comma list
  whose items open with the same word ("never crashes, never logs you out, and never needs five
  taps"); `pnpm check:voice` refuses it on the public pages, and leaves a list of things alone
  whatever article or possessive opens each one.
- **No mirrored pairs.** "Nothing gets asked twice and nothing gets missed once." "Records come in
  with a file and leave with a button." Two clauses cut to the same shape so the sentence sounds
  balanced. Keep the half that carries the fact. `pnpm check:voice` refuses a pair that opens or
  closes both halves on the same two words.
- **No tag sentence.** "One answer, all day." "Better now than after the move." "It does not
  decide." A sentence of four words or fewer at the end of a value, after a long one, is a beat
  for effect; `pnpm check:voice` refuses it on the public pages. A short sentence in the middle of
  a paragraph is speech and stays.
- **No house phrase.** "From day one" seven times, "a real person" four, "one ZIP / button /
  number / price" sixteen: a phrase that reads well once becomes the site's tic by the third
  page. `pnpm check:voice` refuses three words with two of substance on more than two pages of a
  bundle; the names of things ("the live demo", "your own Stripe account") are exempt by list,
  and a phrase joins that list because it is what the thing is called, never because it reads
  well.
- **No aphorism headings.** "The door swings both ways." "The spreadsheet got you this far." "That's
  our whole price." A heading that could open a TED talk is a heading that argues nothing. A heading
  states a fact the band beneath it can be checked on (the `/about` test in
  [product/marketing.md](../product/marketing.md) is this rule made mechanical).
- **No rhetorical questions as headings.** "Rather see it than read about it?" The reader is being
  handled. Ask a real question only where the reader has one (a FAQ), and answer it.
- **No lead-ins.** "Here's how", "Here's the whole path", "One rule we won't bend:", "That's the
  pattern:", "The best part", "Let's be honest". Delete the lead-in; start at the sentence it was
  introducing.
- **No closing flourish.** "If your team wouldn't open it on a busy morning, it hasn't done its job."
  A paragraph that ends on a quotable line is a paragraph that stopped being a briefing.

**Words**

- **No intensifiers.** *actually, genuinely, truly, simply, quietly, plainly, really, literally.*
  Each one is a sentence admitting it does not expect to be believed. "DiveDay says so plainly" is
  "DiveDay says so".
- **No software adjectives.** *seamless, effortless, robust, powerful, intuitive, streamlined,
  elevated, empowered, frictionless.* Show the thing instead; the reader decides what to call it.
- **No "the whole" for scale.** "The whole shop", "the whole list", "the whole path", "the whole
  day". Once per site is a phrase; eleven times is a verbal tic.
- **No "worth".** "Worth sharing", "worth the room", "worth having". A value judgment pretending to
  be a fact.
- **No knowing asides.** "(and it's in the price)", "which is what makes it usable by someone with
  one hand free". A parenthetical that winks is a parenthetical that goes.

**What does not change**

The claims policy, the concrete nouns, the verbs on buttons, and the [copy-restraint](../../.claude/skills/copy-restraint/SKILL.md)
filter all still apply; this list is about the *shape* of a sentence that survived them. Removing a
tell never shortens a fact or softens a refusal, and a rewrite that loses a number, a name, or a
consequence has fixed the wrong thing.

| Before | After |
| --- | --- |
| “Who's booked, who's cleared, who's on the boat — one answer, all day.” | “Who is booked, who is cleared, and who is on the boat. One answer, all day.” |
| “A file, not a project: the importer shows exactly what comes across — and what doesn't — before a single row saves.” | “The importer shows what comes across and what does not before a single row saves.” |
| “No setup fee. No per-seat math. No feature tiers. No cut of your bookings.” | “There is no setup fee, no per-seat charge, no feature tier, and no cut of your bookings.” |
| “A brief in plain words, not a form letter” | “A brief in plain words” |
| “When DiveDay can't verify something, it says so plainly — no silent passes.” | “When DiveDay cannot verify something, it says so.” |
| “Here's how to get your file out of EVE yourself.” | “Getting your file out of EVE takes six steps, all on the shop PC.” |
| “Rather see it than read about it?” | “See it in the live demo” |

`pnpm check:voice` (`scripts/check-voice.mjs`) refuses the mechanical half of this list in every
message bundle: the prose em-dash, the intensifiers, the lead-ins, the "not just" contrast, and the
staccato run, per locale, and on the public pages' strings (`marketing.*`, `switching.*`,
`account.onboard.*`, every route's `metadata`) the four shapes: the mirrored pair, the anaphoric
triplet, the tag sentence and the house phrase. The rest is judgment, and the
[brand-voice](../../.claude/skills/brand-voice/SKILL.md) skill's checklist is where it is applied.

### Marketing boundary

Public and sales copy follows the full claims policy in [product/marketing.md](../product/marketing.md):
shipped-only, truthful, no fabricated proof, and no price literals outside the marketing source of
truth. Brand consistency never gives permission to make a claim the product cannot demonstrate.

## Merch buying brief

When buying shirts, hats, stickers, totes, cards, or other physical goods, start with one of these
combinations:

| Item | Ground | Artwork | Suggested copy |
| --- | --- | --- | --- |
| Primary dark shirt or hoodie | Deep slate | Sea teal mark/wordmark, white or light-ink wordmark, one amber bubble | `DiveDay` on front; optional back line: “A calmer way to run a dive day” |
| Light shirt or tote | Paper | Slate ink wordmark, sea teal mark, one amber bubble | `DiveDay` or `DiveDay · from booking to head count` |
| Cap or small sticker | Sea teal | Light-ink bubbles with one amber bubble | Mark alone or `DiveDay` beside it |
| Small paper insert or thank-you card | Paper or white | Slate ink body, sea teal heading, amber detail | One warm sentence and one useful next step |

Production defaults:

- Prefer one- to three-color decoration. A clean two-color mark will usually outlast a complex
  print.
- Use embroidery only when the vendor can preserve the three bubbles and the amber detail at the
  finished size; otherwise use a screen print, transfer, or woven patch with a proof.
- Avoid gradients, bevels, outlines added by the vendor, distressed effects, faux stitching, and
  extra nautical symbols.
- Do not make amber the main garment color unless a specific campaign has approved it. Amber is
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
- [ ] Smallest/top bubble is amber.
- [ ] Mark is not stretched, rotated, shadowed, or crowded.
- [ ] Artwork uses sea teal, paper/slate, ink, and a restrained amber accent.
- [ ] Wordmark is Plex-like and readable at the finished size.
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
