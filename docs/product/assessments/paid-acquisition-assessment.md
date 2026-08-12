# Paid acquisition — can DiveDay advertise its way to a founding cohort?

> A channel-by-channel assessment of paid advertising for reaching dive shop owners, written
> 2026-08-12 from a live research sweep (vendor tag containers, Google autocomplete probes, published
> 2026 rate cards, media kits, DEMA's own rate pages, industry census data) against the commercial
> terms in [human-decisions.md](../human-decisions.md) H-12/H-26. Companion to
> [rollout.md](../rollout.md), which schedules "modest paid search on high-intent queries" in Phase 2
> — this document is the sizing work behind that line, and it narrows it substantially. An
> assessment, not a commitment.

## The answer in one paragraph

**Paid advertising fails here on capacity, not on cost.** The CAC arithmetic is survivable; the
inventory arithmetic is not. There are roughly **851 dive retailers in the entire United States**,
about **204 in Florida**, of which perhaps **120–155 run a boat**. DiveDay needs **25 shops, once,
ever** — around 18% of the Florida boat-running universe. Advertising is a machine for reaching
audiences too large to enumerate; this audience fits in a spreadsheet one person can build in two
days. Every channel verdict below is downstream of that single fact.

## The market, corrected

The number this assessment turns on had three incompatible values in circulation, and the difference
changes the strategy rather than just the budget.

| Source | US dive retailers | Method |
| --- | --- | --- |
| RentechDigital (Apr 2026) | 1,200 | Commercial scrape of business listings |
| RentechDigital (Oct 2025) | 1,463 | Same scrape, earlier snapshot |
| **Cline Group census (2023)** | **851** | Manual review of every Google-listed US shop, deflated from a raw tally of 1,677 after stripping defunct businesses and independent instructors misclassified as retailers ([writeup](https://scubadivingindustry.com/cline-group-takes-a-deep-dive-into-the-size-vital-role-of-u-s-dive-retailers/)) |

**Use 851.** The scraped figures *are the artifact Cline deflated* — a ~49% correction. One honest
caveat: the census was run by the publisher of the trade magazine that sells advertising on the
strength of "100% of USA reached," and that publisher's own 2026 media kit states **986** retailers.
Treat 851 as the best available number, not as ground truth. Note also that Cline required a
brick-and-mortar location plus full services, so pure charter operators with no storefront are
partly excluded — which pushes the boat-running number up, not down.

Applying the scraped *state distribution* (Florida 23.5–24.2% across two independent snapshots, a
figure far more likely to be right than the absolute counts) to 851:

| Quantity | Figure |
| --- | --- |
| US dive retailers | ~851 |
| Florida | ~200–206 |
| Florida, boat-running (the manifest buyer) | ~120–155 *(estimate — no published figure exists for what share of US shops own a boat)* |
| Florida, boat-running **and** independent | ~108–135 *(88.17% of US shops are single-owner)* |
| **DiveDay's cap as a share of that** | **~18%** |
| Next densest states | California ~89–102, Hawaii ~67, Texas ~41 |

Global TAM, for completeness: PADI's 6,600 dive centers and resorts and SSI's 4,000+ training
centers **cannot be added** — shops routinely hold multiple affiliations, and PADI's 2025 recruitment
of 100+ former competitor stores is direct evidence of double-counting. Realistic global unique dive
businesses: **~8,000–10,000**. The US is ~9–11% of it.

## Channel verdicts

| Channel | Verdict | The binding reason |
| --- | --- | --- |
| **Google Search — dive-native terms** | Marginal | Inventory. ~20–90 US searches/month for the best head term; 2–9 clicks/month at 100% impression share |
| **Google Search — brand defense (`diveday`)** | **Worth running** | Volume scales with *DiveDay's own outreach*, not with category inventory. Sub-$1 CPC |
| Google Search — generic booking terms | Avoid | $12–30 CPC against Booking Holdings and Tripadvisor, 95%+ non-dive traffic |
| Performance Max | Avoid | Needs ~$100/day to exit learning and conversion history to train on. DiveDay will have 25 conversions *ever* |
| **Meta / Instagram** | Avoid | Detailed targeting became a *suggestion* rather than a filter for all 11 common performance goals in Jan 2026, and cannot be disabled for conversion/link-click/LPV goals. There is no "dive shop owner" attribute and never was |
| **LinkedIn** | Avoid | 78 of ~1,200 listed US dive shops have any LinkedIn presence (6.5%); no dive category in its taxonomy; 300-matched-member minimum; $6.50–10 B2B SaaS CPC |
| Reddit | Avoid | Cheapest media of the three, but r/scuba (~195k) is consumers, not owners |
| **Capterra / GetApp / Software Advice PPC** | Avoid (paid) / **do the free listing** | **No dive, scuba, or dive-shop category exists on any of them.** You would bid inside Tour Operator against FareHarbor's 1,129 reviews, at a quality-score penalty for having zero. ~$500/mo commonly cited minimum |
| **G2** | Free profile only | $2,999 first year, ~$6,000 renewing. But its tour-operator category is an order of magnitude thinner than Capterra's (FareHarbor 39 reviews vs 1,129) — the one genuinely plantable flag |
| TrustRadius | Avoid | ~$30,000/product/year — **more than DiveDay's entire annual revenue at full cap** |
| **Scuba Diving Industry Magazine** | Hold until a case study exists | The only printed monthly B2B dive trade magazine, mailed free to every US dive retailer. Sponsored email $750 — but **gated behind buying a full-page ad in the same month**, and display rates are quote-only |
| Consumer dive media (DeeperBlue, Divernet, X-Ray Mag, Scuba Diving, Alert Diver, InDEPTH) | Avoid | All of it sells divers to gear and travel brands. Near-total waste for a shop-operations product |
| **DEMA Show 2026** | **Buy the badge, not the booth** | Trade-only, no consumers, no guest passes. Nov 3–6, New Orleans |
| DEMA membership + Dive Industry Association | **Buy both** | $200/yr + $125/yr. The only two listings in this research that reach actual dive shop owners |
| Scubanomics / Business of Diving Institute | **Not buyable — correct the internal record** | [rollout.md](../rollout.md) names it as a sponsorship target. It **sells no advertising at all** — no rate card, no sponsorship page, no published subscriber count. Darcy Kieran has 635 Medium followers; the podcast has 827 lifetime Spotify plays. Excellent editorial fit, real relationship value, zero inventory |
| ScubaBoard | Listening post only | Commercial activity is gated behind a paid Business Sponsor tier (reported $100–150/mo). The shop-owner business forum holds 107 threads lifetime against 65,363 in consumer classifieds |

## Why Google Search cannot fill the cohort

The category's query branch is measurably thin. Probing Google's own autocomplete
(`suggestqueries`, client=firefox, gl=us):

- `dive shop softw` returns exactly **3** suggestions. So does `dive center softw`, and
  `scuba shop softw`. For calibration, the consumer term `dive log softw` returns **9**.
- `dive shop booking`, `best dive shop soft`, `scuba diving business soft`, `dive shop crm` and
  `dive center booking` return **zero** — below Google's suggestion threshold, and squarely in
  "Low search volume" territory.
- Three terms are not B2B queries at all: **`dive shop pos`** autocompletes toward *Poseidon*;
  **`boat manifest`** is genealogy and freight (`ellis island boat manifest`, `manifest number
  shipping`); **`scuba waiver`** is divers hunting a form to sign.
- **`EVE dive` returns exclusively anime and gaming** (`divergence eve`, `eve dive suit`). Any match
  type broader than phrase drags DiveDay into EVE Online traffic.

Working the volume from the corrected census: 851 shops on a 3–7 year replacement cycle is ~120–280
shopping episodes/year, ~10–23/month; at ~5 phrasings per episode that is **50–115 US searches per
month across every dive-software phrasing combined**. The best single head term is **20–45/month**.
At a stellar 10% CTR and unattainable 100% impression share, that is **2–4.5 clicks/month**.

**Consequence:** at a base-case 0.38% click-to-paid (0.95 click-through × 8% demo entry × 25%
trial start × 20% trial-to-paid), one paying shop needs **~263 clicks** — **~117** on optimistic
assumptions. Annual click supply is **~50–150**. So paid search delivers somewhere between
**0.2 and 1.3 shops per year** (worst case 50/263, best case 150/117). Against a cohort of 25 that
is off by an order of magnitude, and no budget fixes it — there is no budget that creates queries.

Worth stating plainly because it is the crux: **the CAC is survivable and the capacity is not.**
Implied CAC at 263 clicks × $5 is ~$1,315, against a $1,020 absolute ceiling (12-month gross-profit
payback) and a $510–678 operating ceiling — the same order of magnitude, arguable. The capacity miss
is 20×+. Paid search here fails on inventory, not efficiency, which is why "spend more" and "optimize
harder" are both non-answers.

## Who actually advertises in this category

Verified by inspecting production Google Tag Manager containers, which only bundle runtime for tag
types a container actually configures:

- **Generic tour platforms run full paid stacks.** FareHarbor (`AW-984662758`), Rezdy
  (`AW-1009712759`), Checkfront (`AW-1029841353`), Xola, Peek and TrekkSoft all carry Google Ads
  conversion tags. Peek, Xola, FareHarbor, Rezdy and Checkfront additionally carry **Capterra
  trackers with live vendor keys** — that directory is the category's real B2B acquisition channel.
- **Dive-native vendors buy almost nothing.** DiveAdmin carries GA4 (`G-298FTTR1GX`) and no ad pixel
  of any kind — no GTM container at all, for a company publishing ~110 blog posts. Bloowatch,
  EquipDash and Diversdesk are the same. Smartwaiver hardcodes `AW-1069140153` in its homepage HTML.
- **DiveShop360 is contested and should be treated as unresolved.** One pass read `__awct`/`__sp`
  with conversion ID `10835706109` out of `GTM-NFXQ2F6`; a second pass found LinkedIn Insight
  (`5806602`), Bing UET and Meta but **no** `AW-` tag in the same container. Both agree on the
  LinkedIn/Bing/Meta stack. Confirm before relying on "they bid and we don't."

One caveat that cuts against the optimistic reading: **a tag proves an install, not a live campaign.**
A conversion tag can outlive its campaign by years. This does not rescue the plan — it makes it
worse, since DiveDay may be the only bidder *and* there may be nothing to bid on.

## The category's positioning whitespace

Competitor copy has converged on one indistinguishable claim. **"Built by divers, for divers" is
used verbatim by two separate vendors** (DiveShop360: "MADE FOR DIVERS BY DIVERS"; DiverDash: "Built
by divers, for divers"). Every value proposition in the set is time-saved or revenue-grown.

**Nobody makes a safety claim.** Across eleven vendors reviewed, no headline or section heading
contains *fail-closed*, *refuse*, *gate boarding*, *roll call*, or *offline on the water*.
Checkfront comes closest and still treats the manifest as co-location, not enforcement: "Your
manifest, waivers, and guest details live together." And the most dive-native marketer has published
its own disqualification — DiveAdmin's comparison table states, in its own words, that its
certification tracking is **"Manual entry required"** and its offline capability is **"Cache only
(requires internet)."**

That is the open flank, and it is the one DiveDay's readiness engine already occupies.

Two claims-relevant findings sit alongside it:

- **EVE is not publicly sunsetting.** No end-of-life notice exists on evediving.com or in trade
  press; post-acquisition coverage says existing customers continue with the same EVE support team,
  and DiveShop360's own roundup still lists EVE's PADI endorsement as a strength. `/switching/eve`
  must argue from documented usability complaints, never from a shutdown claim the vendor has
  publicly denied. (This assessment corrects the "assume sunset" shorthand in
  [competitive-analysis.md](competitive-analysis.md).)
- **DiveAdmin injects a 5.0-star `aggregateRating` built from three testimonials** while its Capterra
  listing reads 0 reviews, and publishes 40%/60%/95% stat tiles with no methodology. It is the
  anti-model, and it is also why the honest-numbers posture is worth more here than anywhere.

## What to buy instead, in order

1. **DEMA Show 2026 — attendee badge, not a booth.** Nov 3–6, Ernest N. Morial Convention Center,
   New Orleans. Trade-only ("not open to consumers or the general public, and guest passes are not
   provided"), 7,000+ professionals, 41.7% classifying as Retail Dive Store, 61% holding final
   purchasing authority. **Silver membership $200 + expo badge $85 ≈ $285 plus travel.** A 10×10
   booth is $2,395 at member rate — but payment in full was due **August 25, 2026** for floor-map
   inclusion, 81% of 2025 exhibitors already rebooked, and a zero-customer product has nothing to
   demo against 500+ established exhibitors. Let that deadline pass deliberately and in writing.
   Exhibit in 2027 if the cohort exists and has stories. Sponsorships are separately cheap and
   itemized if a presence is wanted without a booth: social post $500, printed floor-map interior ad
   $450, attendee-newsletter banner $1,000.
2. **The Keys in late September.** Florida's calendar is **inverted** from the rest of the US: the
   Keys peak December–April (March ~96% hotel occupancy) and bottom out in September–October at the
   height of hurricane season. Key Largo → Islamorada → Marathon → Key West is ~60–80 operators along
   one road, and in the slow window the owners are behind the counter with time to talk. This costs
   less than one month of a Meta test and is the single best-timed action available.
3. **The two directory memberships.** Dive Industry Association $125/yr (monthly Trade Directory &
   Buyers Guide) and DEMA Silver $200/yr. DEMA Silver also pays for itself against booth or
   registration savings the moment you attend.
4. **Free software-directory listings.** One Capterra submission propagates to GetApp and Software
   Advice; claim a free G2 profile in the same category. Pick **one** category — bidding or listing
   across several splits review count and lowers ranking in each. Brand-search hygiene, not a lead
   source. Then ask every design partner and founding shop for a review: **five reviews is the
   threshold at which a star rating displays at all**, and no vendor in this category has any.
   (The Capterra Shortlist is a locked door regardless — its methodology explicitly excludes products
   that "must serve multiple industries, not ultra-niche.")
5. **Earned trade coverage, which costs a distribution fee.** DiveNewswire is the only weekly
   recreational-diving trade newswire, charges "a small distribution fee," and reaches several
   thousand B2B contacts. Dive-software news demonstrably clears the editorial bar: the
   DiveShop360/EVE acquisition ran in Divernet, DeeperBlue, DiveNewswire, The Scuba News and PRWeb.
   In parallel, pitch a guest spot on **"Level Up: From Behind The Counter"** — Scuba Diving Industry
   Magazine's retailer-to-retailer show, explicitly about shop owners' operational problems.
6. **The insurance intermediary.** An underwriter whose product is priced on incident risk is the one
   party with a genuine commercial interest in a fail-closed readiness engine. The
   [insurance playbook](../stakeholders/insurance.md) already schedules this conversation; it is also
   the best referral relationship in this document, and no competitor can buy it.

## The budget this supports

Corrected for the 2–3 free design partners, the paid cohort is ~22–23 seats, so full-cap revenue is
**~$26,700/year**, not $29,700. Against a ~$85/shop/month gross profit, total lifetime company gross
profit at cap is roughly **$45,000**. A defensible *lifetime* acquisition envelope at 15–20% of that
is **$6,900–9,200 — for everything**, amortizing to roughly **$190–255/month of all marketing**.

For scale: a $1,500/month Meta test is **67% of full-cap annual revenue**; Capterra's $500/month
floor is 22%; TrustRadius alone exceeds 100%.

**Recommended ad spend: $0 until a design partner is live, then a $120/month hard cap on one
Google Search campaign** (which will structurally underspend to $30–60, because inventory binds
before budget does). Everything else goes to the badge, the road trip, and the phone.

## The kill metric

Not clicks, not CTR, not CPA, not impression share — at ~30 eligible impressions a "40% impression
share" is twelve impressions and swings wildly on a denominator that rounds.

**Qualified dive-operator clicks per month**, read weekly off the search-terms report: clicks whose
search term expresses dive-operator buying intent (dive/scuba × shop/center/business ×
software/booking/management, or an incumbent brand).

| 60-day trailing average | Action |
| --- | --- |
| **< 4** | Kill. At ~263 clicks per shop this cannot produce one customer inside five years |
| **4–15** | Hold at the cap. This is the expected band — a catcher's mitt, not an engine. Judge annually on attributable conversations |
| **> 15 and ≥1 attributable conversation/30 days** | The volume estimate was wrong by 2×+. Redo the arithmetic above before spending more |

A secondary tripwire: **any month where spend reaches the cap.** At 4–12 clicks/month the campaign
should underspend. Full spend means match types broadened — investigate the same day.

## Why measurement cannot rescue this

The lifetime conversion count is below the monthly *training minimum* of every automated system in
advertising. Target CPA wants ~30 conversions in 30 days; tROAS wants 50. DiveDay's total is 25
**for the life of the company** — structurally, permanently below the floor. Smart bidding,
Performance Max, lookalike seeds and Advantage+ are unreachable forever, not merely premature.

A/B testing is arithmetically impossible: detecting a 50% relative lift on a 3% baseline at 80%
power needs ~1,700–2,000 visitors per arm. At 3 clicks/month, one headline test completes in about
90 years.

**The real risk is a false positive, not wasted money.** The plausible outcome is that ads run while
the founder is also cold-calling, guesting on a podcast and walking DEMA; two shops sign, both
touched a `/switching/*` page, last-click credits the ad, and spend goes up. That error cannot be
detected at n=2 and no future volume will correct it. A campaign that cannot be falsified is not an
experiment.

**The standing rule this argues for:** *never run a channel whose value depends on learning from
conversion counts.* Run channels that produce **conversations** — a single conversation is
qualitatively informative at n=1, and a single conversion is not.

## Tactics ruled out, and why

- **Scraping Smartwaiver's indexed waiver pages** (`waiver.smartwaiver.com/w/<id>/web/`) to build a
  prospect list. It works — those URLs name the operating shop, and every hit is a shop already
  paying for digital waivers. **Do not do it.** In a state with ~200 shops who all know each other,
  the question "how did you find me?" has two answers: lie, or say "I scraped your public waiver
  pages." From the vendor whose pitch is *trustworthy custodian of your divers' medical data*, the
  second is a story that gets told at DEMA and never stops being told.
- **Any site-wide ad pixel installed the normal way.** See
  [FU-20260812-ad-pixels-would-bypass-capability-redaction](../follow-ups/FU-20260812-ad-pixels-would-bypass-capability-redaction.md).
- **Competitor-brand bidding.** Legal — Google does not restrict trademarks as keywords. But an
  upheld complaint restricts **the entire second-level domain going forward**, and `dive.day` is the
  company's only domain and only SEO asset. The upside is ~2 clicks/month on `diveshop360`, whose
  autocomplete is dominated by *login* and *support* (existing customers, not shoppers), and zero on
  the EVE terms. If the brand terms are bid at all, keep the trademark **out of the ad text** and
  land on the matching `/switching/*` page.
- **Group promotion.** PADI's own published guidance to its professionals is "you should not post to
  promote your business directly." ScubaBoard forbids recruiting outside its paid sponsor forums. The
  precedent is on the record: **ScubaBoard thread 645196, April 2024** — a founder posted almost
  exactly this pitch (no-code dive-center management tool, waitlist) and was publicly dogpiled,
  including "good luck with your IPO."
- **A lookalike sending domain for cold email.** At 60–300 hand-written emails over three months this
  is correspondence, not a cold-email program, and it should come from the real domain signed by a
  real person. An email from `diveday-app.com` to a shop you will shake hands with in November
  contradicts everything `/about` argues.
- **Savings arithmetic in ad copy.** The "$4,000–$17,000/yr saved versus a commission model" figure is
  seductive and is banned by name in [marketing.md](../marketing.md#claims-policy-hard-rules): no
  booking volume, no savings math, no "typical shop." It is the same fabricated-proof failure as an
  invented testimonial, wearing a spreadsheet.

## Prerequisites before any ad runs

Both are independently worth fixing, and both are cheap:

1. **A published privacy policy and terms.** There is no `/privacy`, `/terms`, or legal route in
   `src/app/`, and no footer link. Google Ads and Meta both effectively require one for a site
   collecting personal data, and `/onboard` creates an account from an email address. Beyond the
   disapproval risk: the first paid click in company history would land a shop owner on a site that
   will store his divers' medical flags and publishes no data-handling statement. See
   [FU-20260812-no-privacy-or-terms-page](../follow-ups/FU-20260812-no-privacy-or-terms-page.md).
2. **The Phase 0 blockers in [rollout.md](../rollout.md#phase-0--get-legally-and-operationally-real-now--early-sept).**
   This is the strongest argument in the assessment and it is worth stating as a failure path rather
   than a caution. A shop that clicks an ad today: reaches the demo (which is excellent), starts a
   trial, tries to send a waiver link — **and the email does not arrive**, because H-09's SES
   production access is outstanding and `notify()` degrades to a copyable link. Tries to take a
   deposit — **cannot connect Stripe**, because H-07's live Connect platform application has not been
   submitted. Decides to buy — **there is no way to pay**, because no subscription billing exists in
   the schema and the only path is emailing `onboarding@dive.day`. On day 22 Settings says "Your
   trial ended" and nothing locks. And at DEMA in November they meet a shop the founder recruited by
   hand and discover it was offered **six months free** (H-12, amended 2026-08-12) while they got
   three weeks.

   The deeper version: **H-25 permits Phase 1 pilots to run on the counsel-unreviewed waiver flow
   only because each pilot shop signs an explicit risk acknowledgment** alongside a pilot agreement —
   an instrument that does not exist yet (H-18). H-19 records a deliberate decision to carry no E&O
   and no cyber coverage. A self-serve ad-sourced trial signs nothing. Advertising is precisely the
   mechanism that converts a controlled, hand-papered pilot intake into an uncontrolled intake of
   strangers loading real divers' medical records into that flow — silently, at 3 a.m., while nobody
   is watching. **The failure mode is not "the ads don't work." It is "the ads work."**

## What this changes in the plan of record

- [rollout.md](../rollout.md) Phase 2 schedules "modest paid search on high-intent queries
  ('EVE dive shop software replacement', 'DiveShop360 alternative') pointed at the guides — the
  documented Jane/anti-Mindbody pattern." **The pattern is right and the queries are not.**
  `diveshop360 alternative` returns zero autocomplete suggestions; the EVE switching terms return
  zero *and* collide with anime and EVE Online. The `/switching/*` pages remain correct as **SEO and
  sales collateral** — `dive.day/switching` already ranks #2 for "how to export data from EVE" with
  no backlinks — but they are not a paid-search target. The rollout line has been narrowed to point
  here.
- [rollout.md](../rollout.md) Phase 1 names Scubanomics as a channel where "a guest piece or
  sponsorship reaches exactly the buyer." **The sponsorship half is not purchasable** — it sells no
  advertising. The guest-piece half is right and is better aimed at Scuba Diving Industry Magazine's
  retailer podcast.
- The DEMA posture the rollout "already leans" toward — meetings over a booth — is **confirmed, with
  a date attached**: the booth deadline is past and the badge is $285.

## Re-check this document when

Any of these changes the arithmetic rather than the tactics: the 25-shop cap is lifted; a named case
study is published (it moves trial-to-paid from the 15% end of the band to the 25% end, and it is the
precondition for buying a trade-magazine sponsored email); DiveDay has 15+ published reviews above
4.0; or a rival's tag container changes what the paid landscape looks like.
