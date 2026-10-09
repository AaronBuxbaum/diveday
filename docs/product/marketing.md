# Public marketing surfaces — what they are and how to write them

DiveDay's public pages are the homepage (`/`), product page (`/product`), the twelve feature pages
under it (`/product/<feature>`), pricing page (`/pricing`), the about page (`/about`), and the
onboarding entry (`/onboard`); switching guides (`/switching/*`) join them as they ship. They are a truthful sales surface for the product that
exists today.

This document is the living rulebook for those pages: the positioning they argue, the claims they
may make, the voice they use, and the maintenance loop that keeps them true. The dated case for the
current direction is [archive/marketing-review-20260723.md](archive/marketing-review-20260723.md)
(fully delivered, kept for rationale); so is the conversion pass argued in
[marketing-review-20260827.md](marketing-review-20260827.md), whose slices 12a–12f all landed on
2026-08-28 — what is left of it is one owner call, the leave-it guides' pricing link, which was
never a slice; the step-by-step editing procedure is the `marketing-page` skill.

**These pages are product surface.** DiveDay is developed exclusively by AI sessions, so marketing
has no separate team, tooling, or CMS: copy is code, reviewed like code, tested like code
(`e2e/marketing.spec.ts`, and the marketing captures in `e2e/visual.spec.ts`), and governed by this doc the same way
`schema.ts` is governed by the schema-change skill. A session editing these pages carries both
jobs — marketer and maintainer — and must leave both the pages and this rulebook consistent.

## One page per feature, and every section sells (decided 2026-10-05, H-93)

The owner's brief on 2026-10-05 was that the pages were not selling, and that every interesting
feature should be listed, explained and sold on a page of its own. Three things stood in the way:
headlines that described the page rather than what a shop gets ("Four screens from a dive shop's
day, with notes from the person who made them"), a voice rule (H-89) that kept a page from saying
why any of it matters, and an inventory of every shipped workflow of which the pages argued four
and listed the rest in a closed index on `/product`.

- **Twelve feature pages**, at `/product/<feature>`, one per job a shop buys software for: online
  booking, the shop's website, waivers and medical forms, certification checks, messages, check-in,
  the boat manifest and roll call, dive sites, rental gear, the schedule and crew, courses, and
  payments. The list, its order, and each page's demo role, landing screen and three related pages
  are one registry, `src/lib/feature-pages.ts`. An unknown slug is refused at the edge
  (`src/lib/public-route-shape.ts`), and the sitemap lists all twelve.
- **One template**, `src/app/product/_components/FeaturePageBody.tsx`: the hero says what the shop
  gets in one sentence of lede beside the screen that proves it, with three builder's notes, and
  the price under its doors; then how it works in three steps; then everything the feature
  includes, which is that feature's whole group of `productCapabilityIndex`, and the plan's terms beside it (the flat price, and the
  Data export button with `fullShopExport`'s terms); then three questions shops ask, marked up as
  `FAQPage`; then the close; and last three related pages, for the reader the close did not
  convince yet. The order is the order a buyer's doubts arrive in, and the ask lands at the end of
  the argument rather than after a detour (conversion review, 2026-10-05). Every page has every
  section, and `src/lib/feature-pages.test.ts` refuses a page whose copy has a field the others
  lack.
- **The demo opens on the page's screen.** The hero's "Try the live demo" carries the page's role
  and landing (`src/lib/demo-landings.ts`, a closed list the server action re-checks), so a reader
  of the gear page arrives on the gear register as the owner, not on Today. The two pages about what
  a diver sees (online booking, the website) open the demo shop's public schedule instead. The demo
  note under the first door says where it opens and as whom
  (`marketing.featureChrome.demoNote`, filled with the page's `demoPlace`), because on four pages
  the drawing is the diver's phone and the door lands on the staff side; it is still the one note
  per page the rule below asks for, with the demo's cost in its second sentence.
- **The inventory is filed by page.** `productCapabilityIndex` holds one group per feature page,
  in the registry's order, plus the groups only the hub lists (divers, the shop, records). A
  shipped workflow joins the group of the page a buyer would look for it on, and a feature page's
  checklist is its group, whole.
- **The homepage follows one booking** (`src/app/page.tsx`). The title says what the shop gets
  ("Every diver booked, signed, checked and accounted for") and the lede says what DiveDay is: the
  jobs it does, in one app, for a dive shop. Then five steps in the order a diver meets the shop:
  book, sign the release and medical form, the morning check, the roll call after the dive, and the
  recap. Each is a screen, two builder's notes and a link that names the feature page. Check-in at
  the counter was a sixth step until review the same day: its screen read as the morning check's
  twin, and its one claim was the only one on the page a rival makes. Its page is still in the
  directory below.
  A step ends in its feature page rather than in a door into the demo, because that page's own door
  opens the demo on the same screen as the role that uses it. The page keeps its two demo doors,
  hero and close.
- **Every feature page is linked from `/` and from `/product` by one component**,
  `FeatureDirectory` (`src/components/MarketingSections.tsx`): the pages filed under the part of a
  shop's year they serve (`FEATURE_PHASES` in the registry: before the dive day, on the day, across
  the season), each row the page's name and one-sentence summary, the whole row the link. The rows
  come off the registry, so a page added there is listed on both without either page naming it.
- **`/product` is the hub**: the hero, one list, what DiveDay doesn't do, and the close. The list
  is the directory with the full inventory folded into it: under each feature page's row, a closed
  disclosure counts and holds that page's checklist, and the three groups no page owns (the diver
  record, running the shop, your records) close it under "Also in the plan". Its six-chapter tour,
  the sticky chapter strip and the payment band were deleted the same day; each chapter's screen
  and notes live on the feature page that owns them.
- **What did not change:** the claims policy, the two doors and their order, the demo note once per
  page, the price stated where the question arises, and `/about`'s company voice (H-99).

## The homepage breadth band (decided 2026-08-20, replaced 2026-10-05)

From 2026-08-20 the homepage argued breadth with four numbered cards, one summary paragraph each,
on the reasoning that four screens say "DiveDay has four screens" while four assertions say
"DiveDay covers the whole day", which is what a buyer comparing products looks for at that point
(FU-20260813, closed). The reasoning still holds and the directory above keeps it: it says the same
thing with every feature page by name, and each name is a link to the page that proves it, where a
card's paragraph linked nowhere. `FeatureGroupsGrid`, `productFeatureGroups` and the
`marketing.features.*` keys were deleted with the cards (H-93).

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

Concede loudly what we don't do: retail POS, agency (PADI) sync. An honest no on these buys
trust our claims can't. **Gear inventory is not on that list** — the gear register shipped
2026-08-20 ([shipped.md](shipped.md), ADR
[20260815-minimal-gear-register](../architecture/decisions/20260815-minimal-gear-register.md)), and
the concession outlived it here and in the `/about` truths block until it was swept out. Retail POS
stays declined as a vision non-goal; repair work orders no longer are — the bench shipped
2026-10-08 (ADR
[20261008-gear-work-orders](../architecture/decisions/20261008-gear-work-orders.md)) — and *rental*
gear tracking is a shipped capability: it belongs in `productCapabilityIndex`, never in the concession list. The general rule
this is an instance of — **when a slice ships, sweep the concessions before writing new copy**; a
stale "we don't do X" costs more trust than the honest no ever bought. See
[assessments/competitive-strategy.md](assessments/competitive-strategy.md) for why these are the
chosen battlegrounds — and re-read it before changing the spine.

## The two doors, and which one leads (decided 2026-08-22)

The funnel has two doors — **Try the live demo** and **Get set up** — and the order they are
offered in is a property of the funnel, not of any one page.

**Since 2026-09-25 the second door is a request, not a sign-up** ([ADR 20260925-shops-are-set-up-by-hand](../architecture/decisions/20260925-shops-are-set-up-by-hand.md)). Every shop is set up
by hand, so "Get set up" opens the set-up request form at `/get-set-up?from=<tag>` (since 2026-10-07, [ADR 20261007-setup-request-form](../architecture/decisions/20261007-setup-request-form.md); before that it was a mail), and
`/onboard` without an open single-use setup link ([ADR 20261009-single-use-setup-links](../architecture/decisions/20261009-single-use-setup-links.md)) is one sentence and a door to that same form. Where this section
says "trial" below, read it as that door.

- **The demo leads, everywhere, at every depth.** It is the primary; the trial follows as
  `secondary`. The demo is the claim nobody else in this market can make, and it costs the reader
  nothing.
- **Both doors appear in every closing band**, `/pricing`'s included.
- **The pair is one component**: `src/app/_components/FunnelCtas.tsx`. Order, weight, labels, the
  pending label and the funnel tag are decided there and are not props — a page chooses only where
  the pair sits and how big it is. This is the same move `src/lib/staff-destinations.ts` made for
  the staff nav, for the same reason: without it a new page invents a third arrangement, silently,
  and each page still reviews as fine on its own.

The two exceptions are single doors rather than pairs, and stay as they are. The **nav** carries the
**demo** alone on every page — the same lead door the pair puts first everywhere else, kept as one
door rather than a pair because the header is a persistent low-emphasis slot, not a closing band, and
one tag across all of it would answer no question anyway (see the chrome note under "Measuring which
story converts"). It carried the trial until 2026-08-23 (issue #934): a single door reads as *the*
funnel's opinion of which one leads, so leaving it on the trial was the pair's own rule contradicted
in the one place a reader can see from anywhere on the page. The **`/onboard` footer** offers the demo
alone as a link-weight submit of the demo action, tagged `onboard-demo` (issue #1956; until
2026-10-06 it was a link to `/` under the demo's own label), because the reader is already standing
in the trial — and the nav is hidden entirely on that page (`hideCta`) for the same reason, so the
demo is not pitched twice.

This was recorded because nothing held the funnel's shape and it had already drifted: `/` led with
the demo, `/pricing` swapped the weights under the same two labels, and `/pricing`'s closing band
dropped the demo entirely — offering only the door that asks for an account at the moment a reader
who has just read the whole price page is warmest (issue #785). Each page was written as a page and
reviewed as a page, which is the right unit for copy and the wrong one for hierarchy.

## Claims policy (hard rules)

- **Shipped-only.** Every claim describes a workflow that works in the demo today. No roadmap
  marketing, no "coming soon". If a claim can't be demonstrated in the live demo, it doesn't go on
  a page. The pricing page's included list is held to it line by line: its training line
  (`marketing.price.item4`) is **the demo shop**, DiveDay's one sample shop that "Try the live
  demo" opens, and promises no practice copy of a shop's own (Aaron Buxbaum, 2026-10-05, #1959).
  Until that date it said "a practice shop", which nothing in the code built.
- **Authorized service offers** are the one exception to shipped-only: a commitment the shop makes
  to a customer, not a product feature, may be stated once the product owner has authorized it.
  Currently authorized (a Jane-style concierge, authorized 2026-07-24, extended H-20): **free,
  personal, bidirectional help switching — a person will help a shop bring its data *in* (map any
  export or spreadsheet, migrate the roster with them) and, if DiveDay is ever not right, take its
  data back *out* just as personally.** It lives on **every** `/switching` page as the shared
  `SwitchingConcierge` block, routed to the `switch@dive.day` inbox. Phrase these as a human
  commitment ("we'll map it with you", "we'll help you carry it out"), never as an automated product
  capability, and never promise a turnaround time. **It is offered twice on a guide, and the compressed
  form comes first** (2026-08-28): `switching.common.moveIntro`, the line that opens
  the move rail, ends "Rather hand it off? Send us the file and a person brings your divers in with
  you, free." The full block used to be the offer's only appearance and sat about 80% down every
  guide — *below* the four-phase rail whose whole job is to show a reader how much work switching is
  ([marketing-review-20260827.md](marketing-review-20260827.md)'s third diagnosis, "help arrives
  after the homework"). The reader deciding whether they can face this now meets the alternative in
  the same breath as the work. Compressed at the top, authored once, never re-worded — the same
  shape `midSeasonCutover` uses for the cutover steps and `GUIDE_FACTS.back` uses for the export
  claim. A new service claim needs product-owner sign-off the same way the price does. **A second offer was authorized 2026-09-01 (H-64/H-65): a website, built for you** — a shop asks, and a person at DiveDay builds them one (with Claude, when someone asks; nothing is built ahead of a request). It is a human commitment like the concierge: "ask and we'll build it with you", never a turnaround time, never a page count, never "free website" as a product feature — and priced as part of the subscription until H-65 says otherwise. It may sit beside Harbor's storefront (which *is* a website a shop can point a domain at, and a shipped product claim) on `/pricing`, `/product`, the website feature page (`/product/website`, in its lede and its first question) and the FareHarbor guide, where FareHarbor's own hosted-site price may be stated only as the figure third parties report (FareHarbor publishes none — the Bókun-reported Web Core package, cited in the guide), never as what a shop pays; it is a `sitesPrice` string on the guide interpolated into one sentence, so no bundle carries the figure. Shipped 2026-09-02 as slice 13e: `marketing.price.item7`, the `website` capability group on `/product` (product lines only — the person's offer sits beside the booking chapter, never in the index that promises the demo), and the FareHarbor guide's website ledger. **Founder-direct support retired 2026-08-05 (Aaron Buxbaum,
  [human-decisions/](human-decisions/README.md#decision-register), H-12/H-26).** From 2026-07-27 through
  that date a general founder-direct contact line, routed to `aaron@dive.day`, was authorized here —
  the same promise the "You can reach the founder" section on `/about` made in prose. It is
  rescinded outright, not reworded down again: a solo-founder company cannot durably hold a
  personal-response standard at any real scale, and the promise read as small-time rather than the
  positioning DiveDay wants. **What replaces it:** a plain `support@dive.day` inbox, reaching the
  same small team without naming an individual or promising a response time — phrase it as "write in
  and a real person reads it," never "the founder personally answers" or any response-time
  guarantee. It appears on `/about` (the "How we work with shops" band; since 2026-10-07 the page names no
  individual at all, H-99), the marketing footer, `/pricing`, the homepage's closing contact band, the sign-up
  reassurance card, and the signed-in shop settings page. **Trial upgrades get their own address,**
  `onboarding@dive.day` — used only for "how do I move a trial shop to paid," on the pricing page's
  trial FAQ, the sign-up form's trial note, and the shop Settings trial-status card (3-week trial,
  soft expiry — see `src/lib/trial.ts`). Both addresses are hosted mailboxes reaching the same
  people as `aaron@dive.day` always did; see
  [docs/engineering/ses-email-runbook.md](../engineering/ses-email-runbook.md#divedays-own-addresses).
- **A third service commitment was authorized 2026-10-07 (H-101): the continuity promise.** Aaron Buxbaum, in the project thread: "We can publish that exact promise." The sentence is "If DiveDay ever shuts down, you get 90 days' notice, your export, and your backups keep running until the last day." It answers the objection the demo cannot (a new vendor closing, market audit 2026-10-07 item 46), and it rests on things that ship: the one-ZIP export (`fullShopExport`) and the weekly scheduled backup to storage the shop owns (`src/features/backup-export/`). It is one shared key, `continuityPromise` in `src/lib/marketing.ts` (`marketing.export.continuity`), rendered on `/pricing` as the answer to the FAQ row "What happens to my shop if DiveDay shuts down?" (`faq.shutdown`, beside the records row) and on `/about` as the second paragraph of the "Download every record" card. Its words are the owner's: no rewording, no added timeline or refund, and no other page carries it without a new decision. `src/lib/marketing.test.ts` pins the English word for word and the three commitments in every locale.
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
  list needs its own confirmation. **Confirmed by the product owner 2026-10-06:** the
  disappearance of Tom and Eileen Lonergan is the motivation for building DiveDay, and `/about`
  opens on it. Only what the public record holds is stated: in January 1998 they went out on a dive
  boat to St. Crispin's Reef on the Great Barrier Reef, the boat returned to port without them,
  nobody noticed until their bag was found aboard two days later, and neither was ever found
  ([Wikipedia](https://en.wikipedia.org/wiki/Disappearance_of_Tom_and_Eileen_Lonergan), citing the
  coroner's findings and contemporary press; the
  [Australian Missing Persons Register](https://australianmissingpersonsregister.com/ampr/Lonergans.htm)).
  The operator and skipper are not named, the account carries no adjective, and no sentence says or
  implies DiveDay would have prevented it. **The founder's home location is explicitly not confirmed and
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
  **Amended 2026-10-07 (H-99; Aaron, in the project thread: "Don't talk about the specific people,
  use generalities about people in a company").** `/about` names no individual and states no CV.
  The confirmed facts above stay confirmed and unused; the page describes the people who build
  DiveDay in generalities that are true of them and derived from those facts (people who have spent
  their careers on software that millions of people rely on, and who dive), speaks in the company's
  plural throughout, including the hero's tie to the product ("That story is why we built
  DiveDay"), and no longer carries the concessions band. The Lonergan section and its limits are
  unchanged. `src/app/about/copy.test.ts` refuses a named individual, a first-person singular, and
  the prevention claim in both locales.
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
  `marketing.ts` as today's price. `src/lib/marketing.test.ts` enforces the single source where it
  is easiest to break — no `marketing.*` message in either locale may carry a currency figure, and
  every sentence that shows the price must carry `{price}` and `{cadence}`. H-12 also closed two
  commercial terms, now published as
  founding-shop claims (the price hero's "What the price covers" list + FAQ in
  `src/app/pricing/page.tsx`, the home and product heroes plus the home closing
  band, all sourced from `earlyAccessPrice` in `marketing.ts`): **price locked for
  two years for the founding cohort** and **founder-direct support** for the founding cohort.
  **H-26 (2026-08-02) confirmed DiveDay's posture is deliberately lifestyle-scale, not
  venture-scale** (see [vision.md](vision.md#what-kind-of-business-this-is)) and dropped the
  earlier "same-day response" wording from the support claim — keep the support commitment worded
  as a founder-direct line, without a stated response-time SLA, until support-hour capacity is
  scoped for real. Billing cadence, taxes/fees, and the contract flow remain undecided
  ([human-decisions/](human-decisions/README.md)); do not publish billing terms through any new channel
  without that decision. The two-year price lock and the founder-direct support promise are
  **binding commercial commitments** and taxes/fees are jurisdiction-dependent — both carry an open
  legal/tax-review dependency (H-12); do not treat the closed *price* as clearing them.
- **Offline claims stay precise and human**: the device keeps its own copy current automatically
  while online, with a manual "Refresh now" for right before losing signal; it never transfers
  between devices or guarantees stale readiness is live. Captain's words ("this phone stays
  ready", "checked again when service returns") — the machinery (encryption, reconciliation) stays
  in ADRs, never in copy ([design/principles.md](../design/principles.md) §4). **`/privacy` is the
  single exception**, and only for encryption: on the page about who can read a shop's divers'
  data, what protects the copy on a crew phone is the reader's actual question, so it is named
  there — with the limits of that protection named alongside it. Nowhere else. The boat manifest
  page's checklist, which `/product` folds under that page's row, sells the outcome ("a roll call
  with no signal, folded into the live record when the phone reconnects"), never the snapshot.
- **The no-signal claim runs before the boat test** (H-94, Aaron Buxbaum, 2026-10-06). The launch
  plan held every offline roll-call claim until V-02, the outdoor test of the manifest on a boat,
  passed; the claim was live anyway (MKT-F10), and the owner kept it, since it is shipped and the
  demo shows it. Where a page explains it, the condition sits beside it: the copy is saved to the
  phone while it has signal, and out of range a phone shows only its own taps. No page says the roll
  call has been tested on a boat, at sea or in the field until V-02 records that it was, and if
  V-02 fails, the claim comes off every page in the change that records the result.
- **What the export withholds is stated scoped, never as an absolute** (2026-08-28). The honest
  short answer to "what stays behind" is *credentials* — passwords and per-device push keys, which
  no other system could use anyway — and that is what `/pricing`'s `dataExit.securityNote` and the
  export mockup say. But it is only true of the shop's **records**: the bundle also leaves out
  notification retry queues, provider linkage, DiveDay's own reconciliation ledgers, and the
  close-out and buddy-team trails, which is why the real Settings screen names all of them
  (`settings.export.notIncluded.text`, and `EXCLUDED_TABLES` in `src/db/export.test.ts`). So the
  marketing sentence carries its scope and the mockup lists without claiming to be the whole list —
  "the only thing held back is credentials", said flat, would be a fabricated-proof failure wearing
  a security badge. `src/lib/marketing.test.ts` pins the scope; the Settings screen's own wording is
  the source of truth and does not bend to the marketing page.
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
  **And the test binds every h2 on that page, not only its h1** (2026-08-28). Slice 12f fixed the
  "From day one" band's heading — the band carrying the export terms, the plan terms and who
  answers, which is the page's best material and the answer to the buyer's strongest objection — by
  replacing a heading about *us* with the metaphor "What you're standing on.", and shipped a fifth
  failure of the same test: a rival could paste it unchanged. The heading is now **"Month to month,
  and the export is one button."** — the plan terms printed six inches beneath it, and the export
  the rules band dares the reader to go and run. `/about`'s headings are the only part of that page
  a skimmer reads, so one that argues nothing costs the band it stands over.
  `src/app/about/copy.test.ts` makes the test mechanical for that heading: some clause of it has to
  appear in the band's own published prose, which no metaphor can satisfy.
  **Since 2026-09-24 (H-89) `/about` is written as speech**, and every heading on it is the shop
  owner's question repeated back without a mark. **Since the 2026-10-06 rewrite** (Aaron: "I don't
  like the copy on the about section. Redo it completely") they run "Why did you build this" (the
  H1), "Who am I dealing with", "How do I know any of that's true", "Who answers when something
  breaks", "What's the catch", "What happens to my records if I go", "How do I try it". The
  sentence that survived four failures ("your season doesn't hang on us") now closes the "Who am I
  dealing with" band, with its proof beside it. The headline test binds the first sentence of
  each answer rather than the question, and the copy test's arithmetic moved with it: the exit
  heading names the thing its band publishes (a content word of the question appears in the band's
  own prose), carries no mark at either end, and is none of the three retired headings.
  **Since the 2026-10-07 rewrite (H-99; Aaron: "I really really don't like the copy on About. Let's
  redo it entirely")** the spoken register is retired. The owner kept the hero alone, with the
  question heading over it removed and the tie made the company's; every heading under it is a
  statement with a full stop ("Divers who have shipped software to millions of people.", "The one job on a boat
  that can't go wrong.", "We set your shop up with you.", "The demo is a working shop, with divers
  booked on today's boat."), the eyebrow "Why DiveDay exists" is the page's h1, and the copy test's
  arithmetic moved again: statement headings, no individual named, no first-person singular, the
  Lonergan limits, and the retired questions refused by value. The register is "The about page"
  in [design/brand.md](../design/brand.md).
- **Concede the facts; never apologize for them.** This is the rule the page-level version of the
  claims policy kept losing. "DiveDay is new" and "it's still changing" are honesty the policy
  requires, and they stayed on `/about` until 2026-10-07, when the owner's rewrite dropped the
  concessions band (H-99: "Don't get overly truthful, just make a compelling case"; the protection
  they described, the export on the first day and the month-to-month plan, is stated on the page as
  what the shop gets); its scope card ("it doesn't do everything") left in the
  2026-10-06 rewrite, the day the "What it doesn't do" sections came off the public pages. What is banned is the register that grew up around them — by
  2026-08-12 nine framings of *we're small, we're new, you've never heard of us, don't take us on
  faith* had accumulated across the five pages, including the `/about` H1, the lead-in to its four
  checkable rules, the homepage's export band, `/product`'s honest-no, and the `/pricing` FAQ
  question "DiveDay is new. What happens to my data if this doesn't work out?" Every one read as
  reasonable candor alone; together they argued the buyer out of the sale before the product got a
  word in. The fix in each case was to keep the fact and drop the flinch — the pricing question is
  now "What happens to my records if I leave?" with the same answer underneath. **A test enforces
  this** ("no marketing page apologizes for the company's size or age"), pinning the specific
  phrasings out by name, because each one shipped as a sentence its author thought was honest.
- **A person wrote it, not a model.** Every word of these pages is written by a language model,
  and a model has a house style a buyer has learned to skim: the em-dash pivot in every second
  sentence, "not a project, a file", "No X. No Y. No Z.", *actually* and *plainly*, "Here's how",
  the aphorism heading ("The door swings both ways.") and the closing flourish. On 2026-09-03 the
  marketing bundle carried all of them, densely, and every page read as the same voice. The list,
  with a before/after table, is "What gives us away" in [design/brand.md](../design/brand.md);
  `pnpm check:voice` refuses the mechanical half of it in every bundle, and the rest is read for
  by hand before a page ships. The rule underneath is the one already above: a divemaster giving a
  briefing says the thing.
  **The words were swept on 2026-09-03 and the pages still read as machine-written**, because the
  sweep left the shapes: the mirrored pair, the list of three with a tail, the tag sentence, the
  house phrase reused on every page, one temperature everywhere. The owner's 2026-09-17 brief asked
  for a voice defined top-down and six were drawn ([design/voice-strategies-20260917.md](../design/voice-strategies-20260917.md));
  he picked **6, Margin Notes, with 4, Over a Beer, on `/about`** (H-89, 2026-09-24). The public
  pages are now the product's own screens with the builder's notes under them, `/about` is speech,
  both registers are in [design/brand.md](../design/brand.md), and `pnpm check:voice` refuses the
  four shapes on the public pages' strings so they cannot drift back.
  **On 2026-10-05 (H-93) the sale went back in front of the notes**: a page that only annotated
  its screens never said why a shop would want them. A section now leads with what the shop gets,
  shows the screen as proof with the notes as its captions, and opens the demo on that screen (the
  decision section at the top of this file).
- **Concrete nouns over software jargon.** The buyer runs a shop, a counter, a boat — not an
  "operating system", "platform", or "solution". Name what DiveDay replaces: the whiteboard, the
  clipboard, the three apps and a spreadsheet.
- **Show the screen before describing it, and never inventory the same thing twice.** The feature
  claims exist at exactly two densities, and each has one home: the summary is a feature page's one
  sentence (`marketing.featurePages.<page>.summary`), which `FeatureDirectory` lists on `/` and on
  `/product` with the page itself one tap away; the full inventory is `productCapabilityIndex`,
  each feature page's checklist its own group, and all of it rendered on
  `/product` inside the directory: a closed `<details>` under each page's row, counting that
  page's lines, and one titled row for each group no page owns. Closed at rest since 2026-09-17,
  when it was a band of its own: flat it ran 2,900px of a 9,600px page, arriving after the
  argument had finished, and a counted row says the breadth where the wall said it in eight
  screens. It moved into the directory on 2026-10-05, because once each group was a feature page's
  checklist the band's first twelve rows repeated the directory's twelve names one band down. **The inventory is the whole of [shipped.md](shipped.md), consolidated — never a
  curated subset.** Until 2026-09-01 it held 49 chosen lines, one per idea per area, and under a
  heading that says "the whole list" a chosen list is a false one: a buyer with an incumbent's
  feature page open beside it counted reminders, buddy teams, the blow-out cascade, close-out,
  backups, calendar feeds, QuickBooks/Shopify/Zapier and two-factor as missing, and every one had
  shipped. It now carries every shipped workflow once, filed since 2026-10-05 under the feature page
  a buyer would look for it on (the messages that had been scattered as half-lines have a page of
  their own), and every page that states a count takes it off `productCapabilityIndex`, so no
  sentence, this one included, carries a number the registry can outgrow (#1860). The bar for a line is unchanged — walkable in
  the demo, shipped-only, in the buyer's words; the bar for leaving one out is that no shop would
  ever look for it. When a slice ships, add its line here in the same change as its shipped.md entry.

  There were three densities until 2026-08-13. `/product` used to render *all* of
  `productFeatureGroups` (30 bullets) about a thousand pixels above a `<details>` holding 46 better
  organized ones covering the same ground; a reader scrolled one wall of bullets to reach a longer
  one. Cutting the middle density left the page announcing "the whole list, plainly" above a
  heading, two lines and a "The full list" link in an otherwise empty band — so the disclosure went
  too, and the list a buyer came for is simply on the page. Pricing had already been cut back for
  the same reason. What came back on 2026-09-17 is a different shape and not that one: the group
  names *are* the list, so the band at rest is a row per group rather than a heading over nothing.

  The middle density's *machinery* outlived it by a day and was removed on 2026-08-14: the grid's
  `featuresPerGroup` prop chose between a `✓` checklist and a paragraph, and with no caller left
  asking for the checklist, 26 of the 30 claims were translated in both locales and rendered on no
  page at all. Each group then carried a `summary` written as a summary rather than the grid reading
  the first line of a deleted list, until the cards and their summaries were deleted on 2026-10-05
  and the feature pages' own sentences took over that density (H-93). If a checklist density is
  ever wanted again, it needs a page behind it before it needs a prop.

  Before adding a list to a page, check the other density: the answer is usually a mockup or a
  link, not a second copy.
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
  H-94 settled MKT-F10 on 2026-10-06: the claim stays (see the claims policy above).
  **The role door under an annotated screen is the one exception (2026-09-24, H-89).** A
  `ScreenDoor` (`src/app/_components/ScreenDoor.tsx`) submits the same `enterDemoAction` with a
  hidden `role`, at link weight, labelled for its screen ("Open the demo as the captain →"),
  because a builder's note that ends "as that role" cannot end on a button that says nothing about
  the role ([design/brand.md](../design/brand.md), "The two registers of the public pages"). One
  per screen a visitor could open, tagged per screen in `src/lib/funnel.ts`
  (`switching-hub-preview`), never primary weight, and never the page's demo button: the spec
  counts "Try the live demo" by name, and a screen door is not one. The homepage's screens carried
  three until 2026-10-05 (`home-diver-moment`, `home-desk-moment`, `home-dock-moment`, retired and
  kept registered for their history); its steps now end in the feature page's name instead, and
  that page's hero door opens the demo on the same screen as the role that uses it (H-93).
- **The demo's cost is stated once per page, at the first door.** `marketing.common.demoNote` ("no
  sign-up, no card") answers the only question the button raises, and the answer is worth nothing
  the second time: repeated under every demo button it stops reading as reassurance and starts
  reading as insistence. It sits with the *first* demo button a reader meets — the homepage hero,
  not the homepage close — because that is where the decision is made; a reader who scrolls past it
  has already read it. Deleting it from a page entirely is a different change and not an allowed
  one: `e2e/marketing.spec.ts` asserts it on `/`.
  **`/about` carried it nowhere at all until 2026-08-28**, which is the failure this rule is worded
  to catch and did not: the page had one demo door, in its closing band, and no note under it. When
  slice 12f moved the first door up to the four-rules band the gap became the expensive kind — a
  page that has just dared a burned buyer to go and check four things, offering an unlabeled button
  at the moment of maximum impulse. The note stands under `about-rules` now, in `/product`'s hero
  shape, and the closing band repeats the door and not the note. The spec asserts both halves there:
  present in the rules band, and exactly once in `<main>`.
  **This rule governs `demoNote` only, and `/pricing`'s trial note diverges from it deliberately
  (2026-08-28).** `marketing.pricing.trialNote` — free, three weeks, no card, and the soft expiry
  `src/lib/trial.ts` implements — stands at *both* of that page's CTA pairs, the price hero and the
  `pricing-close` band. The demo note's argument does not carry across: it answers a question the
  reader has already answered by the time they scroll, whereas the trial's terms are the objection
  itself, and the closing band is a second point of decision rather than a repetition of the first —
  a reader who has just read five thousand pixels of objections is being asked to commit *there*,
  and that band carried no terms at all until this landed. It stays a sentence at both positions,
  never a third door (the budget note below). A third placement would be a new divergence and needs
  its own line here.
  **Both notes at a door carry the same weight** (`font-medium`), which on `/pricing` means the
  trial note matches the demo note rather than sitting a step under it. They are one kind of object
  — terms at a door — and the trial is the door with the higher friction, so setting only the demo's
  terms in medium put the heavier ink on the easier ask. `/` is not this case and does not change:
  the regular-weight line under its medium demo note is a *price line*, context beside terms rather
  than terms of its own.
- **What "Get set up" leads to is said once per page, at the close** (issue #2097, approved by the
  product owner 2026-10-09). `marketing.common.setUpNote`, "A person reads every request and sets
  your shop up with you.", stands under the closing pair of `/`, `/pricing`, `/about` and every
  feature page, the band where a reader commits. It names a person and nothing else: no response
  time, no "free", no count of anything. Any change to its wording is a service claim and needs the
  same sign-off. `e2e/marketing.spec.ts` asserts it once in each of those pages' `<main>`.
- **One primary CTA per screen.** The demo leads everywhere through the shared `FunnelCtas`
  pair (the 2026-08-22 two-doors decision above — this bullet said "the trial on `/pricing`"
  until 2026-08-27, a leftover from before that decision); `/pricing`'s trial door is simply
  measured at two positions (the price hero, and the closing band tagged `pricing-close`). The
  nav's single door stays secondary weight so it never competes, and the CTA hides entirely on
  `/onboard`, where it would link to the page it's on. The one exception there is the footer's demo
  door (`onboard-demo`), a link-weight submit that spends none of the page's budget; the sign-up
  spec asserts it carries no primary fill. A screen's role door (above) is a
  link-weight submit and spends none of the screen's budget; the spec asserts it carries no primary
  fill, the way it asserts `/about`'s support door does not.
  `/product` is where the budget is easiest to lose — the longest page on the site, offering the
  demo from four positions inside its body, each added by a different review answering a different
  objection. `e2e/marketing.spec.ts` counts the primary in *every* band of that page rather than
  only at the door most recently added, which is the shape that let the homepage hero reach nine
  choices before it was cut back. **`/about` is counted the same way** since 2026-08-28, when the
  band holding its four checkable rules gained the pair (`about-rules`) and the support mailto two
  bands below it demoted to secondary — a page with two doors is a page that can grow a third.
  **The homepage hero is the scarcest screen on the site and is capped at one primary plus one
  secondary** — it once offered around nine choices (a five-chip role picker, a diver-preview link,
  demo, trial), which is a menu, not an ask. Cutting a hero control never means deleting the
  destination: the roles moved into the in-demo switcher, the diver preview into the band of
  annotated screens it illustrates (since 2026-09-24 each screen there has its own role door), and
  both are still reachable and still tagged. `e2e/marketing.spec.ts` counts
  the hero's enabled controls so the budget can't quietly grow back.
  **The three fields are inside that budget, not beside it** (2026-09-10, ADR
  20260908-one-hand decision 6, possibility Y). The hero now takes a shop's name, one boat and a first
  departure, and redraws itself as that visitor's first day. Three boxes and a "Draw my day" button
  look like the budget growing by four, and the rule the budget encodes is about *decisions*, not
  elements: a text box is not a destination, and "Draw my day" is **disabled until there is something
  to draw**, so the count of things a visitor can act on at first paint is still one primary and one
  secondary. `e2e/marketing.spec.ts` counts it exactly as before and did not move for this change,
  which is the check that this claim is true rather than merely argued.
  **The drawn hero is a different screen and gets its own budget.** Once a visitor has typed their
  own shop into the page, the demo is no longer the leading ask — they are looking at their own
  morning — so the drawn state offers one primary ("Open {shop}"), the three rows above it that go to
  the same door under the same funnel tag (`home-drawn`), and a quiet way back to the fields. The nav
  still carries the demo, which is what "the demo leads, everywhere" is for. Nothing about the drawn
  hero is stored, fetched or looked up: DiveDay never reads a visitor's website, listing or logo, and
  the hero says so on its face ("Drawn from what you typed", "Nothing is saved until you open it"),
  which is what keeps it inside the claims policy rather than a demo of data we do not have.
  **Two defaults the hero guesses, recorded because nobody typed them.** The first boat gets
  **six seats** — capacity is the ceiling every gate downstream defends, and on a US uninspected
  vessel six passengers is a legal line, so the only safe direction to guess in is low; a shop
  raises it in the boat register. The first departure runs **four hours, on tomorrow's date in the
  shop's own zone** — the same run the schedule builder's own blank form opens with, and tomorrow
  rather than today because a shop signing up at 9 AM has already missed a 7:30 boat. (These
  belong in ADR 20260908-one-hand's decision 6, possibility Y; that decision arrives with the
  round-4 canvas commit and is not in the tree yet, so they are recorded here and move there when
  it lands.)
  **The budget binds controls, not facts.** The 2026-08-27 conversion review's second diagnosis is
  that the terms never stand at the doors, and the flat price reached the homepage hero on
  2026-08-28 as a consequence — as a muted *sentence* under the demo note ("One flat price — {price}
  {cadence}. No cut of your bookings."), never a "See pricing" link, which would have spent the
  budget to answer a question the sentence already answers. The same line sits under `/product`'s
  hero: both are first-screen evaluation surfaces. That is the general move when a page
  owes a reader a fact at a door: state it, do not open a third one. The closing band keeps the
  two-year lock and the door to `/pricing`, so the figure now renders on two bands of `/` and both
  interpolate it.
  **`/product`'s money band is the same move made on a door that already existed** (2026-08-28).
  The one band on that page about money read "What DiveDay itself costs →" — it raised the cost
  question and parked our own half of the answer behind a click, which is what a burned buyer reads
  as a card wall. The figure now stands in the link's own words ("One flat {price} {cadence} — see
  everything it covers →"), so the band spends no new control and the reader learns the number
  where the question is asked.
  **`/about`'s pricing door went the same way on the same day**, and it was the worse offender: that
  page raises the cost question three times — the "One price, no seats." rule sends the reader to
  the pricing page to *check it*, the "How it's run" heading promises straightforward pricing, and
  the paragraph beneath it says the whole of it is on one page — and then offered "See what it
  costs", which on a page whose entire argument is that nothing here is hidden reads as *they won't
  say*. It now reads "One flat {price} {cadence} — see the whole list", closing the loop the rules
  card opened. Four sentences now interpolate `earlyAccessPrice` rather than one; their keys are
  pinned in `src/lib/marketing.test.ts`, and a fifth that spells the number out instead fails
  there.
  The internal positioning pillars ("easy to try", "safe to leave") are argument structure, not
  user-facing labels. **A label a reader sees names a thing, not a strategy** — and after the
  2026-08-13 redesign the homepage names things in two idioms, deliberately: an uppercase eyebrow
  for a whole thing (the hero's category line, the directory's three parts of a shop's year), and
  a sentence-case marker with a hairline rule for a *part* of a section (a step's place in the
  booking, a direction in the records diptych). The redesign deleted the standing section eyebrows that
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
  and the shared link card. Every marketing route was unfurling image-less until 2026-08-03. That is
  why `sharedLinkCard` in `src/lib/marketing.ts` exists and why **every** marketing page spreads it
  into its `openGraph`. The failure mode is what makes this worth a rule: it is invisible from inside
  the app and only shows up in someone else's chat window, which is precisely where these pages do
  their work.
  The card itself is `src/app/link-card/route.tsx`, named by `sharedLinkCardImage` in
  `src/lib/site-metadata.ts`. It was `src/app/opengraph-image.tsx` until issue #1709, and while it
  was, file-based image metadata being collected per route segment meant Next re-attached it to the
  root segment's own page for free — so `/` was the one marketing page that did not spread
  `sharedLinkCard`. A convention file is also attached to every page entry in its subtree, which put
  3.07 MiB of renderer into every closure in the app; the card is a route handler now, attached to
  nothing, and `/` names it like everybody else.
  The site-level half of that pair — `siteName` and `type` — is `openGraphSite` in
  `src/lib/site-metadata.ts`, and it reaches further than the marketing surface: **every page that
  exports an `openGraph` block spreads it first**, including `/` and every route under `/s/`. The
  card is deliberately *not* inside it: Next skips a segment's own `opengraph-image.tsx` whenever
  that level's block names `images`, so a card in the constant every page spreads would shadow the
  per-shop, per-departure and recap cards. Until 2026-08-12
  the result read backwards from outside — a page with nothing to say about itself carried
  `og:site_name` by inheritance and no `og:url`, while the homepage and every shop page carried
  `og:url` and no site name at all. `e2e/seo.spec.ts` and `e2e/marketing.spec.ts` assert the pair on
  the routes they name, and `pnpm check:open-graph` (`scripts/check-open-graph.mjs`, part of
  `check:repo`) refuses any `openGraph` block under `src/app` that does not spread one of the two —
  those e2e route lists are hand-maintained, so a page added tomorrow is not on them.
  `og:url` stays absent on bearer-token pages by design: there the URL *is* the credential, and an
  unfurl renders for bystanders who never clicked the link.
- Site-level `robots` and `sitemap` cover the public surface; tokened pages (`/waivers/*`,
  `/ready/*`, `/recap/*`, `/offline-manifest`) stay `noindex` individually. `robots.txt` is
  rendered by `src/app/robots.txt/route.ts` from `src/lib/robots.ts` (not Next's `robots.ts`
  convention, which has no slot for the comment that points an agent at `/llms.txt`).
- **The agent-ready storefront** (issue #1427, N-50): `/llms.txt` (`src/lib/llms-txt.ts`) tells a
  model what DiveDay is, the public URL shapes, where availability lives and that bookings happen
  on the booking page, and lists the shops the sitemap lists; each listed shop also serves
  `/s/<slug>/availability.json` (`src/lib/availability.ts` for the shape, `src/db/availability.ts`
  for the rows) — the next 14 days of public departures with a seat open, as codes and a
  `booking_url`, nothing about a person. A shop that opted out of search gets a 404 there, not an
  empty list, and its schedule JSON-LD stops naming the document (`subjectOf` → `DataFeed`).
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
| `setup_requested` | `src/app/get-set-up/announce.ts` | A shop asked to be set up — the committed half |

Both fire **after the outcome they name**, deferred with `after()` — a rate-limited demo attempt or a
refused sign-up is not an entry, and counting one would inflate the numerator of every ratio read off
the pair. Both also email someone as they fire, so neither half needs a dashboard to be noticed:
`setup_request_alert` to `onboarding@dive.day` for a set-up request, `demo_started_alert` to `alertRecipient()`
(overridable with `OPS_ALERT_EMAIL`) for a demo try. The Monday founder digest counts both by tag ([ADR 20261007-founder-metrics](../architecture/decisions/20261007-founder-metrics.md)). The demo alert is anonymous by construction — the shop slug,
the role, and the tag below, and nothing about the visitor, who never identified themselves. See
[ADR 20260805-demo-try-alerts](../architecture/decisions/20260805-demo-try-alerts.md).

The tag vocabulary is a closed registry in `src/lib/funnel.ts`, because the failure it prevents is
silent: a misspelled tag doesn't error, it opens a second bucket that reads like a real page with
suspiciously few visits. So a demo form tags itself with `<FunnelTag source="…">` — type-checked against the registry; the
"Get set up" door carries its tag in `?from=` through `setUpHref`, and the form posts it back — and a tag arriving
off a request goes through `eventSource()`, which returns `unknown` for anything unregistered.
**Adding a marketing CTA means tagging it**, and a new page means adding its tag to the registry
first; an untagged link is a conversion we can't attribute. Read the pair per surface: a page with
demo entries and no trials is telling you something different from a page with neither.

**A page that offers the same action from more than one place splits its tag by position** —
`home-hero` / `home-closing`, `pricing` /
`pricing-close`, `about-rules` / `about-closing`, the
switching guides' `switching-<slug>` / `switching-<slug>-mid` / `switching-<slug>-close` (with the
spreadsheet guide using the same three-position shape), and the feature pages' `feature-<slug>` /
`feature-<slug>-close`, built from the registry's slugs by `featureSource()` so a new page cannot
ship untagged.
Mid-page and closing doors exist because
one CTA at the bottom of ten sections is a scroll a convinced reader shouldn't have to make; folded
into the page's own tag, such a door can never be shown to have earned its place, and the next
review re-opens the same question with no evidence either way. The unsuffixed tag stays the page's
original one when a position is added beside it, so attribution history spans the change. A door
can also be retired: the homepage's `home-mid` came out on 2026-08-13 when the page's three
consecutive banded CTAs merged into one close (the 2026-08-13 homepage redesign), which moved the
closing door a full band nearer; the tag stays registered in `funnel.ts` so any history it
accumulated still reads. `product-mid` retired the same way on 2026-10-05, with the hub's tour and
the dock chapter it stood under (H-93), and `product-index` the same day, with the inventory band
it closed. That door (2026-08-28) answered the band's dare, *every one of these lines is something
you can go and do in the live demo right now*, with a door under the list rather than two bands
further down ([marketing-review-20260827.md](marketing-review-20260827.md), "the dare gets a
door"). Once the inventory folded into the directory, the hub was short enough that the pair
stood one screen above the close's own, and the dare itself had gone: the demo cannot take a
payment, so "every line" was no longer true of it (#2094). `/product` keeps two doors, hero and
close, under the page's own tag. Since 2026-10-09 the demo takes a test-mode card once its Stripe
pair is set (ADR 20261009-demo-test-mode-payments); the dare stays retired.

`about-rules` (2026-08-28) is the same argument on the trust page, and the one where the door was
furthest from the impulse. `/about`'s four operating rules each end in the demo action that proves
them — *save a manifest to your phone, turn the network off, and run roll call anyway* — and the
nearest thing a convinced reader could act on was a primary-weight `mailto:` two bands down, with
the demo waiting past the founder story, the concessions and the export terms
([marketing-review-20260827.md](marketing-review-20260827.md), "help arrives after the homework").
The pair now closes the band that makes the dare, wordless because the four "Check it" lines above
it are its caption. The demo note stands beneath the pair, because
this is now the page's first door and the terms belong at the first one (the once-per-page rule
above). **The support mailto demoted to secondary in
the same change** — it is a real offer and stays on the page, level with the pricing door beside it,
but "email a stranger and wait" is a slower answer than the one the rules had just earned, and
primary weight on it made it the heaviest thing on the page. `/about` now spends its budget where
`/product` and `/pricing` spend theirs: one primary per screen, pinned in `e2e/marketing.spec.ts`
band by band.

**Not every tagged door is a conversion.** Some links carry a tag without firing either event: the
diver-preview link into the demo shop's public schedule (`scheduleAttributionHref`) and **every
in-page door onto the switching surface** (`switchingHref`). As of 2026-08-15 that is all four of
them — `home-records` to the hub and `home-records-arriving` to the spreadsheet guide from the
homepage records band, `product-spreadsheet` from `/product`'s closing band, and `about-switching`
from `/about`'s "how you leave" band. They all build a `?from=` the Vercel `<Analytics />` page view
already carries, so they need no companion event; a switching page retags its own demo and trial
CTAs with its own source, which is exactly why the hop *into* it has to be attributed on the way in.
Read them as reach, not as conversion — they say which door a reader chose, and the guide's own
positioned `switching-*` tags say what happened next.

The last two were bare hrefs until 2026-08-15, which would have left the question that put a direct
spreadsheet door on the homepage — does the spreadsheet audience need one, or does the hub serve
them? — read against a denominator quietly missing `/product`, the page a reader lands on *after*
the homepage convinced them. **The nav and footer links to `/switching` stay untagged deliberately**:
they render on every marketing page, so one tag across all of them would answer no question, and a
per-page chrome tag is a bigger decision about what chrome attribution means.

The homepage's spreadsheet door also carries a fragment — `#columns`, the third argument to
`switchingHref` — because its words ("Your spreadsheet, column by column") name the column table,
which sits three blocks down the guide behind the hero, the wedge list and the mid-page CTA. A
reader who clicks a specific promise and lands on a general argument reads the gap as bait. The
fragment is built in the helper rather than at the call site so it can only land *after* the query
string; `/switching/spreadsheet#columns?from=…` is a URL whose tag never reaches analytics at all.

The `/product` spreadsheet door deliberately stays unanchored. Its label now names the proof at
the guide's opening — how DiveDay reads the sheet — rather than promising the concierge that sits
below the move rail; the homepage door remains anchored because it names the later column table.
One door keeps one promise, and the product link does not imply that a reader has reached the
human handoff before they have read the guide.

## Product visuals

The public pages ship deterministic illustrated mockups as the design — not captured screenshots.
Each visual is a small, hand-built component in `src/components/MarketingScreenFallbacks.tsx`
rendered through the shared wrappers in `src/components/MarketingSections.tsx`:

| Component | Represents | Marketing use |
| --- | --- | --- |
| `DiverBookingFallback` | The shop's public schedule | The homepage's booking step |
| `BookingCardFallback` | A departure's booking card on the public trip page | The online booking page |
| `StorefrontFallback` | The shop's own booking page | The website page |
| `WaiverSigningFallback` | Signing the waiver and medical form on a diver's phone | The waivers page, and the homepage's signing step |
| `FrontDeskReadinessFallback` | Today's readiness for one departure | The certification checks page, and the homepage's morning step |
| `NightBeforeBriefFallback` | The diver's trip page the night before | The messages page |
| `ArrivalDeskFallback` | A departure's Divers tab at the counter | The check-in page |
| `CaptainRollCallFallback` | Captain manifest roll call on a phone (`CaptainPhoneFrame`), at departure or, with `checkpoint="afterDive"`, after dive 1 | The homepage hero (departure) and its roll-call step (after the dive), the boat manifest page, the `/about` hero |
| `SiteBriefingFallback` | A dive site's briefing as a diver reads it | The dive sites page |
| `GearRegisterFallback` | The gear register | The rental gear page |
| `ScheduleWeekFallback` | Schedule's week view | The schedule page |
| `CoursePageFallback` | A course's public page | The courses page |
| `OrdersLedgerFallback` | One day of orders | The payments page |
| `RecapPageFallback` | The recap a diver opens after the dive | The homepage's recap step |
| `ImportPreviewFallback` | The contacts importer's preview step | `/switching` hub, and the homepage records band |
| `ExportBundleFallback` | Settings -> Data export | `/pricing`'s "if you leave" band |

The nine feature-page screens live in `src/components/MarketingFeatureScreens.tsx`, the rest in
`src/components/MarketingScreenFallbacks.tsx`; a feature page names its screen in the registry
(`src/lib/feature-pages.ts`), and the homepage's steps name theirs in `STEPS` (`src/app/page.tsx`).

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
for a reader who scans that far, and the `faq.shutdown` row beside it carries the continuity
promise (H-101) for the reader whose worry is DiveDay leaving rather than the shop.

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

**The arriving column answers mid-season, in the guides' own words** (2026-08-28). A shop reading
"bring your records in clean" in August is not asking whether an import works — it is doing the
arithmetic of switching with a season's bookings already on the books, and the four-phase move rail
that answers it lives several thousand pixels away on a switching guide this reader may never open.
One sentence now sits under the arriving lede, and it renders
`marketing.guides.shared.cutover.midSeason` through `midSeasonCutover` in `src/lib/marketing.ts`
rather than a homepage wording of the same promise: the guides walk the cutover step by step (five
of them since 2026-08-28), `/` compresses it to one, and both live in the same block of the bundle
so an editor rewriting either is reading the other. This is the export claim's rule applied to a
second claim. The guides do not additionally render the summary — beside the steps it compresses,
it would be a caption restating its own section.

**The band carries two links, and they are not the same door twice.** The 2026-08-13 redesign merged
two stacked link CTAs under the section copy — one to `/switching`, one straight to
`/switching/spreadsheet` — into a single hub link, on the reasoning that the hub already forks and
two stacked links to one destination-shaped surface were one door pretending to be two. That
reasoning holds for the *stack*, and the stack is not coming back. What it cost was the direct one:
`/switching/spreadsheet` — the guide aimed at what this file calls the largest under-served pool of
dive shops — lost its only inbound link from the highest-traffic page on the site, and a reader who
self-identifies as "coming off a spreadsheet" landed instead on a hub whose every card above the
fold names a competitor they have never used. On 2026-08-15 the direct door came back **inside the
"Coming in" column, under the import-preview mockup** (`marketing.home.spreadsheetLink`): the mockup
is the importer reading a sheet, so the reader who recognizes their own sheet in it is already
looking there, and the link belongs to the arriving half specifically while the hub link still
closes the whole band. Restoring it as a second link *under the section copy* would be re-adding the
shape the redesign removed; this is a different position with a different owner, and the two read as
one door per scope rather than two doors per destination.

Three details make that hold, and each was one conversion review away from being lost:

- **The closing link now sits under a full-width rule** (`mt-12 border-t border-border pt-6`). The
  arriving column is the taller half — a mockup against a four-row list — so the section's own
  closing link lands at the same left margin as the column's, a short gap below it, and the two scan
  as a stacked pair unless a line says otherwise. The band is hairlines throughout (marker rules, the
  column divider, the inventory's `divide-y`), so the rule reads as its footer: this link closes both
  columns.
- **The column link is a label, not a fourth sentence.** "Your spreadsheet, column by column →" —
  declarative, so it does not rhyme question-then-arrow with the closing link, and short enough to
  read as a caption on the mockup above it. The paragraph beside it has already asked this reader for
  their sheet ("send us the sheet and we'll bring your divers in with you, free"), so a link opening
  "Running the day on a spreadsheet?" would re-qualify an audience the copy just addressed and
  restate a promise made 40px earlier.
- **The hub link kept a catch-all.** It now reads "Switching from {competitors} — or something else?
  Read the guides →". Dropping its old "Coming off a spreadsheet?" clause was right — with a direct
  door in the column, that clause hailed one audience twice in one band — but deleting it outright
  left a pure vendor-name filter, and a shop on Peek, an Access database or a paper book reads a list
  it is not on and takes the band's terminal action to mean "not for me". The replacement clause is
  not a new claim: the hub's own last row is `switching.hub.dontSeeSystem`, "Something else, or
  nothing at all?"

Both are now tagged (`home-records` on the hub link, `home-records-arriving` on the spreadsheet
one), which the pre-2026-08-13 pair never was. That is the point of splitting them: the follow-up
that re-opened this question could not be settled from the numbers, because the click-through it
needed had never been counted. It can be next time.

**The homepage's breadth band is the feature directory, and every claim in it is a link.** Until
2026-10-05 it was `FeatureGroupsGrid`'s four cards, the one band on the page that asked a reader to
take a claim on trust; now each row names a feature page and its one sentence, and the page behind
it shows the screen (H-93, and "The homepage breadth band" near the top of this file). It still
carries no demo door of its own: the close is one band away, and three banded CTAs in a row read as
pressure, not confidence (the mid-page door retired in the 2026-08-13 redesign for that reason).
Revisit the band when the page-level `demo_entered`/`setup_requested` pairs (`home-hero` /
`home-closing`) have numbers.

**`SectionMarker` is deliberately page-local.** The homepage's kicker — a short sentence-case label
with a hairline rule running out to the edge of its column — lives in `src/app/page.tsx` rather than
beside `MarketingMockup` and `FeatureDirectory` in `src/components/MarketingSections.tsx`, and that
is a decision rather than an oversight. It was reviewed on 2026-08-14, after the product-page and
switching-guide redesigns that made the shared file untouchable had both merged: the homepage is
still its only caller, and no other marketing page has grown the idiom — the three remaining
`h-px flex-1` rules in the tree are the public schedule, its loading skeleton, and the schedule
builder, none of them marketing. Promoting a one-caller atom is how a shared module fills up with
things nobody else wanted. Move it the day a second marketing page wants the same kicker, keeping
its `as?: "p" | "h3"` prop — the portability diptych's columns need the `h3` (the marker is their
only label, so it carries them in the document outline) and the booking's step rows need the `p`
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
| Every feature page's name and one-sentence summary, listed on `/` and `/product` | `src/lib/feature-pages.ts` (the registry and `FEATURE_PHASES`), rendered by `FeatureDirectory` in `src/components/MarketingSections.tsx` | `marketing.featurePages.<page>.name` / `.summary`, and `marketing.featureChrome.phases.*` |
| Price, plan name, included list | `src/lib/marketing.ts` (`earlyAccessPrice`) — the `$99` figure is the only literal, and the only place it exists | `marketing.price.*` in the bundles |
| Export claim shared by home + pricing | `src/lib/marketing.ts` (`fullShopExport`) | `marketing.export.*` in the bundles |
| Continuity promise shared by pricing + about (H-101) | `src/lib/marketing.ts` (`continuityPromise`) | `marketing.export.continuity` in the bundles |
| Mid-season cutover claim shared by home + the guides | `src/lib/marketing.ts` (`midSeasonCutover`) | `marketing.guides.shared.cutover.*` in the bundles |
| Shared link-preview card fields every page's `openGraph` needs | `src/lib/marketing.ts` (`sharedLinkCard`) | none — URLs and dimensions, no words |
| Capability index on `/product`, one group per feature page | `src/lib/marketing.ts` (`productCapabilityIndex`, `capabilityGroup()`) | `marketing.capabilities.*` in the bundles; a feature page's group is titled by its `name` |
| The twelve feature pages | `src/lib/feature-pages.ts` (slugs, demo role and landing, related pages, screen); one template in `src/app/product/_components/FeaturePageBody.tsx` | `marketing.featurePages.<page>.*` for each page's words, `marketing.featureChrome.*` for the template's own |
| Page-specific narrative copy | The page file (`src/app/{page,product/page,pricing/page}.tsx`) | `marketing.home/product/pricing.*` in the bundles |
| Sign-up reassurance (no card, the exit, the founder line) | `src/app/onboard/page.tsx` | `account.onboard.*` in the bundles |
| Why DiveDay exists, who builds it, and how a shop gets set up | `src/app/about/page.tsx` | `marketing.about.*` in the bundles |
| Mockup copy | `src/components/MarketingScreenFallbacks.tsx`, and the feature pages' screens in `src/components/MarketingFeatureScreens.tsx` | `fallback.*` in the bundles |
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
section's leave-path box** (decided 2026-08-14; **still the rule as of 2026-08-28** — the
2026-08-27 review recommends extending the same destination-not-claim link to the leave-it guides'
`bothWays` block and records it as an open owner call, so `/switching/eve`,
`/switching/diveshop360` and `/switching/smartwaiver` carry no forward pricing link at all and
`e2e/marketing.spec.ts` asserts they render none. Adding one is a decision, not an edit). Two of the guides argue hard on an incumbent's
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
reverse-engineer, no `sources`, and no cutover phase — which is why the parallel-run answer the
incumbent guides give as a cutover step rides its **import** phase instead (2026-08-28): the reader
still keeping a sheet is the one likeliest to be asking whether they have to stop, and this guide
was the only one that never answered. It is its own sentence about the sheet staying, not the
cutover step's words moved; it lives as its own static route rather than a
`migration-guides.ts` entry (a static segment wins over the sibling `[competitor]` one). It still
renders `IMPORT_HONESTY_TABLE` verbatim like every guide — the shared honesty invariant — and it
carries the shared `SwitchingConcierge` offer like every switching page. Its wedge is not
portability (a spreadsheet never locked anyone in) but the jobs a list can't do: readiness checked
at the dock, the blocker queue, the no-login diver arc.

## Maintenance loop

- **A feature ships → the pages move in the same PR** when it changes what a buyer would be told:
  add its line to `productCapabilityIndex` under the feature page a buyer would look for it on,
  update that page (and the homepage step that shows it, if one does), and any mockup it depicts. The
  new-feature skill's definition of done includes this check.
- **A claim is invalidated** (feature removed, behavior changed) → fix the page in the same PR
  that invalidates it. If code and copy disagree, one of them is the bug.
- **Verification is the product bar**: the local gate green (`pnpm check:repo`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test:changed`) and CI's `pnpm check`; `pnpm e2e marketing.spec.ts`;
  screenshots of every touched page in light + dark, desktop + phone, actually looked at
  (design-review skill); visual triage after push (visual-triage skill).
- Copy changes update the e2e assertions that pin headlines/price visibility — deliberately: a
  failing marketing spec on a copy change is the test doing its job.
- **Re-check positioning** (this doc's spine + the assessments) when: a rival ships a response
  (DiveAdmin bulk export/webhooks, any DiveShop360 API), the H-12 pricing decision lands, or the
  first paying shop exists — real social proof reorders every argument above.
- The `marketing-page` skill is the executable form of this document; if it and this doc disagree,
  fix whichever is stale in the same PR.
