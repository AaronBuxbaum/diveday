# Public marketing surfaces — what they are and how to write them

DiveDay's public pages are the homepage (`/`), product page (`/product`), the twelve feature pages
under it (`/product/<feature>`), pricing page (`/pricing`), the about page (`/about`), and the
onboarding entry (`/onboard`); switching guides (`/switching/*`) join them as they ship. They are a truthful sales surface for the product that
exists today.

This document is the living rulebook for those pages: the positioning they argue, the claims they
may make, the voice they use, and the maintenance loop that keeps them true. The dated case for the
current direction is [archive/marketing-review-20260723.md](archive/marketing-review-20260723.md)
(fully delivered, kept for rationale); so is the conversion pass argued in
[marketing-review-20260827.md](archive/marketing-review-20260827.md), whose slices 12a–12f all landed on
2026-08-28; the leave-it guides' pricing link was approved on 2026-11-10. The step-by-step editing
procedure is the `marketing-page` skill.

**These pages are product surface.** DiveDay is developed exclusively by AI sessions, so marketing
has no separate team, tooling, or CMS: copy is code, reviewed like code, tested like code
(`e2e/marketing.spec.ts`, and the marketing captures in `e2e/visual-front-door.spec.ts`), and governed by this doc the same way
`schema.ts` is governed by the schema-change skill. A session editing these pages carries both
jobs — marketer and maintainer — and must leave both the pages and this rulebook consistent.

## Switching review (2026-11-11)

The current switching composition and source review are in
[switching-review-20261111.md](switching-review-20261111.md). It supersedes older switching
claims and composition descriptions below: the reason to try DiveDay precedes export work,
competitor absence claims and fixed migration-time estimates are removed, and Peek Pro joins
as an explicitly qualified sample-review guide. An unverified export menu is never invented.
The actual file determines transfer scope. All guides use the same truthful copy across pricing
offers, with no savings arithmetic or competitor price figures. The unchanged importer reference
continues to state supported fields, not guaranteed source exports.

## Configured pricing (2026-11-08)

Every visitor sees the same configured offer. `PRICING_MONTHLY_CENTS` and
`PRICING_BASIS_POINTS` independently set the monthly fee and percentage of money recorded as
received in DiveDay by any payment method. Omit either component when configuring the other to
charge only that component. With both unset, the default is $0/month plus 3%; explicit zeroes mean free.
Copy names only the components charged, and percentage offers never claim no cut of bookings.
Existing subscribers keep their sold terms. This supersedes references below to a universal flat
price; see [configured pricing](../architecture/decisions/20261108-configured-pricing.md).

## One fee description and worked months (2026-11-11)

Percentage offers use `marketingFee.summaryKey` from `src/lib/marketing.ts` wherever public
copy states the fee: money recorded as received in DiveDay, cash included. Online card payments
count automatically; cash and external payments count when recorded received. This follows
[recorded collections billing](../architecture/decisions/20261110-recorded-collections-own-billing.md).
The pricing page shows three explicitly illustrative USD months, including no money received,
using `pricingExampleMonths` and the configured fee calculation. These are examples, never
customer results or forecasts. A month with no trips can still have deposits or package sales;
only a month with no eligible money received has no percentage fee. A configured monthly base
still applies in that month. Do not describe the examples as typical one-boat or three-boat
results; boat count does not determine collections.

## One page per feature, and every section sells (decided 2026-10-05, H-20261005-public-pages-sell)

The owner's brief on 2026-10-05 was that the pages were not selling, and that every interesting
feature should be listed, explained and sold on a page of its own. Three things stood in the way:
headlines that described the page rather than what a shop gets ("Four screens from a dive shop's
day, with notes from the person who made them"), a voice rule (H-20260903-voice-public-pages-speak) that kept a page from saying
why any of it matters, and an inventory of every shipped workflow of which the pages argued four
and listed the rest in a closed index on `/product`.

- **Twelve feature pages**, at `/product/<feature>`, one per job a shop buys software for: online
  booking, the shop's website, waivers and medical forms, certification checks, messages, check-in,
  the boat manifest and roll call, dive sites, rental gear, the schedule and crew, courses, and
  payments. The list, its order, and each page's demo role, landing screen and three related pages
  are one registry, `src/lib/feature-pages.ts`. An unknown slug is refused at the edge
  (`src/features/public-route-shape/rules.ts`), and the sitemap lists all twelve.
- **One template**, `src/app/(marketing)/product/_components/FeaturePageBody.tsx`: the hero says
  what the shop gets beside the screen that proves it, with builder's notes and a contextual demo
  door; then how it works, the feature's whole group of `productCapabilityIndex`, its questions,
  the close, and related pages. The included list says “Included in your shop’s plan.” with one
  quiet Pricing link. Ordinary feature pages carry no hero price, repeated included-price sentence
  or dedicated export strip. Feature-specific payment explanations keep their accurate fee scope.
  The same sections and copy shape are held by `src/lib/feature-pages.test.ts`.
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
- **The homepage follows one booking** (`src/app/(marketing)/page.tsx`). The title says what the shop gets
  ("Every diver booked, signed, checked and accounted for") and the lede says what DiveDay is: the
  journey from online booking to dock readiness. Then five steps in the order a diver meets the shop:
  book, sign the release and medical form, the morning check, the roll call, and the recap. Each is
  a screen, two builder's notes and a link that names the feature page. Check-in at the counter was
  a sixth step until review the same day: its screen read as the morning check's twin, and its one
  claim was the only one on the page a rival makes. Its page is still in the Product directory. The
  roll-call step draws the dock check-in screen, read by key from the check-in page, because the
  hero already draws the roll-call phone (visual review B14, decided 2026-10-25 under H-20260802-may-public-pages-say); its
  notes keep the no-signal roll-call claim with its condition.
  A step ends in its feature page rather than in a door into the demo, because that page's own door
  opens the demo on the same screen as the role that uses it. The page keeps its two demo doors,
  hero and close.
- **Every feature page is linked from `/product` by one component**,
  `FeatureDirectory` (`src/components/MarketingSections.tsx`): the pages filed under the part of a
  shop's year they serve (`FEATURE_PHASES` in the registry: before the dive day, on the day, across
  the season), each row the page's name and one-sentence summary, the whole row the link. The rows
  come off the registry, so a page added there is listed without hand-maintained page links. The
  homepage keeps the essential journey scenes and one quiet door to that complete directory.
- **`/product` is the hub**: the hero, one list, what DiveDay doesn't do, and the close. The list
  is the directory with the full inventory folded into it: under each feature page's row, a closed
  disclosure counts and holds that page's checklist, and the three groups no page owns (the diver
  record, running the shop, your records) close it under "Also in the plan". Its six-chapter tour,
  the sticky chapter strip and the payment band were deleted the same day; each chapter's screen
  and notes live on the feature page that owns them.
- **What did not change:** the claims policy, the two doors and their order, the demo note once per
  page, readily findable commercial terms, and `/about`'s company voice (H-20261006-about-say-whose-voice).

## The homepage journey and Product catalogue (owner decision, 2026-10-26)

The homepage follows the essential booking-to-boat scenes, including dock check-in (H-20260802-may-public-pages-say),
then explains bringing records in while keeping control of them. Its compact Product link opens `/product#full-list`;
the repeated twelve-feature catalogue lives on Product alone. Home and Product heroes keep a
content-sized demo beside a quiet 44px setup link. The demo doors and accurate migration qualifications remain. Home does not repeat a price
sentence; the canonical pricing page remains available through navigation. Product keeps its feature
catalogue and pairs the introduction with the existing Today readiness proof screen. On phones the
demo and setup actions precede that screen. Storefront previews use the vetted reef photograph
inside their existing screen frames; the approved illustrations remain unchanged.

The mobile marketing header keeps the brand, demo or staff return, and Menu on one row.
Secondary destinations, including Sign in, are disclosed with keyboard focus and Escape return.
Setup remains human-assisted. Contact and shop details come first on `/get-set-up`; Current tool
is optional and an unanswered tool is recorded without inventing a paper or other-tool answer.

Switching guides carry in-page contents. Detailed spreadsheet columns and the full import field
reference expand in place, with direct fragment links that open the reference. Included and
excluded record categories remain visible before expansion; the complete mapping, exclusions,
source links and CSV download remain available. This changes composition, not import scope.

## Warmth comes from the dive day (owner direction, 2026-11-11)

Lead with the people and moments the product helps: welcoming the morning group, a booking made while the crew is diving, gear being pulled for the boat and the recap a diver takes home. Supporting copy and proof screens still name the actual behavior and its limits. Invite an owner to use the demo; do not describe the page as a test catalogue. Home’s practical journey follows the hero, with the unchanged compact origin account later and the full story on About. Records setup is one arrival-led section; portability is a quiet link, never an equal-weight departure pitch. Keep the approved harbor, classroom and gear-handover artwork readable. Warmth does not mean invented testimonials, savings, safety guarantees, generic stock divers or extra card grids.

## The positioning spine

We are late to the market with zero customers, so the pages cannot argue from social proof. They
argue from **proof we can demonstrate**, in one sentence:

> **A better-prepared dive day, demonstrated in a working shop.**

- **Lead with the work** — bookings, diver records and trip preparation held together, from the
  desk to the captain's phone. Show the shipped screen and the decision it helps staff make.
- **Make it easy to try** — the live demo opens the relevant screen and role. A sample shop is
  proof the reader can explore before asking us to set up their own.
- **Keep the limits beside the claim** — readiness relies on staff checks, and offline roll call
  needs a copy saved while the phone has signal. Software supports the crew; it never guarantees
  safety or replaces their judgment.
- **Make commercial terms easy to find** — `/pricing` states the configured fee and scope,
  contract facts, export contents and exact continuity promise. These are useful reassurance,
  not a required repeated narrative on every page.

**Placement is deliberate (Aaron, 2026-11-11).** Repeating price, departure and shutdown language
makes reassurance sound like anxiety. Product value and proof lead; navigation and contextual
links make the terms readily available. This supersedes the former “safe to leave” pillar and
historical instructions to repeat price and export claims across every surface. It changes
hierarchy, not the fee, the authorized assistance or the continuity commitment.

`/about` preserves the Lonergan account, “That story is why we built DiveDay,” the company and
software-builders story, the wet clipboard, and the founder visual/signature. Its sequence is why
we built it → who builds it → operational standards → setup and human support → demo. Two
operational standards cards retain offline and readiness qualifications. Records ownership,
U.S. hosting and the optional backup to shop-owned storage sit quietly with the setup/support
facts, with an export-details link. There is no price standard, priced CTA footnote, repeated
contract fact or shutdown sentence on About. Its pricing door says “See pricing.”

Home leads with preparing records for the next dive day, accurate import preview and human help.
One quiet inline link opens `/pricing#export` for the actual export contents and terms; there is no separate exit pitch.
Keep the working import preview on the switching hub, and do not imply importing historical
records prepares future departures. A guide's dedicated records-control block retains exit
assistance; its close invites a sample and a review of the move instead of pitching departure
assistance again.

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
[assessments/competitive-strategy.md](archive/assessments/competitive-strategy.md) for why these are the
chosen battlegrounds — and re-read it before changing the spine.

## The two doors, and which one leads (decided 2026-08-22)

The funnel has two doors — **Try the live demo** and **Get set up** — and the order they are
offered in is a property of the funnel, not of any one page.

**A third, quieter door on two pages (Aaron, 2026-11-11, #4316):** `/pricing` and `/about` also offer **Book a 20-minute call**, a link to the founder's scheduling page beside Get set up (`FunnelCtas` `call`, tagged with the pair's source as `utm_content`). No other page offers it, `/about` stays unsigned, and the site still says “we”.

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
in the trial — and the page is a wordmark door with no nav (`EntryShell wordmark`) for the same reason, so the
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
  Currently authorized (a Jane-style concierge, authorized 2026-07-24, extended H-20260724-contact-importer-trust-shop): **free,
  personal, bidirectional help switching — a person will help a shop bring its data *in* (map any
  export or spreadsheet, migrate the roster with them) and, if DiveDay is ever not right, take its
  data back *out* just as personally.** On guides, the dedicated records-control and assistance blocks retain this offer. The hub
  and shared close invite a sample of the records and a review of the move, so the page ends on
  arrival rather than repeating exit assistance. Phrase these as a human
  commitment ("we'll map it with you", "we'll help you carry it out"), never as an automated product
  capability, and never promise a turnaround time. **It is offered twice on a guide, and the compressed
  form comes first** (2026-08-28): `switching.common.moveIntro`, the line that opens
  the move rail, ends "Rather hand it off? Send us the file and a person brings your divers in with
  you, free." The full block used to be the offer's only appearance and sat about 80% down every
  guide — *below* the four-phase rail whose whole job is to show a reader how much work switching is
  ([marketing-review-20260827.md](archive/marketing-review-20260827.md)'s third diagnosis, "help arrives
  after the homework"). The reader deciding whether they can face this now meets the alternative in
  the same breath as the work. Compressed at the top, authored once, never re-worded — the same
  shape `midSeasonCutover` uses for the cutover steps. A new service claim needs product-owner sign-off the same way the price does. **Website work is a discussion, not an included service promise (Aaron, 2026-11-09).** Invite shops to reach out and discuss what they need. Do not promise a custom-built website, an included or free build, a price, a delivery date or a page count. This replaces the earlier build-on-request wording under H-20260901-canvas-direction-brand/H-20261025-built-order-website-priced. The branded storefront and self-service booking components remain shipped product capabilities: shops can paste the provided components into their own websites. The pricing inclusion list names those capabilities only. The website feature page and FareHarbor guide may invite a separate conversation about website work. The FareHarbor guide asks shops to confirm hosting and cancellation terms instead of quoting a third-party price. **Founder-direct support retired 2026-08-05 (Aaron Buxbaum,
  [human-decisions/](human-decisions/README.md#decision-register), H-20260724-public-founding-shop-price/H-20260802-what-game-is-this).** From 2026-07-27 through
  that date a general founder-direct contact line, routed to `aaron@dive.day`, was authorized here —
  the same promise the "You can reach the founder" section on `/about` made in prose. It is
  rescinded outright, not reworded down again: a solo-founder company cannot durably hold a
  personal-response standard at any real scale, and the promise read as small-time rather than the
  positioning DiveDay wants. **What replaces it:** a plain `support@dive.day` inbox, reaching the
  same small team without naming an individual or promising a response time — phrase it as "write in
  and a real person reads it," never "the founder personally answers" or any response-time
  guarantee. It appears on `/about` in the "How we work with shops" band, the marketing footer, `/pricing`, the homepage's closing contact band
  (which leaves the "real person" clause to the set-up note a few lines above it, so the close says
  it once), the sign-up
  reassurance card, and the signed-in shop settings page. **Trial upgrades get their own address,**
  `onboarding@dive.day` — used only for "how do I move a trial shop to paid," on the pricing page's
  trial note (the Notes list beside the invoice), the sign-up form's trial note, and the shop Settings trial-status card (3-week trial,
  soft expiry — see `src/features/trial/rules.ts`). Both addresses are hosted mailboxes reaching the same
  people as `aaron@dive.day` always did; see
  [docs/engineering/ses-email-runbook.md](../engineering/ses-email-runbook.md#divedays-own-addresses).
- **A third service commitment was authorized 2026-10-07 (H-20261007-continuity-promise): the continuity promise.** Aaron Buxbaum, in the project thread: "We can publish that exact promise." The sentence is "If DiveDay ever shuts down, you get 90 days’ notice, your export, and your backups keep running until the last day." It answers the objection the demo cannot (a new vendor closing, market audit 2026-10-07 item 46), and it rests on things that ship: the one-ZIP export (`fullShopExport`) and the weekly scheduled backup to storage the shop owns (`src/features/backup-export/`). It is one shared key, `continuityPromise` in `src/lib/marketing.ts` (`marketing.export.continuity`), rendered on `/pricing` as the answer to the FAQ row "What happens to my shop if DiveDay shuts down?" (`faq.shutdown`). The 2026-11-11 hierarchy change removes its prominent About placement while keeping this exact answer accessible on Pricing. Its words are the owner's: no rewording, no added timeline or refund, and no other page carries it without a new decision. `src/lib/marketing.test.ts` pins the English word for word and the three commitments in every locale.
- **No fabricated proof.** No invented testimonials, user counts, logos, ratings, or "trusted by"
  language — ever. When real customers exist, their words go through the product owner first.
- **Biography is a claim like any other.** `/about` names a real person and describes real history,
  so shipped-only becomes *true-only*: no employer, credential, certification level, or origin
  anecdote goes on the page unless the product owner has confirmed it. A session may not infer a
  founder fact from a repo document, a commit, or a plausible-sounding draft. Statements about the
  industry ("shops lose money on X") are claims too — either cite a documented source the way a
  switching guide cites an incumbent, or phrase it as what the founder personally observed, which
  needs no source but also may not be invented on his behalf. The corporate entity stayed off the
  pages until 2026-11-11, when Aaron named it for `/terms` and `/privacy` (`src/features/company-identity`;
  H-20260724-corporate-footing-diveday-operate); `/about` still does not carry it. **Confirmed by the product owner 2026-07-25** and
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
  — but Aaron remains the sole owner (matches H-20260724-vercel-selected-web-hosting) and the sole developer, so anything that is
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
  **Amended 2026-10-07 (H-20261006-about-say-whose-voice; Aaron, in the project thread: "Don't talk about the specific people,
  use generalities about people in a company").** `/about` names no individual and states no CV.
  The confirmed facts above stay confirmed and unused; the page describes the people who build
  DiveDay in generalities that are true of them and derived from those facts (people who have spent
  their careers on software that millions of people rely on, and who dive), speaks in the company's
  plural throughout, including the hero's tie to the product ("That story is why we built
  DiveDay"), and no longer carries the concessions band. The Lonergan section and its limits are
  unchanged. **Amended 2026-11-11 (Aaron, in the project thread: "You can sign the about page with
  my name Aaron Buxbaum, Founder, but keep the 'we' terminology").** The "Who we are" band ends
  with that signature, from `FOUNDER_NAME` in `src/features/company-identity` and `marketing.about.founderRole`.
  It is the one place a person is named; the prose stays plural and states no CV.
  `src/app/(marketing)/about/copy.test.ts` refuses a named individual, a first-person singular, and
  the prevention claim in both locales.
- **Source exports are not importer capabilities (M01/M10, 2026-11-09).** The FareHarbor guide distinguishes the described Contacts and Bookings CSVs from separately supplied certifications, sizes and evidence. Its generic importer reference is a separate disclosure, not a promise about a vendor export. The two operating choices state manual transfer and staff responsibility before the long guide; no live synchronization or replacement distribution network is implied. The import and handover steps keep that scope: staff prepare upcoming departures separately, reconcile booking changes manually, and set timing after a trial rather than promise an afternoon or a ready roster.
- **Competitor statements must be documented fact** (their own pages, FAQs, pricing) and phrased
  factually. Prefer contrasting with the *buyer's fear* (setup fees, add-on stacks, export limits)
  over naming the rival. Switching guides may name incumbents; they cite sources and never
  speculate.
- **Comparisons explain terms, never invented savings.** `/pricing` links to the switching
  guides' sources for a competitor's published terms. Do not revive removed competitor figures,
  fixed migration-time estimates or promises about undocumented exports. No invented customer
  results, “typical shop” collections or savings arithmetic. The explicitly hypothetical worked
  months above illustrate our configured fee alone, with both a monthly base and percentage
  applied when configured; they are not market evidence.
- **The price renders only from `src/lib/marketing.ts` and the configured offer.** Never restate
  a rate or fee amount in prose, JSON-LD literals or images. Every public percentage-fee sentence
  uses the shared fee key and calculated parameters. Preserve the published fee scope, exclusions,
  refund credits and contract terms on Pricing and in canonical terms. Founding shops' existing
  sold commitments remain binding; this copy hierarchy change creates or rescinds none. The
  general founder-direct support offer was retired as described above, and a new service promise
  still needs owner authorization. `/about` and ordinary feature pages need only their quiet
  Pricing link; do not restore priced buttons or repeated fee paragraphs there.
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
- **The no-signal claim runs before the boat test** (H-20260802-may-public-pages-say, Aaron Buxbaum, 2026-10-06). The launch
  plan held every offline roll-call claim until V-02, the outdoor test of the manifest on a boat,
  passed; the claim was live anyway (MKT-F10), and the owner kept it, since it is shipped and the
  demo shows it. Where a page explains it, the condition sits beside it: the copy is saved to the
  phone while it has signal, and out of range a phone shows only its own taps. No page says the roll
  call has been tested on a boat, at sea or in the field until V-02 records that it was, and if
  V-02 fails, the claim comes off every page in the change that records the result.
- **What the export withholds is stated scoped, never as an absolute** (2026-08-28). The honest
  short answer to "what stays behind" is *credentials* — passwords and per-device push keys, which
  no other system could use anyway — and that is what the `/pricing` export mockup says (its
  margin notes went in the 2026-10-24 visual review, B10). But it is only true of the shop's **records**: the bundle also leaves out
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

- **Headlines state an outcome in the buyer's world**, not a category label or narration about
  the page. “Roll-call buttons big enough for wet thumbs” beats “mobile-first manifest
  management.” Support the outcome with the screen and the operational qualifications that make
  it true. The Product hub names the connected work, rather than explaining that each job has a
  page. Feature titles stay short enough to scan on a phone; details belong in supporting copy.
  **About keeps its own company voice.** The Lonergan account opens the page under the eyebrow
  “Why DiveDay exists”; the sections below use statement headings, not rhetorical questions.
  Preserve the approved account and its limits. The founder signature is the one named person
  outside the factual origin account; the prose remains “we,” without a CV or invented biography.
  `src/app/(marketing)/about/copy.test.ts` holds these constraints in both languages.
- **Concede the facts; never apologize for them.** This is the rule the page-level version of the
  claims policy kept losing. "DiveDay is new" and "it's still changing" are honesty the policy
  requires, and they stayed on `/about` until 2026-10-07, when the owner's rewrite dropped the
  concessions band (H-20261006-about-say-whose-voice: "Don't get overly truthful, just make a compelling case"; the protection
  they described remains available on Pricing); its scope card ("it doesn't do everything") left in the
  2026-10-06 rewrite, the day the "What it doesn't do" sections came off the public pages. What is banned is the register that grew up around them — by
  2026-08-12 nine framings of *we're small, we're new, you've never heard of us, don't take us on
  faith* had accumulated across the five pages, including the `/about` H1, the lead-in to its four
  checkable rules, the homepage's export band, `/product`'s honest-no, and the `/pricing` FAQ
  question "DiveDay is new. What happens to my data if this doesn't work out?" Every one read as
  reasonable candor alone; together they argued the buyer out of the sale before the product got a
  word in. The fix in each case was to keep the fact and drop the flinch — Pricing now heads its export section “Your records stay yours,” with the accurate export
  contents and terms underneath. **A test enforces
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
  he picked **6, Margin Notes, with 4, Over a Beer, on `/about`** (H-20260903-voice-public-pages-speak, 2026-09-24). The public
  pages are now the product's own screens with the builder's notes under them, `/about` is speech,
  both registers are in [design/brand.md](../design/brand.md), and `pnpm check:voice` refuses the
  four shapes on the public pages' strings so they cannot drift back.
  **On 2026-10-05 (H-20261005-public-pages-sell) the sale went back in front of the notes**: a page that only annotated
  its screens never said why a shop would want them. A section now leads with what the shop gets,
  shows the screen as proof with the notes as its captions, and opens the demo on that screen (the
  decision section at the top of this file).
- **Concrete nouns over software jargon.** The buyer runs a shop, a counter, a boat — not an
  "operating system", "platform", or "solution". Name what DiveDay replaces: the whiteboard, the
  clipboard, the three apps and a spreadsheet.
- **Show the screen before describing it, and never inventory the same thing twice.** The feature
  claims exist at exactly two densities, and each has one home: the summary is a feature page's one
  sentence (`marketing.featurePages.<page>.summary`), which `FeatureDirectory` lists on
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
  and the feature pages' own sentences took over that density (H-20261005-public-pages-sell). If a checklist density is
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
  H-20260802-may-public-pages-say settled MKT-F10 on 2026-10-06: the claim stays (see the claims policy above).
  **The role door under an annotated screen is the one exception (2026-09-24, H-20260903-voice-public-pages-speak).** A
  `ScreenDoor` (`src/app/_components/ScreenDoor.tsx`) submits the same `enterDemoAction` with a
  hidden `role`, at link weight, labelled for its screen ("Open the demo as the captain →"),
  because a builder's note that ends "as that role" cannot end on a button that says nothing about
  the role ([design/brand.md](../design/brand.md), "The two registers of the public pages"). One
  per screen a visitor could open, tagged per screen in `src/lib/funnel.ts`
  (`switching-hub-preview`, and `pricing-export` under `/pricing`'s export drawing since issue #1955), never primary weight, and never the page's demo button: the spec
  counts "Try the live demo" by name, and a screen door is not one. The homepage's screens carried
  three until 2026-10-05 (`home-diver-moment`, `home-desk-moment`, `home-dock-moment`, retired and
  kept registered for their history); its steps now end in the feature page's name instead, and
  that page's hero door opens the demo on the same screen as the role that uses it (H-20261005-public-pages-sell).
- **The demo's cost is stated once per page, at the first door.** `marketing.common.demoNote` ("no
  sign-up, no card") answers the only question the button raises, and the answer is worth nothing
  the second time: repeated under every demo button it stops reading as reassurance and starts
  reading as insistence. It sits with the *first* demo button a reader meets — the homepage hero,
  not the homepage close — because that is where the decision is made; a reader who scrolls past it
  has already read it. Deleting it from a page entirely is a different change and not an allowed
  one: `e2e/marketing.spec.ts` asserts it on `/`.
  On `/about`, the demo note stands under the first pair in the operational standards band,
  exactly once in `<main>`, without a price footnote. The closing band repeats the doors, not the
  note. The feature-page note also names the screen and role the demo opens.
  **`/pricing` states the trial once beside the price.** `marketing.pricing.trialNote` says the
  shop's trial is free for three weeks with no card, and that it keeps working while the shop
  arranges the move to paid with `onboarding@dive.day`. The trial rules use soft expiry; do not
  invent automatic billing, a cutoff or an indefinite free-service promise. The invoice's card
  processing row states Stripe's fee once; the fee-scope FAQ supplies the necessary detail.
- **The setup door says what happens next.** The close names the person who reads the request,
  using `marketing.common.closingSupport`; each page keeps the shared `FunnelCtas` behavior.
  `/get-set-up` asks the visitor to tell us about the shop so we can set it up for the way the crew
  works, and its button says “Request setup.” Do not invent a reply-time or same-week readiness
  promise, or make a new commercial promise to explain the form.
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
  The Product hub and About each keep two demo positions, hero or standards and close.
  `e2e/marketing.spec.ts` counts primary actions in each band so an additional section cannot
  quietly add another competing door.
  **The homepage hero is the scarcest screen on the site and is capped at one primary plus one
  secondary** — it once offered around nine choices (a five-chip role picker, a diver-preview link,
  demo, trial), which is a menu, not an ask. Cutting a hero control never means deleting the
  destination: the roles moved into the in-demo switcher, the diver preview into the band of
  annotated screens it illustrates (since 2026-09-24 each screen there has its own role door), and
  both are still reachable and still tagged. `e2e/marketing.spec.ts` counts
  the hero's enabled controls so the budget can't quietly grow back.
  **One line under the doors is a diver's, and sits outside the budget** (fourth review, item 50):
  "Booked a dive? Find your booking", a sentence for the diver who followed a shop footer here, not a
  door for the shop deciding. The spec pins it to exactly one link to `/find-your-booking` and counts
  the shop's links without it.
  **The line waits behind `HOME_DIVER_DOOR` (Aaron, 2026-11-11, #4313).** `/find-your-booking` is
  empty until a shop is listed, and a shop owner who followed the line read "No shops are listed
  yet" one click from the headline. The line is hidden unless the variable is exactly `1`
  (`src/features/home-diver-door`); turn it on once a shop is listed. The page keeps its address.
  **After the practical journey, one band says why the roll call is by name** (Aaron, 2026-11-11): the Lonergan
  story cut to two sentences, what the roll call does, and a link to `/about`. It keeps every limit
  the `/about` hero keeps (no operator or skipper named, no sentence saying DiveDay would have
  prevented it), and `about/copy.test.ts` holds it to them in both languages.
  **The homepage hero carries the demo note without a price sentence** (Aaron, 2026-11-11).
  Pricing remains on `/pricing`, with navigation and contextual links from the other pages; the configured offer still
  supplies the homepage's structured data. This changes copy placement, not billing terms.
  **About and feature pages keep Pricing at link weight.** About says “See pricing”; ordinary
  feature pages pair “Included in your shop’s plan.” with one quiet Pricing link. The dedicated
  pricing page answers price and export questions in full. Repeating its copy elsewhere is not a
  transparency requirement.
  A label a reader sees names a thing or a next step, not an internal positioning pillar.
  Eyebrows should distinguish content, not merely repeat the heading beneath them.

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
  rendered by `src/app/robots.txt/route.ts` from `src/features/robots/rules.ts` (not Next's `robots.ts`
  convention, which has no slot for the comment that points an agent at `/llms.txt`).
- **The agent-ready storefront** (issue #1427, N-50): `/llms.txt` (`src/features/llms-txt/rules.ts`) tells a
  model what DiveDay is, the public URL shapes, where availability lives and that bookings happen
  on the booking page, and lists the shops the sitemap lists; each listed shop also serves
  `/s/<slug>/availability.json` (`src/features/availability/rules.ts` for the shape, `src/features/availability/store.ts`
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
an `operator_alert` (`setup_request`) to `onboarding@dive.day` for a set-up request, an `operator_alert` (`demo_started`) to `alertRecipient()`
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
the dock chapter it stood under (H-20261005-public-pages-sell), and `product-index` the same day, with the inventory band
it closed. That door (2026-08-28) answered the band's dare, *every one of these lines is something
you can go and do in the live demo right now*, with a door under the list rather than two bands
further down ([marketing-review-20260827.md](archive/marketing-review-20260827.md), "the dare gets a
door"). Once the inventory folded into the directory, the hub was short enough that the pair
stood one screen above the close's own, and the dare itself had gone: the demo cannot take a
payment, so "every line" was no longer true of it (#2094). `/product` keeps two doors, hero and
close, under the page's own tag. Since 2026-10-09 the demo takes a test-mode card once its Stripe
pair is set (ADR 20261009-demo-test-mode-payments); the dare stays retired.

`about-rules` keeps the first demo pair beneath the operational standards. Its demo note appears
once, without a commercial footnote; the closing pair keeps `about-closing`. Setup and pricing
links in the work-with-shops section remain secondary, and no funnel tag changes with this copy
hierarchy update.

**Not every tagged door is a conversion.** Some links carry a tag without firing either event: the
diver-preview link into the demo shop's public schedule (`scheduleAttributionHref`) and **every
in-page door onto the switching surface** (`switchingHref`). As of 2026-08-15 that is all four of
them — `home-records` to the hub and `home-records-arriving` to the spreadsheet guide from the
homepage records band, `product-spreadsheet` from `/product`'s closing band, and `about-switching`
from `/about`'s setup/support band. They all build a `?from=` the Vercel `<Analytics />` page view
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

**Editorial scenes (2026-11-10).** The homepage journey introduction and the online booking,
website, rental gear and courses feature pages include original generated illustrations:
a welcome at the dock, a conversation in a dive-shop classroom and a rental-gear handover. They supply human atmosphere,
not customer evidence or depictions of the software. Each has localized alt text identifying and
describing the illustration, without a visible caption (Aaron, 2026-11-11). Product mockups remain
the functional proof, and the first demo door stays
before the artwork. About, pricing, the product hub and safety/legal pages are unchanged.

`MarketingIllustration` serves the complete 3:2 scenes from local WebP assets through `next/image`,
with intrinsic dimensions, responsive sizes and lazy loading. No text is baked into the artwork.
The approved style, reusable generation brief and acceptance criteria live in
[marketing art direction](../design/marketing-art.md); the repository carries only compressed
delivery assets, not generation masters. Keep the illustrations
separate from claims, real operator evidence and any future customer photographs.


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
| `ArrivalDeskFallback` | A departure's Divers tab at the counter | The check-in page, and the homepage's roll-call step |
| `CaptainRollCallFallback` | Captain manifest roll call on a phone (`CaptainPhoneFrame`), at departure | The homepage hero, the boat manifest page, the `/about` hero |
| `SiteBriefingFallback` | A dive site's briefing as a diver reads it | The dive sites page |
| `GearRegisterFallback` | The gear register | The rental gear page |
| `ScheduleWeekFallback` | Schedule's week view | The schedule page |
| `CoursePageFallback` | A course's public page | The courses page |
| `OrdersLedgerFallback` | One day of orders | The payments page |
| `RecapPageFallback` | The recap a diver opens after the dive | The homepage's recap step |
| `ImportPreviewFallback` | The contacts importer's preview step | `/switching` hub, reached from Home |
| `ExportBundleFallback` | Settings -> Data export | `/pricing`'s “Your records stay yours” section |

The nine feature-page screens live in `src/components/MarketingFeatureScreens.tsx`, the rest in
`src/components/MarketingScreenFallbacks.tsx`; a feature page names its screen in the registry
(`src/lib/feature-pages.ts`), and the homepage's steps name theirs in `STEPS` (`src/app/(marketing)/page.tsx`).

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

The export screen and terms live in `/pricing#export`, headed “Your records stay yours.” The
separate `faq.shutdown` row carries the exact authorized continuity promise. Removing repeated
export prose from other pages does not change either promise.

**The homepage records band leads with arrival.** It explains the import preview and realistic mid-season handover scope in one setup section, with a direct spreadsheet-guide link and “Find the guide for your current system.” The preview itself remains on the switching hub. “See what’s in your export” is a quiet inline link to `/pricing#export`, with no separate confidence paragraph or exit column. Home does not repeat ZIP/CSV contents or export terms. Keep the existing `home-records` and `home-records-arriving` tags and spreadsheet `#columns` destination.

**Home links quietly to the full feature directory on Product.** Its illustrated practical journey shows the essential booking-to-recap scenes, each linked to the relevant feature page. “Explore the features” opens `/product#full-list`; a second catalogue on Home would repeat the destination. The Home demo doors remain at the hero and close, and retain the `home-hero` / `home-closing` funnel tags.

**`SectionMarker` is deliberately page-local.** The homepage's kicker — a short sentence-case label
with a hairline rule running out to the edge of its column — lives in `src/app/(marketing)/page.tsx` rather than
beside `MarketingMockup` and `FeatureDirectory` in `src/components/MarketingSections.tsx`, and that
is a decision rather than an oversight. It was reviewed on 2026-08-14, after the product-page and
switching-guide redesigns that made the shared file untouchable had both merged: the homepage is
still its only caller, and no other marketing page has grown the idiom — the three remaining
`h-px flex-1` rules in the tree are the public schedule, its loading skeleton, and the schedule
builder, none of them marketing. Promoting a one-caller atom is how a shared module fills up with
things nobody else wanted. Move it the day a second marketing page wants the same kicker, keeping
its `as?: "p" | "h3"` prop — the arrival marker is an `h3` in the document outline and the booking's step rows use `p`
(they already have an `h3` below).

These mockups render identically in every checkout and in both light and dark modes, and they use
only semantic tokens, so keeping them truthful is a matter of editing the component copy when the
product it depicts changes. There is no browser-capture step: `public/marketing/*.png` is not used.
Reintroducing real-screenshot capture (with the tracked assets and a capture script that produced
them) is a deliberate, ADR-gated decision if the mockups ever stop being enough.

## Where the words live

**Every word a visitor reads lives in the locale bundles** —
`src/i18n/locales/<locale>/diver.json`, with `marketing.*` and `switching.*` in
`content/marketing.json` and `content/switching.json` beside it, edited for **every locale in the same change** (the
check:locale gate enforces coverage). The files below are where each surface's *keys and
structure* live; none of them may contain an English sentence:

| Content | Structure / keys | Words |
| --- | --- | --- |
| Every feature page's name and one-sentence summary, listed on `/product` | `src/lib/feature-pages.ts` (the registry and `FEATURE_PHASES`), rendered by `FeatureDirectory` in `src/components/MarketingSections.tsx` | `marketing.featurePages.<page>.name` / `.summary`, and `marketing.featureChrome.phases.*` |
| Price, plan name, included list | `src/lib/marketing.ts` (`earlyAccessPrice`) and the configured offer; fee amounts are calculated, never copied | `marketing.price.*` in the bundles |
| Canonical export claim on Pricing and dedicated switching records blocks | `src/lib/marketing.ts` (`fullShopExport`) | `marketing.export.*` in the bundles |
| Exact continuity promise in Pricing FAQ (H-20261007-continuity-promise) | `src/lib/marketing.ts` (`continuityPromise`) | `marketing.export.continuity` in the bundles |
| Mid-season cutover claim shared by home + the guides | `src/lib/marketing.ts` (`midSeasonCutover`) | `marketing.guides.shared.cutover.*` in the bundles |
| Shared link-preview card fields every page's `openGraph` needs | `src/lib/marketing.ts` (`sharedLinkCard`) | none — URLs and dimensions, no words |
| Capability index on `/product`, one group per feature page | `src/lib/marketing.ts` (`productCapabilityIndex`, `capabilityGroup()`) | `marketing.capabilities.*` in the bundles; a feature page's group is titled by its `name` |
| The twelve feature pages | `src/lib/feature-pages.ts` (slugs, demo role and landing, related pages, screen); one template in `src/app/(marketing)/product/_components/FeaturePageBody.tsx` | `marketing.featurePages.<page>.*` for each page's words, `marketing.featureChrome.*` for the template's own |
| Page-specific narrative copy | The page file (`src/app/{page,product/page,pricing/page}.tsx`) | `marketing.home/product/pricing.*` in the bundles |
| Sign-up reassurance (no card, the exit, the founder line) | `src/app/onboard/page.tsx` | `account.onboard.*` in the bundles |
| Why DiveDay exists, who builds it, and how a shop gets set up | `src/app/(marketing)/about/page.tsx` | `marketing.about.*` in the bundles |
| Mockup copy | `src/components/MarketingScreenFallbacks.tsx`, and the feature pages' screens in `src/components/MarketingFeatureScreens.tsx` | `fallback.*` in the bundles |
| Nav / footer | `src/components/MarketingNavView.tsx` / `MarketingFooter.tsx` | `nav.*` in the bundles |
| Switching-guide content (per incumbent) | `src/lib/migration-guides.ts` (key registry; slugs, URLs, source citations); pages in `src/app/(marketing)/switching/` | `marketing.guides.*` in the bundles |

A claim used on more than one page belongs in `src/lib/marketing.ts` as a shared *key*, not
copy-pasted. The key-registry files hard-fail `pnpm check:domain-strings` on any unexempted
prose literal (`proseFreeFiles` in the script), so a claim written as English in the registry
never reaches a review. Page `metadata` blocks (titles/descriptions for search engines and link
unfurls) are the deliberate exception: they stay English in the page file until a locale-routing
decision exists, because a single canonical URL serves one `<head>` to every crawler.

A switching guide is a live page only — no roadmap or "coming soon" entries (claims policy).

**A switching guide may carry one forward link to `/pricing`**. On coexist guides it sits in the
leave-path box; on leave-it guides it sits in the `bothWays` block below the scope table (approved
2026-11-10 in #4195). It is a destination, never a claim: no figure, no "flat price", comparison,
or savings arithmetic. The price renders only from `src/lib/marketing.ts`. Keep the link understated
and out of the closing band, which already carries three controls. `/pricing` links back to the
guides for the fee citation, so this closes that loop without adding a second forward link.

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
is documented fact from [assessments/competitive-strategy.md](archive/assessments/competitive-strategy.md),
carrying its own `sources` (rendered on the page) and phrased factually, never speculative; the
safety-adjacent scope copy gets `dive-domain-expert` review like any other. Add a guide by writing
its `MigrationGuide` entry — with sourced export instructions or an explicit sample-review path that makes unverified options clear, since every registered entry is
a published page (there is no draft/planned state). A guide is also **retired** by deleting that
entry (its bundle keys, hub card, route, and coverage rows go with it) when the incumbent stops
being worth a page — the DiveAdmin guide shipped 2026-07-23 and was retired 2026-08-05 on market
share, and the strategy doc keeps the dated record.

**Switching pages preserve records control without ending on departure.** Every guide keeps the
shared `switching.common.bothWays*` block under the scope table, composing `fullShopExport`'s
claims rather than rewriting them. Authorized personal exit assistance remains available there.
The shared close asks for a sample and offers to review the move. Home keeps one quiet canonical
export link beside its arrival guidance, rather than the guides' full records block. A reader can find the exit
terms without every surface making leaving its central argument.

A guide for a booking/distribution **channel** rather than a records system (today: **FareHarbor**
and **Rezdy**) additionally carries a `coexist` block. It invites the shop to try preparing a
DiveDay departure before deciding whether to keep the booking channel or move new bookings.
Keep the manual transfer and staff responsibility explicit: there is no live synchronization or
replacement distribution network. Check the shop's actual agreement and the linked current
sources rather than promising a fee saving or repeating an old advertised percentage. The dated
[coexist assessment](archive/assessments/fareharbor-positioning.md) is historical context, not
permission to restore the claims removed in the current switching review.

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
  `pnpm typecheck`) and CI's `pnpm check`; `pnpm e2e marketing.spec.ts`;
  screenshots of every touched page in light, desktop + phone, actually looked at (dark also
  for color work), following the design-review skill; visual triage after push (visual-triage skill).
- Copy changes update the e2e assertions that pin headlines/price visibility — deliberately: a
  failing marketing spec on a copy change is the test doing its job.
- **Re-check positioning** (this doc's spine + the assessments) when: a rival ships a response
  (DiveAdmin bulk export/webhooks, any DiveShop360 API), the H-20260724-public-founding-shop-price pricing decision lands, or the
  first paying shop exists — real social proof reorders every argument above.
- The `marketing-page` skill is the executable form of this document; if it and this doc disagree,
  fix whichever is stale in the same PR.
