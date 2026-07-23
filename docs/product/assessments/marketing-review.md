# Marketing review — the case for repositioning the public pages

> A full review of the public marketing surfaces (`/`, `/product`, `/pricing`, `/onboard`) from the
> chair of a skeptical shop owner, written 2026-07-23 against the live pages (screenshots, light +
> dark, desktop + phone), the codebase, and the two competitive assessments. An assessment, not a
> commitment; the maintenance rules that came out of it live in [marketing.md](../marketing.md), and
> tasks that survive review move to the [roadmap](../roadmap.md).

## Context: what these pages must do

We are late to a small market. DiveAdmin markets loudly at $39–119, DiveShop360 owns the PADI rail
and the EVE install base, and we have **zero customers, zero reviews, zero brand searches**. The
pages therefore cannot win the way incumbent pages win (logos, testimonials, "trusted by 143
shops"). They have to win the only three ways available to an unproven vendor:

1. **Proof over claims** — the live demo, the working export button, honest scope tables.
2. **Capture existing intent** — the searches that already happen ("dive shop software",
   "EVE alternative", "switching from DiveShop360") instead of demand we can't create.
3. **A differentiated story** — not the category description every rival also recites.

## What is already right (keep it)

- **The claims discipline.** Copy is constrained to shipped workflows, the price lives in one file
  (`src/lib/marketing.ts`), offline claims use captain's words. This is rare and load-bearing —
  every recommendation below stays inside it.
- **The live demo as hero CTA.** For a vendor with no testimonials, "walk the day as the captain"
  is the single best trust device we own. Demo-first, trial-second is the correct CTA order.
- **The craft.** Calm layout, deterministic light/dark mockups, dock-test targets, a distinct
  briefing voice. The pages *look* like the delight bet. Design is not the problem.
- **Tests.** `e2e/marketing.spec.ts` + Argos snapshots mean marketing regressions are caught like
  product regressions. Extend this; don't lose it.

## What is broken, in order of cost

### 1. The story is category-generic; our researched wedge is missing

"Run the whole dive day, from booking to head count" and "everything the shop needs" are sentences
DiveAdmin and DiveShop360 can (and do) also say. Meanwhile the things
[competitive-strategy.md](competitive-strategy.md) verified we *actually win on* are absent or
buried:

- **Boat-day depth** — roll-call checkpoints, append-only history, an offline manifest that keeps
  working. Present on the pages, but as one feature among sixteen, not as the spine.
- **Fail-closed readiness** — "no silent passes" appears once on `/product`; no rival has it at all.
- **Portability** — *completely absent.* The full-shop export and the honesty-table importer are
  shipped, provable, and the documented counter to our biggest objection ("you're new — what if you
  disappear?"). Not one sentence on any page says a shop can leave with everything, any time.
- **Honest flat pricing** — stated, but not contrasted with what buyers actually fear (setup fees,
  Core-tier gating, per-seat math, add-on stacks) — fears our research shows are live.

The pages sell the category; they should sell the four things above, in that register: *easy to
try, safe to run the boat on, safe to leave.*

### 2. The SEO and shared-link substrate is near-zero

For a no-brand entrant, search and shared links are the only free inbound channels. Today:

- No `sitemap.ts`, no `robots.ts` (public token pages correctly set `robots: noindex` individually,
  but there is no site-level policy and staff routes rely on auth alone).
- No `metadataBase`, no canonicals, **no Open Graph or Twitter card on any page** — a link pasted
  into a WhatsApp group of shop owners (how this niche actually shares) renders bare.
- `/` has no page-level metadata; it inherits the layout's title. No page title contains the
  category term a buyer types ("dive shop software").
- No structured data at all — the pricing FAQ is sitting there unmarked (`FAQPage`), and
  `SoftwareApplication` with an honest price is available.
- No high-intent pages: the migration guides ("Switching from EVE / DiveShop360 / DiveAdmin /
  Smartwaiver") are prescribed by the [roadmap](../roadmap.md) and competitive strategy, capture
  the market's most motivated buyers (the EVE forced-migration pool), and do not exist.

### 3. The objection layer answers easy questions, not deal-killers

The pricing FAQ (4 items) answers "what's included" and "does the manifest work offline". The
questions that actually kill the deal, per [competitive-analysis.md](competitive-analysis.md#what-blocks-the-purchase),
go unanswered:

- **"You're new and unproven — what happens to my data if you fold?"** We have the best possible
  answer in the product (one ZIP, documented CSVs, `contacts.csv` shaped for rivals' import
  wizards, every tier, self-serve) and never say it.
- **"Does it talk to PADI?"** Silence reads as evasion. The honest answer — no agency exposes a
  usable API to anyone; here's what we do instead — builds more trust than the silence.
- **"Do you replace my POS?"** The strategy says concede it loudly ("bring your POS, we run the
  water"); the pages never mention it.
- **"What does switching actually cost me?"** The importer with its published honesty table is the
  answer; unmentioned.
- **"Why should I be an early customer?"** "Early access" is worn as a badge but never converted
  into the founding-shop advantage (direct line to the builders, shape the roadmap, price held).

### 4. Conversion-path gaps

- The demo — our primary conversion for skeptics — is only reachable from `/`. On `/product` and
  `/pricing`, exactly where a skeptic finishes reading and wants proof, the only CTA is "Start a
  trial" (higher commitment, form first).
- No event instrumentation distinguishes demo clicks from trial clicks (Vercel Analytics is
  installed but records only page views), so we cannot learn which story converts.
- `/onboard` asks for name/email/password with no reassurance line (no card required, delete
  anytime, data leaves with you) at the exact moment of maximum hesitation.

### 5. Copy nits (fix while touching the pages)

- "One operating system" / "operating system" — insider software-vendor jargon; the buyer runs a
  dive shop. Say what it replaces: the whiteboard, the clipboard, the three apps.
- Pricing subhead "without turning the essential safety workflow into a stack of add-ons" — a
  competitor dig that assumes context the visitor doesn't have; make the contrast concrete (no
  setup fee, no per-seat pricing, no feature tiers) or cut it.
- `/product` hero "Everything the shop needs…" over-claims against known gaps (gear inventory,
  agency sync) and clashes with our honesty posture. "Everything from booking to head count" is
  the truthful scope.
- The recently shipped delight arc (night-before brief, post-trip recap) — the most *feelable*
  differentiators for the diver-facing story — appears nowhere on the marketing pages.

## What I would do — three moves, in order

**Move 1 — build the substrate (mechanical, no positioning risk).** Metadata, OG images, sitemap,
robots, JSON-LD, demo CTA parity, analytics events. Zero copy debates; compounding returns; ship
first.

**Move 2 — reposition around "easy to try, safe to run on, safe to leave."** Rewrite the home
narrative and the pricing objection layer around the verified wedges: boat-day depth + fail-closed
readiness (safe to run on), demo (easy to try), export/importer (safe to leave), flat honest price.
Turn early access into the founding-shop offer. Everything claimable is already shipped — this is
arranging proof we have, not promising work we haven't done.

**Move 3 — capture intent with switching guides.** "Switching from EVE" first (the live
forced-migration pool), then DiveShop360, DiveAdmin, Smartwaiver. Each: the incumbent's own export
click-path, our honesty table, the importer, a demo CTA. These are simultaneously our best SEO
pages, best sales pages, and proof of the portability story.

## Task breakdown

Sized S/M; sequence within each move is the listed order. Every task ends with the
`marketing-page` skill's verification loop (e2e + screenshots + design-review; Argos triage after
push). Copy touching safety claims (readiness, manifest, medical) gets `dive-domain-expert` review.

| # | Task | Size | Notes |
| --- | --- | --- | --- |
| M1 | **SEO substrate**: `metadataBase` + canonicals; page-level metadata for `/` (title leads with "dive shop software"); OG/Twitter images (generated, on-brand, both modes considered); `robots.ts` + `sitemap.ts`; `FAQPage` JSON-LD on `/pricing`, `SoftwareApplication` on `/` | S | Read the bundled Next docs (`node_modules/next/dist/docs/`) before touching metadata APIs — conventions differ from training data. Price in JSON-LD must read from `src/lib/marketing.ts` |
| M2 | **Demo CTA parity + funnel events**: demo CTA on `/product` and `/pricing`; Vercel Analytics custom events on demo entry, trial start, pricing view | S | Defines the measurement baseline before any copy changes, so Move 2 is testable |
| M3 | **Home repositioning**: hero + section order tell try/run/leave; add a "Your data leaves with you" band (export ZIP + importer, factual); convert "early access" badge into the founding-shop offer | M | Claims limited to shipped behavior; price still only from `src/lib/marketing.ts` (H-12 gate) |
| M4 | **Objection FAQ**: add the deal-killer questions (new-vendor/data exit, PADI, POS concession, switching cost, founding-shop terms) to `/pricing`; concede POS and agency sync plainly | S | The honest-no answers are the trust device; `dive-domain-expert` for cert/medical wording |
| M5 | **Product page truth pass**: scope the hero claim to booking→head-count; add the diver arc (night-before brief, recap) as a marketing moment; demo CTA | S | |
| M6 | **"Switching from EVE" guide** at `/switching/eve`: incumbent export click-path, honesty table from the importer ADR, importer walkthrough, demo CTA; sitemap + metadata | M | Template for the series; factual, sourced, no disparagement beyond documented fact |
| M7 | **Remaining switching guides**: DiveShop360, DiveAdmin, Smartwaiver | M | Page-by-page, reusing the M6 template |
| M8 | **Onboard reassurance**: no-card/leave-anytime line on `/onboard`; carry the founding-shop framing through | S | |

**Human gate (not an agent task):** the price number and terms remain provisional until H-12 is
decided ([human-decisions.md](../human-decisions.md)); nothing above publishes the price anywhere
new outside `src/lib/marketing.ts` rendering.

**Measure**: after M2, watch demo-entry rate and demo→trial rate per page; revisit this assessment
when either rival ships a response (DiveAdmin bulk export/webhooks; any DiveShop360 API) or when
the first paying shop exists — real social proof changes the whole calculus above.
