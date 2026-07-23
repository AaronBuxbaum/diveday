# Public marketing surfaces — what they are and how to write them

DiveDay's public pages are the homepage (`/`), product page (`/product`), pricing page
(`/pricing`), and the onboarding entry (`/onboard`); switching guides (`/switching/*`) join them as
they ship. They are a truthful sales surface for the product that exists today.

This document is the living rulebook for those pages: the positioning they argue, the claims they
may make, the voice they use, and the maintenance loop that keeps them true. The dated case for the
current direction is [assessments/marketing-review.md](assessments/marketing-review.md); the
step-by-step editing procedure is the `marketing-page` skill.

**These pages are product surface.** DiveDay is developed exclusively by AI sessions, so marketing
has no separate team, tooling, or CMS: copy is code, reviewed like code, tested like code
(`e2e/marketing.spec.ts`, `e2e/visual.spec.ts`), and governed by this doc the same way
`schema.ts` is governed by the schema-change skill. A session editing these pages carries both
jobs — marketer and maintainer — and must leave both the pages and this rulebook consistent.

## The positioning spine

We are late to the market with zero customers, so the pages cannot argue from social proof. They
argue from **proof we can demonstrate**, in one sentence:

> **Easy to try, safe to run the boat on, safe to leave.**

- **Easy to try** — the live demo (walk the day as owner, instructor, divemaster, captain, diver)
  and the seeded trial shop. Demo before trial: it is the lowest-friction proof we own.
- **Safe to run the boat on** — boat-day depth (roll-call checkpoints, append-only history, the
  offline manifest) and fail-closed readiness ("no silent passes"). Verified rivals have neither.
- **Safe to leave** — the full-shop export (one ZIP, documented CSVs, every tier, self-serve) and
  the honesty-table importer. This is the counter to "you're new and unproven" — make it explicit,
  never assume it's implied.
- **Honest flat price** — one number, no setup fee, no per-seat math, no feature tiers. Contrast
  with concrete buyer fears, not with named-competitor digs.

Concede loudly what we don't do: retail POS, agency (PADI) sync, gear inventory. An honest no on
these buys trust our claims can't. See
[assessments/competitive-strategy.md](assessments/competitive-strategy.md) for why these are the
chosen battlegrounds — and re-read it before changing the spine.

## Claims policy (hard rules)

- **Shipped-only.** Every claim describes a workflow that works in the demo today. No roadmap
  marketing, no "coming soon". If a claim can't be demonstrated in the live demo, it doesn't go on
  a page.
- **No fabricated proof.** No invented testimonials, user counts, logos, ratings, or "trusted by"
  language — ever. When real customers exist, their words go through the product owner first.
- **Competitor statements must be documented fact** (their own pages, FAQs, pricing) and phrased
  factually. Prefer contrasting with the *buyer's fear* (setup fees, add-on stacks, export limits)
  over naming the rival. Switching guides may name incumbents; they cite sources and never
  speculate.
- **The price renders only from `src/lib/marketing.ts`.** Never restate the figure in prose, docs,
  JSON-LD literals, or images — every copy is a future stale claim. The number and terms are
  provisional until H-12 ([human-decisions.md](human-decisions.md)) is decided by the product
  owner; do not publish price or billing terms through any new channel without that decision.
- **Offline claims stay precise and human**: staff explicitly save a copy to the device; nothing
  invisibly caches, transfers between devices, or guarantees stale readiness is live. Captain's
  words ("saved to this phone", "checked again when service returns") — the machinery
  (encryption, reconciliation) stays in ADRs, never in copy
  ([design/principles.md](../design/principles.md) §4).
- **Safety-adjacent copy** (readiness, manifests, medical, cert gating, nitrox) gets
  `dive-domain-expert` review before merge, same as safety-critical code.
- Multi-location operation and unconfigured provider integrations are out of scope and must not be
  claimed.

## Voice

The product voice ([design/principles.md](../design/principles.md) §4 — competent divemaster, not
a lawyer or a mascot) applies, plus marketing-specific rules:

- **Headlines state an outcome in the buyer's world**, not a category label. "Roll-call buttons big
  enough for wet thumbs" beats "mobile-first manifest management". Test: could a rival paste this
  headline onto their site truthfully? If yes, sharpen it.
- **Concrete nouns over software jargon.** The buyer runs a shop, a counter, a boat — not an
  "operating system", "platform", or "solution". Name what DiveDay replaces: the whiteboard, the
  clipboard, the three apps and a spreadsheet.
- **No unprovable superlatives** ("everything", "best", "complete") — scope claims to what ships:
  "from booking to head count".
- Buttons are verbs; eyebrows are short; body copy earns each sentence. Read it aloud as a dive
  briefing — anything you'd be embarrassed to say to a captain's face gets cut.

## SEO and shared links

Search and shared links are our only free inbound channels; every public page carries the full
substrate:

- **Every public page has page-level metadata**: a title that leads with what a buyer would type
  (the category term "dive shop software" belongs in the home title), a description in the product
  voice, a canonical URL, and Open Graph + Twitter card data — these pages get shared in shop
  owners' chat groups, and a bare link is a lost visit.
- Site-level `robots` and `sitemap` cover the public surface; tokened pages (`/waivers/*`,
  `/ready/*`, `/recap/*`, `/offline-manifest`) stay `noindex` individually.
- Structured data where content already supports it: `FAQPage` on `/pricing`, `SoftwareApplication`
  on `/` — values read from `src/lib/marketing.ts`, never literals.
- **High-intent pages beat high-volume pages** for us: switching guides (`/switching/<incumbent>`)
  target "leaving <incumbent>" searches — motivated buyers, no competition — and double as the
  portability proof. Each states the incumbent's own export click-path, our import honesty table,
  and a demo CTA.
- Before touching metadata APIs, read the bundled Next docs (`node_modules/next/dist/docs/`) — this
  Next version's conventions differ from training data.

## Product visuals

The public pages ship deterministic illustrated mockups as the design — not captured screenshots.
Each visual is a small, hand-built component in `src/components/MarketingScreenFallbacks.tsx`
(`DiverBookingFallback`, `FrontDeskReadinessFallback`, `CaptainRollCallFallback`) rendered through
the shared wrappers in `src/components/MarketingSections.tsx`:

| Component | Represents | Marketing use |
| --- | --- | --- |
| `DiverBookingFallback` | Public schedule | Diver booking moment |
| `FrontDeskReadinessFallback` | Staff trip readiness | Desk / safety explanation |
| `CaptainRollCallFallback` | Captain manifest roll call on a phone | Dock / captain moment |

These mockups render identically in every checkout and in both light and dark modes, and they use
only semantic tokens, so keeping them truthful is a matter of editing the component copy when the
product it depicts changes. There is no browser-capture step: `public/marketing/*.png` is not used.
Reintroducing real-screenshot capture (with the tracked assets and a capture script that produced
them) is a deliberate, ADR-gated decision if the mockups ever stop being enough.

## Where the words live

| Content | Source of truth |
| --- | --- |
| Feature claims shared across pages | `src/lib/marketing.ts` (`productFeatureGroups`) |
| Price, plan name, included list | `src/lib/marketing.ts` (`earlyAccessPrice`) — the only place |
| Page-specific narrative copy | The page file (`src/app/{page,product/page,pricing/page}.tsx`) |
| Mockup copy | `src/components/MarketingScreenFallbacks.tsx` |
| Nav / footer | `src/components/MarketingNav.tsx` / `MarketingFooter.tsx` |
| Switching-guide content (per incumbent) | `src/lib/migration-guides.ts` (framework-free data); pages in `src/app/switching/` |

A claim used on more than one page belongs in `src/lib/marketing.ts`, not copy-pasted.

A switching guide is a live page only — no roadmap or "coming soon" entries (claims policy).
Each names one incumbent's own export click-path, renders the import scope table from
`IMPORT_HONESTY_TABLE` verbatim (never paraphrased), and ends on a demo CTA. Every incumbent claim
is documented fact from [assessments/competitive-strategy.md](assessments/competitive-strategy.md),
carrying its own `sources` (rendered on the page) and phrased factually, never speculative; the
safety-adjacent scope copy gets `dive-domain-expert` review like any other. Add a guide by writing
its `MigrationGuide` entry — only once its export path is verified, since every registered entry is
a published page (there is no draft/planned state).

## Maintenance loop

- **A feature ships → the pages move in the same PR** when it changes what a buyer would be told:
  update `productFeatureGroups`, the relevant page moment, and any mockup it depicts. The
  new-feature skill's definition of done includes this check.
- **A claim is invalidated** (feature removed, behavior changed) → fix the page in the same PR
  that invalidates it. If code and copy disagree, one of them is the bug.
- **Verification is the product bar**: `pnpm check` green; `pnpm e2e -- marketing.spec.ts`;
  screenshots of every touched page in light + dark, desktop + phone, actually looked at
  (design-review skill); Argos triage after push (argos-triage skill).
- Copy changes update the e2e assertions that pin headlines/price visibility — deliberately: a
  failing marketing spec on a copy change is the test doing its job.
- **Re-check positioning** (this doc's spine + the assessments) when: a rival ships a response
  (DiveAdmin bulk export/webhooks, any DiveShop360 API), the H-12 pricing decision lands, or the
  first paying shop exists — real social proof reorders every argument above.
- The `marketing-page` skill is the executable form of this document; if it and this doc disagree,
  fix whichever is stale in the same PR.
