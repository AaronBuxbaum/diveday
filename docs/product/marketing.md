# Public marketing surfaces — what they are and how to write them

DiveDay's public pages are the homepage (`/`), product page (`/product`), pricing page
(`/pricing`), the about page (`/about`), and the onboarding entry (`/onboard`); switching guides
(`/switching/*`) join them as they ship. They are a truthful sales surface for the product that
exists today.

This document is the living rulebook for those pages: the positioning they argue, the claims they
may make, the voice they use, and the maintenance loop that keeps them true. The dated case for the
current direction is [archive/marketing-review-20260723.md](archive/marketing-review-20260723.md)
(fully delivered, kept for rationale); the step-by-step editing procedure is the `marketing-page`
skill.

**These pages are product surface.** DiveDay is developed exclusively by AI sessions, so marketing
has no separate team, tooling, or CMS: copy is code, reviewed like code, tested like code
(`e2e/marketing.spec.ts`, and the marketing captures in `e2e/visual.spec.ts`), and governed by this doc the same way
`schema.ts` is governed by the schema-change skill. A session editing these pages carries both
jobs — marketer and maintainer — and must leave both the pages and this rulebook consistent.

## The positioning spine

We are late to the market with zero customers, so the pages cannot argue from social proof. They
argue from **proof we can demonstrate**, in one sentence:

> **Easy to try, safe to run the boat on, safe to leave.**

- **Easy to try** — the live demo (walk the day as owner, instructor, divemaster, captain, diver),
  a full sample shop minted fresh for each visitor, plus a trial shop of your own that starts clean.
  Demo before trial: it is the lowest-friction proof we own.
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
- **Authorized service offers** are the one exception to shipped-only: a commitment the shop makes
  to a customer, not a product feature, may be stated once the product owner has authorized it.
  Currently authorized (a Jane-style concierge, authorized 2026-07-24, extended H-20): **free,
  personal, bidirectional help switching — a person will help a shop bring its data *in* (map any
  export or spreadsheet, migrate the roster with them) and, if DiveDay is ever not right, take its
  data back *out* just as personally.** It lives on **every** `/switching` page as the shared
  `SwitchingConcierge` block, routed to the `switch@dive.day` inbox. Phrase these as a human
  commitment ("we'll map it with you", "we'll help you carry it out"), never as an automated product
  capability, and never promise a turnaround time. A new service claim needs product-owner sign-off
  the same way the price does. **Founder-direct support retired 2026-08-05 (Aaron Buxbaum,
  [human-decisions.md](human-decisions.md#decision-register), H-12/H-26).** From 2026-07-27 through
  that date a general founder-direct contact line, routed to `aaron@dive.day`, was authorized here —
  the same promise the "You can reach the founder" section on `/about` made in prose. It is
  rescinded outright, not reworded down again: a solo-founder company cannot durably hold a
  personal-response standard at any real scale, and the promise read as small-time rather than the
  positioning DiveDay wants. **What replaces it:** a plain `support@dive.day` inbox, reaching the
  same small team without naming an individual or promising a response time — phrase it as "write in
  and a real person reads it," never "the founder personally answers" or any response-time
  guarantee. It appears on `/about` (the "How it's run" section — the hero and founder-biography
  sections stay, since who built DiveDay and why is a claim like any other, not a response-time
  promise), the marketing footer, `/pricing`, the homepage's closing contact band, the sign-up
  reassurance card, and the signed-in shop settings page. **Trial upgrades get their own address,**
  `onboarding@dive.day` — used only for "how do I move a trial shop to paid," on the pricing page's
  trial FAQ, the sign-up form's trial note, and the shop Settings trial-status card (3-week trial,
  soft expiry — see `src/lib/trial.ts`). Both addresses are hosted mailboxes reaching the same
  people as `aaron@dive.day` always did; see
  [docs/engineering/ses-email-runbook.md](../engineering/ses-email-runbook.md#divedays-own-addresses).
- **No fabricated proof.** No invented testimonials, user counts, logos, ratings, or "trusted by"
  language — ever. When real customers exist, their words go through the product owner first.
- **Biography is a claim like any other.** `/about` names a real person and describes real history,
  so shipped-only becomes *true-only*: no employer, credential, certification level, or origin
  anecdote goes on the page unless the product owner has confirmed it. A session may not infer a
  founder fact from a repo document, a commit, or a plausible-sounding draft. Statements about the
  industry ("shops lose money on X") are claims too — either cite a documented source the way a
  switching guide cites an incumbent, or phrase it as what the founder personally observed, which
  needs no source but also may not be invented on his behalf. The corporate entity stays off the
  page entirely until the entity decision closes. **Confirmed by the product owner 2026-07-25** and
  published on `/about`: a software engineer who worked on Google Maps, helped build a biotech
  company that went public, and works on self-driving cars; and the origin — a
  conversation with a dive shop owner about what his systems were costing him. Anything beyond that
  list needs its own confirmation — **the founder's home location is explicitly not confirmed and
  must not appear on the page**; an earlier draft stated "made in Florida" without confirmation and
  that was a real violation of this rule, corrected 2026-07-25. **Confirmed by the product owner
  2026-07-25:** DiveDay now has a second person contributing (legal and outreach, also a diver), so
  `/about` may honestly speak in plural/team voice for what both share (being divers, the mission)
  — but Aaron remains the sole owner (matches H-04) and the sole developer, so anything that is
  specifically his — the founder-biography section, the retired founder-direct support line — stays
  singular and scoped to him, not generalized to "we." (The "Who builds it" credential block that
  used to carry the CV was **removed from `/about` 2026-08-05** on the product owner's call — it did
  not tell the story well. The confirmed facts above stay confirmed and may be used again; the block
  itself is gone, not merely reworded, so do not restore it as a row in the facts list.) The
  hero must not imply DiveDay is one person with nothing behind it either: it is accountable and
  personal, but the parts a shop's season depends on — payments in the shop's own Stripe account,
  the export ZIP, the weekly backup to storage the shop owns, roll call working offline — do not
  rest on any individual, and that is the honest reassurance rather than an invented headcount.
  The second person is deliberately **not
  named and has no stated title**; a session may not name her, assign her a title, or state her
  certification date, tenure, or any fact about her beyond "a second person, a diver, working on
  legal and outreach" without new confirmation. **Confirmed by the product owner 2026-07-27:** the
  page no longer states a certification year for Aaron — do not reintroduce one without fresh
  confirmation.
- **Competitor statements must be documented fact** (their own pages, FAQs, pricing) and phrased
  factually. Prefer contrasting with the *buyer's fear* (setup fees, add-on stacks, export limits)
  over naming the rival. Switching guides may name incumbents; they cite sources and never
  speculate.
- **Anchoring the price against a rival's is the one place naming them earns its keep** — a flat
  number means nothing until the reader sees the model it replaces. `/pricing` carries that anchor
  (`marketing.pricing.feeAnchor.*`), and it is bounded hard: only figures already documented in a
  switching guide may appear, each presented as *the incumbent's own published terms* and linked to
  the guide that carries the citation; an unpublished fee is stated as unpublished and attributed to
  whoever reported it (FareHarbor's ~6%), never as their price. **No figure for what a shop pays in
  practice, no booking volume, no savings arithmetic, no "typical shop" —** with zero customers we
  have no basis for any of it, and a comparison invented to flatter the flat price is the same
  fabricated-proof failure as an invented testimonial, wearing a spreadsheet. A figure not already
  in the repo does not go on the page; it goes into a switching guide first, with its source.
- **The price renders only from `src/lib/marketing.ts`.** Never restate the figure in prose, docs,
  JSON-LD literals, or images — every copy is a future stale claim. The product owner has **approved
  the price for now** (H-12, 2026-07-24; early-access and still moving), so it may be shown from
  `marketing.ts` as today's price. H-12 also closed two commercial terms, now published as
  founding-shop claims (the price hero's "What the price covers" list + FAQ in
  `src/app/pricing/page.tsx`, closing band in
  `src/app/page.tsx`, both sourced from `earlyAccessPrice` in `marketing.ts`): **price locked for
  two years for the founding cohort** and **founder-direct support** for the founding cohort.
  **H-26 (2026-08-02) confirmed DiveDay's posture is deliberately lifestyle-scale, not
  venture-scale** (see [vision.md](vision.md#what-kind-of-business-this-is)) and dropped the
  earlier "same-day response" wording from the support claim — keep the support commitment worded
  as a founder-direct line, without a stated response-time SLA, until support-hour capacity is
  scoped for real. Billing cadence, taxes/fees, and the contract flow remain undecided
  ([human-decisions.md](human-decisions.md)); do not publish billing terms through any new channel
  without that decision. The two-year price lock and the founder-direct support promise are
  **binding commercial commitments** and taxes/fees are jurisdiction-dependent — both carry an open
  legal/tax-review dependency (H-12); do not treat the closed *price* as clearing them.
- **Offline claims stay precise and human**: the device keeps its own copy current automatically
  while online, with a manual "Refresh now" for right before losing signal; it never transfers
  between devices or guarantees stale readiness is live. Captain's words ("this phone stays
  ready", "checked again when service returns") — the machinery (encryption, reconciliation) stays
  in ADRs, never in copy ([design/principles.md](../design/principles.md) §4).
- **Safety-adjacent copy** (readiness, manifests, medical, cert gating, nitrox) gets
  `dive-domain-expert` review before merge, same as safety-critical code.
- Multi-location operation and unconfigured provider integrations are out of scope and must not be
  claimed.

## Voice

The product voice ([design/principles.md](../design/principles.md) §4 — competent divemaster, not
a lawyer or a mascot) applies, plus marketing-specific rules:

- **Headlines state an outcome in the buyer's world**, not a category label. "Roll-call buttons big
  enough for wet thumbs" beats "mobile-first manifest management". Test: could a rival paste this
  headline onto their site truthfully? If yes, sharpen it. **The test binds `/about` too**, which is
  where it is easiest to forget: that page's hero read "Built by divers, for divers." until
  2026-08-03 — true of every dive-adjacent vendor alive, and therefore an eyebrow wearing a
  headline's clothes. A trust page that opens with a sentence anyone could sign has spent its most
  valuable line arguing nothing. It has since failed three more times in the *other* direction, all
  recorded in `e2e/marketing.spec.ts`: "One person owns every line of code running on this boat."
  conceded smallness until it read as a vendor with no infrastructure behind it; "Small enough to
  answer you." (2026-08-05 to 2026-08-12) spent the line on the company's size — the one fact about
  DiveDay a buyer has no reason to want; and "We'd rather be checked than believed." fixed the
  register but picked a fight, presuming the reader's distrust and answering it with a dare. The hero
  is now **"Your season doesn't hang on us."** — the reassurance stated as a fact about the shop's
  operation rather than a posture about us, with the sentence beneath it carrying the proof (the
  shop's own Stripe account, the export ZIP, roll call with no signal). **The lesson that outlived
  all four:** on this page the headline's job is to say something true about *the buyer's* position,
  not to characterize DiveDay — as a vendor, as a size, or as an attitude.
- **Concede the facts; never apologize for them.** This is the rule the page-level version of the
  claims policy kept losing. "DiveDay is new", "it doesn't do everything", and "it's still moving"
  are honesty the policy requires, and they stay. What is banned is the register that grew up around them — by
  2026-08-12 nine framings of *we're small, we're new, you've never heard of us, don't take us on
  faith* had accumulated across the five pages, including the `/about` H1, the lead-in to its four
  checkable rules, the homepage's export band, `/product`'s honest-no, and the `/pricing` FAQ
  question "DiveDay is new. What happens to my data if this doesn't work out?" Every one read as
  reasonable candor alone; together they argued the buyer out of the sale before the product got a
  word in. The fix in each case was to keep the fact and drop the flinch — the pricing question is
  now "What happens to my records if I leave?" with the same answer underneath. **A test enforces
  this** ("no marketing page apologizes for the company's size or age"), pinning the specific
  phrasings out by name, because each one shipped as a sentence its author thought was honest.
- **Concrete nouns over software jargon.** The buyer runs a shop, a counter, a boat — not an
  "operating system", "platform", or "solution". Name what DiveDay replaces: the whiteboard, the
  clipboard, the three apps and a spreadsheet.
- **Show the screen before describing it, and never inventory the same thing twice.** The feature
  claims exist at two densities on purpose — `featuresPerGroup={1}` is the summary card (`/`,
  `/pricing`), and the full inventory is `productCapabilityIndex`, rendered flat on `/product` as a
  spec sheet: group name on a left rail, terse lines in two columns, hairline rules, no boxes.
  There were three until 2026-08-13. `/product` used to render *all* of `productFeatureGroups` (30
  bullets) about a thousand pixels above a `<details>` holding 46 better organized ones covering
  the same ground; a reader scrolled one wall of bullets to reach a longer one. Cutting the middle
  density left the page announcing "the whole list, plainly" above a heading, two lines and a "The
  full list" link in an otherwise empty band — so the disclosure went too, and the list a buyer
  came for is simply on the page. Pricing had already been cut back for the same reason. Before
  adding a list to a page, check the other density: the answer is usually a mockup or a link, not a
  second copy.
- **No unprovable superlatives** ("everything", "best", "complete") — scope claims to what ships:
  "from booking to head count".
- Buttons are verbs; eyebrows are short; body copy earns each sentence. Read it aloud as a dive
  briefing — anything you'd be embarrassed to say to a captain's face gets cut.
- **The demo CTA has exactly one name, site-wide: "Try the live demo."** It once shipped as "Try
  the staff app" on the homepage while other pages said "Try the live demo" — jargon a first-time
  visitor can't parse, and one action wearing three labels reads as three different products. Every
  button that submits `enterDemoAction` uses the shared label (`nav.tryDemo` /
  `marketing.common.tryDemo`); don't introduce per-page synonyms.
  **The wording, and why it won (recorded 2026-08-03):** the rename adopted the label `/product`,
  `/pricing`, `/about` and every `/switching` page were already using rather than inventing a third
  — the homepage was the outlier, not the standard, so the cheapest correct move was to make the
  outlier conform. "Try" states the commitment level (look, don't buy), "live" answers the question
  a static screenshot raises, and "demo" is the word a shop owner already uses for it; "staff app"
  named an internal architecture boundary a buyer has no reason to know and, worse, implied the
  diver-facing half was a different purchase. The funnel tags did **not** change with the label —
  `home-hero`, `home-mid`, `home-closing` still mean what they meant, so attribution history spans
  the rename. This closes the MKT-F4 half of **HD-25**; the remaining HD-25 calls (MKT-F5's "most
  shops…" wording, MKT-F10's offline roll-call claim versus the V-02 embargo) are untouched by it.
- **The demo's cost is stated once per page, at the first door.** `marketing.common.demoNote` ("no
  sign-up, no card") answers the only question the button raises, and the answer is worth nothing
  the second time: repeated under every demo button it stops reading as reassurance and starts
  reading as insistence. It sits with the *first* demo button a reader meets — the homepage hero,
  not the homepage close — because that is where the decision is made; a reader who scrolls past it
  has already read it. Deleting it from a page entirely is a different change and not an allowed
  one: `e2e/marketing.spec.ts` asserts it on `/`.
- **One primary CTA per screen.** Each marketing page carries its own primary (demo on `/` and
  `/product`, the trial on `/pricing` — in its price hero, and again in the closing band beneath
  the FAQ, tagged `pricing-close` so the second position is measured separately); the nav's
  "Start a trial" stays secondary weight so
  it never competes, and it hides entirely on `/onboard`, where it would link to the page it's on.
  **The homepage hero is the scarcest screen on the site and is capped at one primary plus one
  secondary** — it once offered around nine choices (a five-chip role picker, a diver-preview link,
  demo, trial), which is a menu, not an ask. Cutting a hero control never means deleting the
  destination: the roles moved into the in-demo switcher, the diver preview into the daily-moments
  row it illustrates, and both are still reachable and still tagged. `e2e/marketing.spec.ts` counts
  the hero's enabled controls so the budget can't quietly grow back.
  The internal positioning pillars ("easy to try", "safe to leave") are argument structure, not
  user-facing labels. **A label a reader sees names a thing, not a strategy** — and after the
  2026-08-13 redesign the homepage names things in two idioms, deliberately: an uppercase eyebrow
  for a whole thing (the hero's category line, the breadth band's four capability groups), and a
  sentence-case marker with a hairline rule for a *part* of a section (a moment's place in the day,
  a direction in the records diptych). The redesign deleted the standing section eyebrows that
  merely restated the heading beneath them ("Your records", "Try it", "The whole shop, one place");
  a heading that needs an eyebrow to be understood is a heading that needs rewriting.

## SEO and shared links

Search and shared links are our only free inbound channels; every public page carries the full
substrate:

- **Every public page has page-level metadata**: a title that leads with what a buyer would type
  (the category term "dive shop software" belongs in the home title), a description in the product
  voice, a canonical URL, and Open Graph + Twitter card data — these pages get shared in shop
  owners' chat groups, and a bare link is a lost visit.
- **Twitter-card policy (HD-25, adopted 2026-08-03).** A page uses `summary_large_image` when a
  link-preview image resolves for it, and `summary` when none does — a large-image card with no
  image unfurls worse than a small one, so the card type follows the image rather than being chosen
  page by page. Every marketing page is `summary_large_image` today because every one of them names
  the shared card. Each page writes the block itself, restating its own `title` and `description`
  rather than letting the root layout's site-level words stand in, because a card is what a stranger
  reads before deciding to click; `src/app/layout.tsx` keeps `twitter.card` as the app-wide default
  so a new page can never unfurl with none, and the per-page block is what makes it *say* something.
  A page that ever ships without an image — a bare form, a legal notice — sets `summary` in the same
  change that removes the image. Coverage is a test, not a habit: `e2e/marketing.spec.ts` walks every
  marketing route and asserts the OG block, the image, and the card triple on each.
- **A page-level `openGraph` block replaces the root layout's — it does not merge into it.** Next
  merges `metadata` shallowly, so the moment a page exports its own `openGraph` (every marketing page
  does, because a shared link has to unfurl with *that page's* words) it loses `siteName`, `type`,
  and the shared link card from `src/app/opengraph-image.tsx`. File-based image metadata is collected
  per route segment, so the root card re-attaches only to pages in the root segment — `/` — and every
  other marketing route was unfurling image-less until 2026-08-03. That is why `sharedLinkCard` in
  `src/lib/marketing.ts` exists and why every page except `/` spreads it into its `openGraph`. The
  failure mode is what makes this worth a rule: it is invisible from inside the app and only shows up
  in someone else's chat window, which is precisely where these pages do their work.
  The site-level half of that pair — `siteName` and `type` — is `openGraphSite` in
  `src/lib/site-metadata.ts`, and it reaches further than the marketing surface: **every page that
  exports an `openGraph` block spreads it first**, including `/` (which supplies its own card by file
  convention and so does not spread `sharedLinkCard`) and every route under `/s/`. Until 2026-08-12
  the result read backwards from outside — a page with nothing to say about itself carried
  `og:site_name` by inheritance and no `og:url`, while the homepage and every shop page carried
  `og:url` and no site name at all. `e2e/seo.spec.ts` and `e2e/marketing.spec.ts` assert the pair on
  the routes they name, and `pnpm check:open-graph` (`scripts/check-open-graph.mjs`, part of
  `check:repo`) refuses any `openGraph` block under `src/app` that does not spread one of the two —
  those e2e route lists are hand-maintained, so a page added tomorrow is not on them.
  `og:url` stays absent on bearer-token pages by design: there the URL *is* the credential, and an
  unfurl renders for bystanders who never clicked the link.
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

## Measuring which story converts

Page views alone can't tell us whether a page persuaded anyone, so both marketing conversions are
typed events in `src/lib/analytics.ts`, each carrying the same `source` tag naming the page that
sent the visitor:

| Event | Fired by | Meaning |
| --- | --- | --- |
| `demo_entered` | `src/app/actions/demo.ts` | A skeptic chose to look — the low-commitment half |
| `trial_started` | `src/app/onboard/actions.ts` | A shop of their own now exists — the committed half |

Both fire **after the outcome they name**, deferred with `after()` — a rate-limited demo attempt or a
refused sign-up is not an entry, and counting one would inflate the numerator of every ratio read off
the pair. Both also email the founder as they fire, so neither half needs a dashboard to be noticed:
`new_account_alert` for a trial, `demo_started_alert` for a demo try, both to `alertRecipient()`
(overridable with `OPS_ALERT_EMAIL`). The demo alert is anonymous by construction — the shop slug,
the role, and the tag below, and nothing about the visitor, who never identified themselves. See
[ADR 20260805-demo-try-alerts](../architecture/decisions/20260805-demo-try-alerts.md).

The tag vocabulary is a closed registry in `src/lib/funnel.ts`, because the failure it prevents is
silent: a misspelled tag doesn't error, it opens a second bucket that reads like a real page with
suspiciously few visits. So a demo form tags itself with `<FunnelTag source="…">` and a trial link
builds its href with `trialHref("…")` — both type-checked against the registry — and a tag arriving
off a request goes through `eventSource()`, which returns `unknown` for anything unregistered.
**Adding a marketing CTA means tagging it**, and a new page means adding its tag to the registry
first; an untagged link is a conversion we can't attribute. Read the pair per surface: a page with
demo entries and no trials is telling you something different from a page with neither.

**A page that offers the same action from more than one place splits its tag by position** —
`home-hero` / `home-closing`, `product` / `product-mid`, `pricing` / `pricing-close`.
Mid-page and closing doors exist because
one CTA at the bottom of ten sections is a scroll a convinced reader shouldn't have to make; folded
into the page's own tag, such a door can never be shown to have earned its place, and the next
review re-opens the same question with no evidence either way. The unsuffixed tag stays the page's
original one when a position is added beside it, so attribution history spans the change. A door
can also be retired: the homepage's `home-mid` came out on 2026-08-13 when the page's three
consecutive banded CTAs merged into one close (the 2026-08-13 homepage redesign), which moved the
closing door a full band nearer; the tag stays registered in `funnel.ts` so any history it
accumulated still reads.

## Product visuals

The public pages ship deterministic illustrated mockups as the design — not captured screenshots.
Each visual is a small, hand-built component in `src/components/MarketingScreenFallbacks.tsx`
rendered through the shared wrappers in `src/components/MarketingSections.tsx`:

| Component | Represents | Marketing use |
| --- | --- | --- |
| `DiverBookingFallback` | Public schedule | Diver booking moment |
| `FrontDeskReadinessFallback` | Staff trip readiness | Desk / safety explanation |
| `CaptainRollCallFallback` | Captain manifest roll call on a phone | Dock / captain moment, `/about` hero |
| `ImportPreviewFallback` | The contacts importer's preview step | `/switching` hub, and the homepage records band |
| `ExportBundleFallback` | Settings -> Data export | `/pricing`'s "if you leave" band |

**A mockup is a claim, so it mirrors a real screen element for element.**
`ImportPreviewFallback` exists because "we show you exactly what comes across" was the switching
surface's whole promise and was being made only in prose; it reproduces the wizard's mapped-column
chips, its "Not recognized, so ignored" line, three of its eight stat tiles, and its row table with
the same `skipped` badge — including, deliberately, the parts that make DiveDay look *less*
capable (a column it can't read, a row it won't import), because those are what make the rest
believable. Add a mockup the same way: find the shipped screen, mirror it, and keep the
unflattering parts in.

`ExportBundleFallback` (2026-08-12) is the same move on the other direction of the same wedge, and
`/pricing` was the last marketing page with nothing to look at. It mirrors Settings -> Data export:
its eyebrow and title, the one download button in its header, the "What's in the bundle" row with
the real file count on it, three real `EXPORT_FILE_NOTES` entries with their own notes and row
counts, and the "Not included, on purpose:" line naming credentials as something that never leaves.
It draws no `photos/` row on purpose -- the bundled images are a directory in the zip, not one of
the counted files, so a row for them would be an element the real screen does not have, and the
band's own copy is where the photos claim belongs.

It sits between the fee anchor and the included list rather than in the FAQ, because that is where
the objection lands: the fee anchor has just made switching look attractive, and the next thought a
shop owner has is about being stuck again. The `faq.dataIfNotWorking` row still answers it in words
for a reader who scans that far.

**The homepage records band shows both halves, in the order the copy argues them**: the import
preview (arriving) beside the export inventory (leaving). Arriving is a picture — the importer's
real preview step, because "we'll show you exactly what comes across before anything saves" is a
claim only a screen can settle. Leaving is a list, because what a shop wants to know on the way out
is *what is in the box*, and a mockup of a ZIP file shows nothing. That band is the portability
wedge, which is DiveDay's strongest claim against every incumbent, and until 2026-08-12 it made
that claim in two paragraphs and a checklist — all telling, on the highest-traffic page on the
site.

**Its geometry is the claim.** On 2026-08-13 the band stopped being a copy-left / visual-right
split — the third section in a row on that page to use one, after the hero and the first daily
moment — and became a mirrored diptych: one statement, then two equal columns divided by a rule,
same marker, same weight, arriving left and leaving right. "Come in clean, and *leave the same
way*" is an argument about symmetry, so the section that makes it is the one place on the page
where the layout should be symmetric. The two column markers ("Coming in" / "Going out") are the
copy that used to open each paragraph — `exportDescription1` lost "Arriving is a file, not a
project" for "A file, not a project", `exportDescription2` lost "Leaving is built to the same
standard as arriving", and the export card's own "In the export" eyebrow retired rather than sit
stacked under "Going out". The inventory also lost its card border and became a hairline manifest:
a second rounded box beside the import mockup read as the mockup's twin, when the two halves are a
picture and a list.

**The homepage's four-card breadth band is deliberately still four assertions.** It renders
`FeatureGroupsGrid` at `featuresPerGroup={1}` under the whiteboard/clipboard statement, and it is
now the only band on that page that asks a reader to take a claim on trust. It was reviewed on
2026-08-12 and again in the 2026-08-13 redesign and left alone, with the reason stated rather than
deferred: the band exists to give breadth in one glance and hand the reader to `/product`, and
replacing it with imagery would cost that breadth. Revisit it when the page-level
`demo_entered`/`trial_started` pairs (`home-hero` / `home-closing`) have numbers; if the page
converts poorly at this midpoint, the change is a visual *beside* the four cards, not instead of
them. (The mid-page demo door that used to sit under the cards retired in the same redesign — the
merged close is one band away, and three banded CTAs in a row read as pressure, not confidence.)

**`SectionMarker` is deliberately page-local.** The homepage's kicker — a short sentence-case label
with a hairline rule running out to the edge of its column — lives in `src/app/page.tsx` rather than
beside `MarketingMockup` and `FeatureGroupsGrid` in `src/components/MarketingSections.tsx`, and that
is a decision rather than an oversight. It was reviewed on 2026-08-14, after the product-page and
switching-guide redesigns that made the shared file untouchable had both merged: the homepage is
still its only caller, and no other marketing page has grown the idiom — the three remaining
`h-px flex-1` rules in the tree are the public schedule, its loading skeleton, and the schedule
builder, none of them marketing. Promoting a one-caller atom is how a shared module fills up with
things nobody else wanted. Move it the day a second marketing page wants the same kicker, keeping
its `as?: "p" | "h3"` prop — the portability diptych's columns need the `h3` (the marker is their
only label, so it carries them in the document outline) and the daily-moment rows need the `p`
(they already have an `h3` below).

These mockups render identically in every checkout and in both light and dark modes, and they use
only semantic tokens, so keeping them truthful is a matter of editing the component copy when the
product it depicts changes. There is no browser-capture step: `public/marketing/*.png` is not used.
Reintroducing real-screenshot capture (with the tracked assets and a capture script that produced
them) is a deliberate, ADR-gated decision if the mockups ever stop being enough.

## Where the words live

**Every word a visitor reads lives in the locale bundles** —
`src/i18n/locales/<locale>/diver.json`, edited for **every locale in the same change** (the
check:locale gate enforces coverage). The files below are where each surface's *keys and
structure* live; none of them may contain an English sentence:

| Content | Structure / keys | Words |
| --- | --- | --- |
| Feature claims shared across pages | `src/lib/marketing.ts` (`productFeatureGroups`, key registry) | `marketing.features.*` in the bundles |
| Price, plan name, included list | `src/lib/marketing.ts` (`earlyAccessPrice`) — the `$99` figure is the only literal, and the only place it exists | `marketing.price.*` in the bundles |
| Export claim shared by home + pricing | `src/lib/marketing.ts` (`fullShopExport`) | `marketing.export.*` in the bundles |
| Shared link-preview card fields every page's `openGraph` needs | `src/lib/marketing.ts` (`sharedLinkCard`) | none — URLs and dimensions, no words |
| Capability index on `/product` | `src/lib/marketing.ts` (`productCapabilityIndex`) | `marketing.capabilities.*` in the bundles |
| Page-specific narrative copy | The page file (`src/app/{page,product/page,pricing/page}.tsx`) | `marketing.home/product/pricing.*` in the bundles |
| Sign-up reassurance (no card, the exit, the founder line) | `src/app/onboard/page.tsx` | `account.onboard.*` in the bundles |
| Who builds DiveDay, and what it concedes | `src/app/about/page.tsx` | `marketing.about.*` in the bundles |
| Mockup copy | `src/components/MarketingScreenFallbacks.tsx` | `fallback.*` in the bundles |
| Nav / footer | `src/components/MarketingNav.tsx` / `MarketingFooter.tsx` | `nav.*` in the bundles |
| Switching-guide content (per incumbent) | `src/lib/migration-guides.ts` (key registry; slugs, URLs, source citations); pages in `src/app/switching/` | `marketing.guides.*` in the bundles |

A claim used on more than one page belongs in `src/lib/marketing.ts` as a shared *key*, not
copy-pasted. The key-registry files hard-fail `pnpm check:domain-strings` on any unexempted
prose literal (`proseFreeFiles` in the script), so a claim written as English in the registry
never reaches a review. Page `metadata` blocks (titles/descriptions for search engines and link
unfurls) are the deliberate exception: they stay English in the page file until a locale-routing
decision exists, because a single canonical URL serves one `<head>` to every crawler.

A switching guide is a live page only — no roadmap or "coming soon" entries (claims policy).

**A switching guide may carry exactly one forward link to `/pricing`, and it sits under the coexist
section's leave-path box** (decided 2026-08-14). Two of the guides argue hard on an incumbent's
per-booking fee — FareHarbor's, Rezdy's — and then gave the reader nowhere to learn what DiveDay
costs except the nav tab several thousand pixels above them. The link is worded as a destination
(`switching.common.seePricing`), never as a claim: no figure, no "flat price", no comparison and no
savings arithmetic, since the price renders only from `src/lib/marketing.ts`. It is deliberately
*not* in the closing band, which already carries three controls. `/pricing` links back to the guides
for the fee citation, so this closes that loop rather than opening a second one; a second forward
link anywhere on these pages is not covered by this and needs its own decision.

**Per-location pricing stays exactly as published** (decided 2026-08-14, closing
FU-20260813-per-location-price-has-no-location with no change). `/pricing` charges "per location /
month" for a product whose `shops` row is one location, which reads like a priced dimension the
product does not have. It stays anyway: the phrase sets a two-storefront operator's expectation at
two subscriptions *before* anyone signs, which is far easier than raising it later, and the pricing
FAQ already answers the question honestly ("Each DiveDay shop runs one location today… email us").
Implying the capability *could* exist is acceptable here precisely because a multi-location shop has
to reach out directly regardless, which is where the real conversation happens. Do not "tidy" the
cadence to "per shop" — that is a pricing change wearing a documentation cleanup's clothes.
Each names one incumbent's own export click-path, renders the import scope table from
`IMPORT_HONESTY_TABLE` verbatim (never paraphrased), and ends on a demo CTA. Every incumbent claim
is documented fact from [assessments/competitive-strategy.md](assessments/competitive-strategy.md),
carrying its own `sources` (rendered on the page) and phrased factually, never speculative; the
safety-adjacent scope copy gets `dive-domain-expert` review like any other. Add a guide by writing
its `MigrationGuide` entry — only once its export path is verified, since every registered entry is
a published page (there is no draft/planned state). A guide is also **retired** by deleting that
entry (its bundle keys, hub card, route, and coverage rows go with it) when the incumbent stops
being worth a page — the DiveAdmin guide shipped 2026-07-23 and was retired 2026-08-05 on market
share, and the strategy doc keeps the dated record.

**Every switching surface reads in both directions.** The wedge is not "escape your incumbent", it
is "your records import cleanly when you arrive and export cleanly if you ever go" — the no-lock-in
point is a *reason to join*, not a goodbye, so a page that only walks a shop out of somewhere else
is only half written. Concretely: the hub says so in its own words, and every guide (incumbents and
`/switching/spreadsheet` alike) carries the shared `switching.common.bothWays*` block directly under
the scope table, composing `fullShopExport`'s `claimKey`/`termsKey` rather than re-authoring the
exit promise. The homepage's records band follows the same order — arriving first, leaving second.
Never let a surface restate the export claim in its own words; that is what the shared keys exist
to prevent.

A guide for a booking/distribution **channel** rather than a records system (today: **FareHarbor**
and **Rezdy**, general tours engines) additionally carries an optional `coexist` block and is
**coexist-led**: it opens with "keep the storefront and its network, run the dive day it can't" —
the product page's "bring your POS, we run the water" division of labor extended to a booking
channel — then offers the clean leave path (DiveDay takes the booking, the recurring/per-booking fee
stops) over the same shared export/scope/import mechanics. Two extra honesty rules bind these:
**never imply an integration or live sync** (coexistence is "run alongside, bridged by the CSV
import"), and **never state a competitor's unpublished fee as their published price** (FareHarbor's
rate is reported-only, "reported at around 6%"; Rezdy's 3% is dated to its current published page).
See [assessments/fareharbor-positioning.md](assessments/fareharbor-positioning.md) for the pattern
and [assessments/switching-guide-landscape.md](assessments/switching-guide-landscape.md) for which
channels get a guide next.

The one non-incumbent guide is `/switching/spreadsheet` ("Coming from a spreadsheet"). A shop on a
spreadsheet has no vendor to leave, so the page has no incumbent context, no export click-path to
reverse-engineer, and no `sources`; it lives as its own static route rather than a
`migration-guides.ts` entry (a static segment wins over the sibling `[competitor]` one). It still
renders `IMPORT_HONESTY_TABLE` verbatim like every guide — the shared honesty invariant — and it
carries the shared `SwitchingConcierge` offer like every switching page. Its wedge is not
portability (a spreadsheet never locked anyone in) but the jobs a list can't do: readiness checked
at the dock, the blocker queue, the no-login diver arc.

## Maintenance loop

- **A feature ships → the pages move in the same PR** when it changes what a buyer would be told:
  update `productFeatureGroups`, the relevant page moment, and any mockup it depicts. The
  new-feature skill's definition of done includes this check.
- **A claim is invalidated** (feature removed, behavior changed) → fix the page in the same PR
  that invalidates it. If code and copy disagree, one of them is the bug.
- **Verification is the product bar**: `pnpm check` green; `pnpm e2e marketing.spec.ts`;
  screenshots of every touched page in light + dark, desktop + phone, actually looked at
  (design-review skill); visual triage after push (visual-triage skill).
- Copy changes update the e2e assertions that pin headlines/price visibility — deliberately: a
  failing marketing spec on a copy change is the test doing its job.
- **Re-check positioning** (this doc's spine + the assessments) when: a rival ships a response
  (DiveAdmin bulk export/webhooks, any DiveShop360 API), the H-12 pricing decision lands, or the
  first paying shop exists — real social proof reorders every argument above.
- The `marketing-page` skill is the executable form of this document; if it and this doc disagree,
  fix whichever is stale in the same PR.
