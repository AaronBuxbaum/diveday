# Competitive landscape — 2026-09-01

> A whole-field read of DiveDay's feature set against the dive-shop software market and against
> the problems a dive shop actually has, written 2026-09-01 from four parallel research passes
> (roughly 200 web searches and 400 page fetches over vendor sites, pricing pages, help centres,
> app stores, review platforms, ScubaBoard, the PADI Pros blog and the dive trade press), then
> checked against the running codebase, `shipped.md`, the roadmap, and the open issue tracker. It
> supersedes the market table in [competitive-analysis.md](competitive-analysis.md) (2026-07-20)
> and updates the two rival profiles in [competitive-strategy.md](competitive-strategy.md)
> (2026-07-22); both stay as the record of the reasoning that shaped the product. An assessment,
> not a commitment: every buildable gap below is a GitHub issue, and an owner's nod moves it into
> [the roadmap](../features/roadmap.md).

## Verdict in five sentences

DiveDay's core — booking, waivers, manifests, rentals, reminders at a flat price — is now
**table stakes**: 20 or more of the 32 products surveyed say the same sentence, and a dozen of
them launched in the last eighteen months at $19–$119 a month. What DiveDay holds that the field
does not is the **boarding-time safety layer** (fail-closed readiness, per-dive roll call, offline
manifests, buddy teams, a pre-departure check), which exactly one other product (EquipDash) has
attempted and none has shipped as tested code. The two features that keep owners paying the
retail incumbents despite hating them — **agency certification sync and prepaid air-fill cards** —
are absent from every newcomer and from DiveDay. What owners say they want, across a decade of
forum threads, is not a feature: it is **support that answers, a UI seasonal staff can learn,
integrations that don't break, and a way out** — all four of which DiveDay has already bet on.
The gaps worth filing are seven, listed at the end with their issue numbers; the rest of what the
market has is either already tracked, deliberately declined, or not worth a shop's money.

## The incumbents, re-verified

### DiveShop360 — Rain Retail Software's dive vertical, now carrying EVE

- **Who:** a vertical product of Rain Retail Software, LLC (Rain POS), Provo, Utah, founded 2006,
  GM Ken Colbert; not "Ascend". Acquired EVE Diving (ISSYS, PADI-endorsed) in July 2023 and still
  says "EVE is not going away" with no sunset date
  ([summit recap, 2024-02](https://diveshop360.com/blog/first-annual-retail-dive-summit-event-highlights),
  [PRWeb, 2024-12](https://www.prweb.com/releases/dive-shop-360-celebrates-30th-anniversary-as-the-leading-dive-shop-management-system-302324544.html)).
  Claims 1,000+ customers in 2024 and 30 years; overwhelmingly US.
- **Retail-first, verified again.** Every top-level page leads with POS, 120+ vendor catalogs and
  the e-commerce site; courses, trips, rentals and repairs are modules on top. **Startup tier
  ($149/month on the pricing page, $199 elsewhere)** carries POS, repairs, trips with deposits and
  seat caps, rentals and invoicing. **Core (quote-only)** is where cert tracking (PADI, SSI,
  SDI/TDI), Smartwaiver, air cards, loyalty, QuickBooks Online and ShipStation live. **Plus
  (quote-only, historically $3,000 setup + $299/month)** adds multi-location and Avalara. Setup
  fees on every tier; a **$50/month "Messaging Assistant"** add-on for text-to-pay, 1:1 texting
  and AI auto-replies ([pricing](https://diveshop360.com/pricing),
  [promo](https://diveshop360.com/promo), [FAQ](https://diveshop360.com/faq)).
- **What moved since July:** "Manifest 2.0", "Roster 2.0" and "Rental 2.0" (Dec 2024) are booking
  admin, not on-boat work — no roll call, no offline mode (the FAQ recommends a cellular hotspot),
  no medical form, no staff scheduling, no API, no WhatsApp, no native app. PADI cert lookup and
  eLearning code assignment are real and Core-gated; PADI student-progress tracking was "coming
  soon" in Feb 2024 and remains unverified. AI text replies appeared on the site in 2026.
- **Sentiment:** no listing on Capterra, G2, GetApp, Software Advice or Trustpilot. ScubaBoard
  operators (2017–2019) are the happiest incumbent users in the field — "best we have found",
  "the company is responsive". The nearest unfiltered proxy is **Rain POS** (same platform
  family, Capterra 4.1 from 134 reviews): weekday-only support, glitches that take weeks, a
  website builder people pay for and dislike, high onboarding cost and price creep
  ([Rain reviews](https://www.capterra.com/p/140893/Rain-Point-of-Sale/reviews/)).

### DiveAdmin — four people in Pattaya, shipping fast, still reviewless

- **Who:** built by AWcode, Pattaya, Thailand; founder Mark Walker (PADI MSDT, ex-centre owner);
  team of four; self-reported 152+ centres in 27 countries; public blog since Sept 2024
  ([about](https://diveadmin.com/en/about)). Dive-centre-first with a resort and liveaboard tilt
  (hotel-room fields, transfers on a map, cabins linked to boats).
- **Pricing:** $39 / $59 / $119 per month by staff count, **$3,495 lifetime**, 14-day trial, no
  setup fee ([home](https://diveadmin.com/en)).
- **What moved since July:** full finance with payroll (Apr 2025), equipment with per-item or
  by-size pools and size-shortage warnings per trip (Aug 2025), hosted booking pages (Nov 2025),
  tanks and nitrox on trips (Dec 2025), accommodation and liveaboard cabins (Jan 2026), a
  WhatsApp/SMS unified inbox via Twilio, a "Coral" staff AI assistant, 15 languages, and the
  REST API + OAuth 2.1 + **MCP server** story — whose developer docs still cannot be found. SSI
  mySSI sync is real (auto-creates students); **PADI and QuickBooks/Xero are claimed only in blog
  copy**, absent from the integrations page. Offline is "limited caching only" by its own
  admission ([integrations](https://diveadmin.com/resources/integrations/),
  [vs EVE](https://diveadmin.com/resources/dive-admin-vs-eve/)).
- **Sentiment:** Capterra listed with **0 reviews**; zero ScubaBoard mentions across four dive
  software threads; a WordPress plugin with one review and under ten installs; one vendor-hosted
  case study (Ocean Tree, Bali). "Increase bookings by 40%, reduce admin time by 60%" is
  unsubstantiated. Effectively unmeasured.

### EVE — the forced-migration pool is still there

Still marketed separately at [evediving.com](https://evediving.com/), quote-only, desktop. The
sentiment record is unchanged and unflattering: "crappy UI. It is a kludge and tries to do too
much", "tech support is almost nonexistent", "the most comprehensive and user UNfriendly software
ever developed" (2024), praised for exactly one thing — the PADI integration. Shops have been
"looking for an EVE replacement" on ScubaBoard since 2017. The `/switching/eve` guide is aimed at
the right pool.

## The wider field — 32 products, one map

The full profiles (one line each, features, pricing, sentiment, URLs) are in the research this
section condenses; what matters for DiveDay is the shape of the market.

| Segment | Owners | Challengers | What it means |
| --- | --- | --- | --- |
| **Retail POS + inventory + service** | DiveShop360 (+EVE), Rain POS | Lightspeed, EnComPOS, RetailEdge | Agency cert sync and air-fill cards live here and almost nowhere else. Concede POS loudly, as [vision.md](../vision.md#non-goals-for-now) already does |
| **Charter / day-trip booking on commission** | FareHarbor, Xola, Peek Pro | Rezdy, Checkfront, Bookeo (flat), TrekkSoft | ~6% guest-facing fees are the loudest complaint in the field; Checkfront is the only one modelling tanks, nitrox and weights as shared resources |
| **Dive-native ops, flat fee, zero commission** | Bloowatch (Europe), DiversDesk (Asia) | DiverDash, ScubaCloud, AbyssOS, DivingList, DivePlanner Pro, Theybook, EquipDash, Geek Divers, Divery, AquaDivePro, DiveStreams, ScubaHub, DivePrep | **DiveDay's direct peer group.** Fragmented, $19–$119/month, none with independent review volume; a dozen say "not FareHarbor: flat fee, own your data" |
| **Training records / student progress** | MySSI and the PADI app hold the records | DiverDash, ScubaCloud, AbyssOS, EVE/DS360 track progress locally | No open API from PADI or SSI; DiveOne's "sync" is beta |
| **Safety layer on top of a booking engine** | Scuba Manager (on FareHarbor) | EquipDash | Incident reports, buddy pairing, departure lock: nearly empty territory |
| **Liveaboard** | Liveaboard Manager (B2B agents), DiveHQ | AbyssOS, DiversDesk Liveaboard, DiveBooking | Cabin logic, agent commissions, LiveaboardHub/ScubaDates sync — out of DiveDay's scope |
| **Marketplace / OTA** | PADI Adventures (4.9% widget, 5% referral), LiveAboard.com | Divebooker, Liveaboards.com, Viator/GetYourGuide via channel managers | Deepblu shut its servers Dec 2023; PADI is the channel to coexist with |
| **Staffing only** | DiveCrewPro | — | "Keep your POS, fix your scheduling" — one idea at $49 |
| **Waiver-only** | Smartwaiver | WaiverForever, WaiverSign | Being absorbed as built-ins; DiveDay's are native |
| **AI reception / CRM** | MOLA, DiveOps.ai | Anolla, EquipDash, DiveOne | "AI agent" is the 2026 marketing word; all vendor-claimed, no owner evidence |

### Feature frequency — what is table stakes and what is rare

Counts are features explicitly claimed on a reachable page, across 32 products (EVE, Bloowatch,
DiversDesk, DiverDash, ScubaCloud, AbyssOS, Geek Divers, DivingList, DivePlanner Pro, EquipDash,
Scuba Manager, Anolla, DiveOne, Divery, AquaDivePro, DiveBooking, Theybook, Roverd, DiveHQ,
Liveaboard Manager, FareHarbor, Xola, Rezdy, Checkfront, Peek Pro, Bookeo, WeTravel, DiveShop360,
Rain POS, EnComPOS, Lightspeed, DiveStreams). Generic engines certainly have more than shows
(gift cards, promo codes), so read the numbers as floors. The DiveDay column is verified against
`shipped.md` and the code on 2026-09-01.

| Feature | Of 32 | Band | DiveDay |
| --- | --- | --- | --- |
| Rental gear tracking | 27 | Table stakes | ✅ gear register, reservations, service clocks |
| Online booking / embeddable widget | 26 | Table stakes | ✅ plus `?embed=1` |
| Boat manifest / roster per departure | 23 | Table stakes | ✅ and far beyond (roll call, offline) |
| Automated email/SMS confirmations and reminders | ~22 | Table stakes | ✅ email, SMS, WhatsApp, delivery receipts |
| Digital waivers / e-signature | 21 | Table stakes | ✅ native, versioned, sign-once |
| Staff / instructor scheduling | 20 | Table stakes | ✅ staffing week; ⚠️ owner-driven only (#1235) |
| Certification capture | 17 | Common | ✅ verified vs claimed, typed gates |
| Retail POS | 15 | Common | ❌ non-goal |
| Deposits / partial payments | ~14 | Common | ✅ |
| Mobile staff app | ~14 | Common | ✅ PWA; native shell recorded as escape hatch |
| Equipment servicing / maintenance logs | 13 | Common | ✅ service clocks; ❌ work orders (declined) |
| QR / tablet check-in | 12 | Common | ⚠️ counter check-in exists; no bookingless QR door (#1236) |
| Multi-location / multi-boat | 12 | Common | ⚠️ multi-tenant; no boat entity (roadmap §4) |
| Course / student progress tracking | 11 | Common | ✅ roster + material status, staff-recorded |
| Agent / reseller B2B portal | 11 | Common | ❌ (#1237, owner question) |
| Medical questionnaire | 10 | Common | ✅ RSTC 2026 form, hard review block |
| Inventory / purchasing / vendor catalogs | ~10 | Common | ❌ non-goal |
| Memberships / loyalty / prepaid passes | 8 | Differentiator | ✅ dive packages as entitlements; ❌ fill cards (#1234) |
| Promo / discount codes | 7 | Differentiator | ✅ |
| OTA distribution (Viator, GetYourGuide, Google) | 7 | Differentiator | ❌ by design; coexist guides instead (#1238) |
| Staff commissions / payroll / payslips | 6 | Differentiator | ❌ declined; tips-by-crew is roadmap §11 |
| Dynamic / seasonal pricing | 5 | Differentiator | ⚠️ last-minute rule table; seasonal windows roadmap §11 |
| Dive-site database with conditions | 5 | Differentiator | ✅ library, briefings, difficulty code, field guide |
| Liveaboard cabins | 5 | Differentiator | ❌ out of scope |
| Retail webshop | 5 | Differentiator | ❌ non-goal |
| Review collection / display | 5 | Differentiator | ✅ verified diver reviews, moderation floor |
| Agency certification sync | 4 | Differentiator | ❌ no API exists (H-10); partnership question #1239 |
| Accounting export | 4 verified | Differentiator | ✅ QuickBooks Online connector |
| Wait list | 4 | Differentiator | ✅ seat-recovering, invite path |
| WhatsApp to divers | 4 | Differentiator | ✅ shop's own number via Meta Cloud API |
| Weather / tide data | 4 | Differentiator | ✅ marine outlook; ❌ tides |
| Offline-first operation | 4 | Differentiator | ✅ encrypted offline manifests with reconciliation |
| Air-fill / tank cards / gas logs | 4 | Differentiator | ❌ (#1234); fill log gated on H-11 |
| Multi-currency | 4 | Differentiator | ⚠️ one declared currency per shop |
| Built-in double-entry accounting | 3 | Rare | ❌ not ours to build |
| Accommodation / room packages | 3 | Rare | ❌ out of scope |
| AI assistant / agent | 3 | Rare | ❌ deliberately; ideas in `ai-ml.md` |
| Diver-facing logbook | 3 | Rare | ⚠️ recap + D31 "planned vs lived" |
| Insurance proof (upload only) | 3 | Rare | ✅ field exists; reader is roadmap §11 |
| Gift cards | 2 verified | Rare | ❌ roadmap unscheduled |
| Guardian sign-off for minors | 2 | Rare | ⚠️ solo signature accepted for now (H-21) |
| Compressor logs | 1–2 | Rare | ❌ (H-11) |
| Buddy pairing | 1 | Rare | ✅ buddy teams with split-team alert |
| Incident reporting | 1 | Rare | ✅ departure log; no structured incident form |
| Roll call / departure accounted-for | 1 | Rare | ✅ per-dive checkpoints, missing-diver escalation |
| Marine-park fees | 0 | Absent | ❌ Florida needs none |
| Referral program inside the ops tool | 0 | Absent | ⚠️ counted share links, roadmap §11 |
| Live insurance verification (DAN / DiveAssure) | 0 | Absent | ❌ no API exists |

Three things the table says at a glance. DiveDay is **complete on every table-stakes row and
most common rows** — the July assessment's "critical, partial" verdicts on course management and
equipment are closed. Its **differentiators are real and still rare**: WhatsApp, offline
manifests, reviews and buddy teams each appear in five or fewer products, and roll call in one.
And the **rows marked ❌ that are not deliberate non-goals** are exactly the seven issues at the
end.

### Pricing, seen from the whole field

- **Flat, no commission** (DiveDay's band): DivingList $19–89; DiverDash $39–119; DiversDesk
  $27–64; Bloowatch €49–119 with a 12-month lock-in and a waiver add-on that reaches €250/month;
  DivePrep free–€49; DiveCrewPro $49; Theybook $99; DiveAdmin $39–119 or $3,495 lifetime;
  ScubaHub €129.99 per centre; DiveHQ €100 for two boats; Bookeo $39.95–119.95; Divery €169–339.
- **Subscription plus a percentage:** Rezdy $49–249 + 1.75–2%; TrekkSoft €49–249 + €799 setup +
  2–3%; EquipDash from $29 + 1–2% charged to the diver.
- **Commission only:** FareHarbor ~6%; Peek ~6%; Xola 2.39% + 30¢ published plus a ~6% partner fee
  at checkout; PADI Adventures widget 4.9%.
- **Quote only:** EVE, AbyssOS, Geek Divers, Scuba Manager, DiveShop360 Core and Plus.

DiveDay's $99 flat with everything included (H-12) sits at the top of the flat-fee band but below
ScubaHub and every incumbent's real all-in cost. Two newcomers (DivePrep, DivePlanner Pro) now
offer a **free tier bounded by activity** — trips per month — rather than by features; that is a
cleaner trial story than a dated trial and worth an owner's glance when H-12's post-cohort
pricing is decided. Not filed as an issue: pricing is a human-owned row.

## The 2026 newcomers — DivePrep, ScubaHub, DiveCrewPro

All three are real, distinct, and launched in 2026. None has a single independent review, forum
reply, Reddit or ScubaBoard mention, Product Hunt page, app-store listing, or user post that a
research pass could find (2026-09-01). What exists is vendor copy, one trade-press announcement
(DiveCrewPro) and one vendor-written case study (ScubaHub). Read them as *shapes of product* to
learn from, not as market share to fear.

### DivePrep (diveprep.app) — gear prep as the spine, priced by trips per month

- **What:** "Trips, prep checklists, online bookings, gear and maintenance, divers and waivers."
  Swiss operator, no named person or company; terms dated 3 July 2026; web only, Google sign-in;
  Vercel + Neon + Stripe + Resend + Sentry (its privacy policy lists the same stack DiveDay runs).
  No blog, changelog, FAQ or social presence ([site](https://www.diveprep.app),
  [pricing](https://diveprep.app/pricing), [privacy](https://diveprep.app/privacy)).
- **Features:** a today view; booking as a *negotiated request* (diver asks, shop proposes date +
  gear + price, diver confirms, it becomes a trip); public booking/registration forms; diver
  profiles with certifications, gear preferences, "quirks" and dive logs; per-trip shop-provided vs
  diver-brought gear with a one-tap prep checklist derived from diver gear profiles plus shop
  defaults; a wrench on any item or pool takes it out of service and out of every future prep
  list; staff with per-person permissions; a season dashboard (dives logged, trips run, gear churn,
  top course levels); full data export on every plan; up to 5 centers on Pro. **Absent:** medical
  forms, agency checks, manifests/roll call, fill logs, diver payments, marketing, offline,
  languages, integrations, API.
- **Pricing:** Free (10 trips/month), Club €19 (30 trips/month), Pro €49 (9,999 trips, 5 centers).
  Every feature on every plan; the only axis is trips per month; no card for free.
- **Worth copying:** a prep list that is *derived*, and an out-of-service flag that propagates; a
  free tier bounded by activity rather than by features.

### ScubaHub (scubahub.app) — the booking is the record, exception queues are the home

- **What:** "Dive center management software built around the trip: bookings, payments, waivers,
  equipment and the daily dive schedule." Built by an unnamed ex-aviation/banking engineer who then
  worked inside Drop Dive Maldives (an SSI Diamond Center). Spanish-first locales, EU hosting
  (Supabase EU, AWS Frankfurt), blog from 2026-04, launch discount expired 2026-08-31. Client-
  rendered site; everything below was read from its JSON-LD, locale bundles and public billing API
  ([FAQ](https://scubahub.app/faq), [product](https://scubahub.app/product),
  [about](https://scubahub.app/about), [security](https://scubahub.app/security)).
- **Features:** public booking page, pre-booking requests and quotes; Stripe card + bank transfer
  + cash, deposits/partial payments, payment links, **receipt upload with a staff validation
  queue**, refunds, balances, income/expense/margin views; **multi-currency with live FX and the
  Stripe FX fee itemised**; digital registration, medical, liability, satisfaction and course forms
  with **QR-code onboarding** and automatic alerts (medical condition, minor, no experience);
  profiles with certifications, total dives, last dive, nitrox; a daily planner (trips, groups,
  assignments); gear inventory with sizes per client and double-assignment warnings; products
  priced per person or as a **shared unit (boat, tank) by occupancy**; staff shifts, staffing
  planner, compensation rules and salary; CRM with **birthday-during-booking alert**, message
  history, templates and bulk email; **agency accounts with per-agency price lists** (hotel/B2B
  rates); five languages (en, es, de, fr, ja) with auto-translated booking pages and forms/emails
  in the guest's language; an **AI daily brief** (cached today/tomorrow summary) and AI translation
  of legal texts; multi-center groups with consolidated dashboard and billing; roles, audit logs,
  GDPR-aware forms. **Absent:** manifests/roll call by name, dive logs, fill logs, offline,
  WhatsApp/SMS to divers, reviews, integrations, API, self-serve export (support sends a copy).
- **Pricing:** €129.99 per active center per month, all-inclusive; centers 2–4 at €99.99, 5+ at
  €89.99; 45-day trial with a card; Stripe fees passed through and itemised. (Its JSON-LD claims a
  free tier that the billing API does not have.)
- **The only third-party-looking evidence in this segment:** its own
  [Drop Dive Maldives case study](https://scubahub.app/case-studies/drop-dive-maldives) — 220–250
  clients/month; onboarding completed before arrival 0% → 90–95%; check-in 5–6 min → under 1 min;
  clients arriving with unpaid bookings 20–30% → 0%; daily planning 30–40 min → 5–10; "more than
  50 hours per month" freed. Vendor-written, but it is the shape of proof a buyer wants and the
  shape DiveDay's V-02 gate still owes.
- **Worth copying:** exception queues as the home ("imminent bookings with incomplete
  registration", "payments awaiting validation", "arrival with no booking"); QR pre-arrival
  onboarding; agency rate cards; receipt-upload payments for bank-transfer markets; the birthday
  cue; an honest [comparison post](https://scubahub.app/blog/dive-center-management-software-compared)
  that names who should *not* buy it.

### DiveCrewPro (divecrewpro.com) — the staffing layer beside your POS

- **What:** "Dive shop scheduling software built for scuba instructors and divemasters" — and
  explicitly *not* a POS, booking, waiver, rental or CRM tool. John and Stefanie Dwyer (PADI
  Divemasters, Upstate NY; John a 35-year developer). Announced on
  [DiveNewswire 2026-03-14](https://www.divenewswire.com/introducing-divecrewpro-the-end-of-spreadsheets-to-manage-your-pros-class-assignments/)
  and [DeeperBlue 2026-03-29](https://www.deeperblue.com/divecrewpro-aims-to-revolutionize-dive-rostering/);
  the DeeperBlue forum thread has zero replies.
- **Features:** a course as **one class across several sessions** (pool Tuesday/Thursday + open
  water Saturday, different locations) with one staffing decision; **pros request the classes they
  are eligible to teach, the owner approves in one click**, and the admin sees who asked and when;
  pro blackout dates that block requests and flag conflicts retroactively; a pro portal with "my
  assigned" and one-tap self-email of assignments carrying Google Calendar links plus `.ics`;
  templated HTML email with variables; Google Calendar sync and double-book prevention; reports;
  vendor-run CSV/Sheets import. PADI and DiveShop360 integrations "on the roadmap"
  ([how it works](https://divecrewpro.com/how-it-works), [FAQ](https://divecrewpro.com/faq),
  [POS vs scheduling](https://divecrewpro.com/dive-shop-pos-vs-scheduling-software)).
- **Pricing:** $49/month flat, unlimited pros and classes; 60-day trial with no card but behind a
  contact form; a permanent $20/month early-adopter discount; same-day support and white-glove
  migration.
- **Worth copying:** inverting the staffing flow so pros bid and owners approve; blackout dates as
  a first-class object; "keep your POS, fix your scheduling" as a positioning template.

### What the three share

None has offline manifests, roll call, agency cert lookup, WhatsApp/SMS to divers, reviews, a
public API, or Zapier/Shopify/QuickBooks connectors. None has a native app. None has any
independent review presence. DiveDay already holds every one of those — the newcomers' lesson is
about *shape* (exception queues, derived prep, self-service staffing, pre-arrival onboarding),
not about a feature DiveDay lacks.

## What owners say — community and review-site evidence

**Coverage, honestly.** The reachable sources were ScubaBoard (a dozen operator threads,
2010–2025), Capterra / Software Advice / Trustpilot / App Store review pages, the PADI Pros blog,
DiveNewswire, The Scuba News, Dive Magazine, the Business of Diving instructor survey, and vendor
comparison pages. **Reddit, Facebook groups, LinkedIn posts, YouTube/TikTok/Instagram comments and
G2 could not be fetched from the research environment**, so the sample is forum + review site +
trade press, not the full social spread. Dive-shop owners rarely post about back-office software;
the richest first-hand threads are 2016–2019 and several EVE complaints pre-date its 2023
acquisition. General booking platforms have many reviews but almost none from dive operators, so
adjacent water-sports operators (kayak, charter fishing, boat cruise) stand in and are flagged.

### What owners praise

- **DiveShop360 — "best we have found," a responsive vendor, one system for service + rental +
  classes + retail.** "Nothing is perfect, but this is the best we have found"; "company is
  responsive … changes and updates take time, but still better than most"; "We have been with them
  for a very long time and have been very happy"
  ([2017 thread](https://scubaboard.com/community/threads/dive-shop-software.553882/),
  [2019 thread](https://scubaboard.com/community/threads/dive-shop-software.532088/page-2)).
- **EVE — the PADI integration is the thing people like.** "love that EVE integrates quickly and
  easily with PADI stuff" (same 2019 thread).
- **Live seat counts are what divers like about Scubaocity and FareHarbor.** "The one key feature
  that all divers like about both is that you can see in real time how much or little seat space
  is available"
  ([2021 thread](https://scubaboard.com/community/threads/owners-operators-what-dive-scheduling-software-do-you-use.614941/)).
- **Small vendors win on fast feature turnaround.** Dive.Management: "If there is something
  missing then just send email to the support and they will implement that very soon"
  ([2018](https://scubaboard.com/community/threads/dive-shop-software.532088/)).
- **Pre-arrival registration and cross-platform access.** Geek Divers: "no more paper, let them
  fill out form before they come" (2018, developer posting).
- **Built-in tank-fill / trip-card management.** Encompos "has a tank and trip card management
  system built in" (2019, answering a Florida shop asking for a fill-card program).
- **Overbooking prevention and easy online booking** (FareHarbor, water-sports operators, 2026):
  "manages all 100 of my kayaks and does not overbook them"
  ([Capterra](https://www.capterra.com/p/135106/FareHarbor/reviews/)).
- **Flat fee with no per-booking fee** (Bookeo, boat-cruise startup 2024): "anticipated every need
  … so user friendly" ([Capterra](https://www.capterra.com/p/117299/Bookeo/reviews/)).
- **Group waivers and the daily manifest** (Checkfront 2021)
  ([Capterra](https://www.capterra.com/p/99249/Checkfront/reviews/)); **offline kiosk waivers**
  (Smartwaiver: "love the offline mode, since we only have regular iPads",
  [App Store](https://apps.apple.com/us/app/smartwaiver-kiosk/id892954863?see-all=reviews&platform=iphone)).

### What owners complain about

- **EVE:** "crappy UI. It is a kludge and tries to do too much"; "The service module is awful and
  we've stayed with a paper and excel system"; "tech support is almost nonexistent"; "The money &
  time we spent on EVE was a huge waste"; "half our staff can't access the program to see their
  schedule" (PC-only); "if you ever are NOT a PADI shop, they will yank the software from you"
  ([2019](https://scubaboard.com/community/threads/dive-shop-software.532088/page-2),
  [2016](https://scubaboard.com/community/threads/dive-shop-software.532088/),
  [2012](https://scubaboard.com/community/threads/eve-dive-shop-software.438870/)).
- **Generic POS in a dive shop:** Lightspeed "doesn't meet our servicing requirements"; QuickBooks
  POS "not specifically geared towards the dive industry"; a shop with turnover needs something
  "not overly complicated" ([2017](https://scubaboard.com/community/threads/dive-shop-software.553882/)).
- **FareHarbor:** "$20 fees for processing a booking? It is ridiculously expensive"; an undisclosed
  "monthly API commission fee"; "continued to charge fees even after you close your account";
  "Emails regularly go unanswered"; "Your new platform, Desk, is HORRIBLE"; Viator/Airbnb API
  connections cause "overbookings, guides not being scheduled, lost bookings"; on mobile "you have
  to hit the 'increase' button a million times", 7-day payout holds
  ([Trustpilot](https://www.trustpilot.com/review/fareharbor.com),
  [Capterra](https://www.capterra.com/p/135106/FareHarbor/reviews/),
  [Software Advice](https://www.softwareadvice.com/ticketing/fareharbor-profile/)).
- **Rezdy:** "Bait-and-switch pricing once you're locked in" after a forced plan migration; "No
  phone line, no live chat, just slow, careless email responses"
  ([Capterra](https://www.capterra.com/p/122690/Rezdy/reviews/)).
- **Bookeo:** "doesn't appear to save data older than 2 years"; dated UI.
- **Smartwaiver:** kiosk app "crashes on startup" after iOS updates; "sometimes our integration with
  Fareharbor fails".
- **Cross-cutting: nobody migrates history.** "no one seems to be able to migrate customer purchase
  and service histories over to new systems"; DiveCenterHQ "is now defunct with no support"; the
  yearly EVE "data import process" is hated.

### Operational pains regardless of software

- **No-shows on small boats.** "every policy is the result of someone getting burned … every seat
  counts"; refund if the seat re-sells, "absolutely"
  ([2013](https://scubaboard.com/community/threads/last-minute-cancellations-and-no-shows.458661/)).
- **Weather and minimum-headcount cancellations against diver expectations.** A Key West owner:
  "when the trip isn't economical to run, no one wants to lose money … most shops in Key West will
  go with 2 people", and shops "work together to make sure you can get on a boat"
  ([2018](https://scubaboard.com/community/threads/dive-ops-who-enforce-24-hour-cancelation-policy-but-can-cancel-last-minute.557791/)).
- **Deposit and refund friction from the diver side.** Divers push back hard on non-refundable
  deposits and 28-day windows; "most dive operators are 24-48 hours cancelation notice for full
  refund" ([2020](https://scubaboard.com/community/threads/florida-dive-operators-with-user-unfriendly-policies.592336/),
  [deposits thread](https://scubaboard.com/community/threads/the-golden-rule-v-dive-deposits.655718/page-3)).
- **Spreadsheets, paper, email and WhatsApp are still the default.** "I just use Sheets in Google
  drive, Shopify POS and Constant Contact … I suspect we will outgrow it soon" (2022); most dive
  businesses "haven't used online booking, but have relied on email or contact forms"; every
  2025–26 vendor comparison benchmarks against "spreadsheets + WhatsApp".
- **Rental gear service records for liability.** An Oregon instructor with 35 reg sets, 35 BCDs and
  150–175 tanks wants to "track them between a couple techs and to keep good records in case
  something happens" — and explicitly does *not* want a full suite
  ([Apr 2025](https://scubaboard.com/community/threads/maintenance-software-for-in-house-rental-equipment.659284/)).
- **Tank-fill and air-card tracking.** "Can anyone recommend a scuba tank fill card management
  program?" (Florida, 2019); Go Dive Tasmania built its own prepaid fill-card app because punch
  cards get lost ([shop page](https://godivetas.com.au/pages/scuba-tank-filling-app-sell-track-prepaid-dive-fills));
  "Air Cards" was the most-requested DiveShop360 summit feature
  ([DS360 summit](https://diveshop360.com/blog/first-annual-retail-dive-summit-event-highlights)).
- **Instructor pay, tips and commission splits.** "Tips make the difference between me just
  covering my rent and having some money left over"; "Too many instructors at our shop. It dilutes
  the number of available students"
  ([BoDI survey](https://www.businessofdiving.com/dive-instructor-salary-how-much-money-does-a-scuba-diving-instructor-make));
  DS360 added per-employee commission rates and splits on request.
- **Cert verification is slow and exact-match.** Only pros can look divers up; "the names/dates have
  to match exactly what is printed on your PADI card"; a specialty a month old "does not show up
  when I search" ([thread](https://scubaboard.com/community/threads/verify-padi-certification-online.429929/)).

### What owners explicitly ask for

- "Web based," "Quickbooks integration," "Easy user-interface," "Multi-store support," a system
  that "manages boat charters, classes, rental equipment," and "Lots of softwares I see, have a
  horrible calendar view."
- Xero integration, web-store integration, better reporting, a servicing workflow.
- "a product with support so that we can get answers … in a timely fashion" and someone who can
  migrate "customer purchase and service histories".
- A tank-fill-card tracker; a standalone rental-gear service log "with a real database, not a
  suite".
- Real-time seat availability visible to divers.
- DiveShop360's requested-and-built list (Feb 2024): air cards, per-employee commission rates and
  splits, customisable travel forms, multiple work orders per ticket, duplicate-customer merge,
  QuickBooks Online, ShipStation, PADI cert lookup inside the POS, and student progress tracking
  and certification processing as a *future* feature.
- Fewer taps on mobile for guest counts (FareHarbor reviewers, 2026).

### Why shops switch, and what stops them

- **Triggers:** support silence (Rezdy → FareHarbor + Bookeo); price shock after a forced plan
  migration; vendor stagnation or death (Dive Shop Express, DiveCenterHQ, Visible Divers);
  outgrowing Sheets + Shopify; the incumbent being acquired (DiveShop360 + EVE, July 2023).
- **Blockers:** no one migrates purchase and service history; the EVE licence is revocable if you
  leave PADI; staff retraining under high turnover; offboarding traps (billed after cancelling,
  booking widget pulled from the website); sunk cost ("$25K at least" for a Dynamics-class
  system). A dive-business consultant's standing advice is the **split stack**: a proper retail POS
  plus a separate roster/booking tool, rather than one dive suite.

### 2025–2026 trends

- **PADI Adventures as a low-commission marketplace plus Google distribution.** 4.9% service charge
  on the widget, 5% referral commission, Klook distribution, Google Things To Do, review display, a
  Courses Locator; PADI's own data says a generous cancellation policy and instant confirmation
  lift conversion and 52% of DSD participants book on impulse
  ([FAQ](https://pros-blog.padi.com/top-faqs-about-padi-adventures/),
  [2025 review](https://pros-blog.padi.com/padi-adventures-2025-year-in-review/),
  [July 2026](https://pros-blog.padi.com/grow-your-dive-business-through-padis-digital-ecosystem/)).
  No independent operator pushback was reachable; "marketplace pressure" is PADI's framing.
- **OTA commission squeeze.** GetYourGuide notified some operators in June 2025 of rises past 30%
  with a month's notice mid-season; Viator ~20% vs GYG 25–30%, payouts 30–50 days
  ([Arival](https://arival.travel/article/getyourguide-commission-increasing-for-some-operators/),
  [automate.travel](https://automate.travel/blog/viator-vs-getyourguide-for-operators/)). OTA ↔
  booking-engine sync is a named source of overbookings.
- **Dynamic pricing is still rare** (~70% of tour operators price statically, ~7% dynamically);
  no dive-specific evidence.
- **Cancellation windows tightened post-Covid** (20% of US operators dropped the window, 45%
  shortened it).
- **AI is mostly about discoverability**, plus one WhatsApp front desk: DEMA 2025 ran "AI for Ocean
  Businesses"; The Scuba News (June 2026) on AI search reshaping how divers find operators;
  DiveOps.ai sells a Claude-powered multilingual 24/7 WhatsApp assistant tied to a back office
  ([vendor](https://diveops.ai/best-dive-centre-management-software)).
- **WhatsApp-first ops.** Every 2025–26 vendor comparison treats WhatsApp threads as the incumbent
  "system"; reminders "via email, WhatsApp or SMS" are now table stakes in vendor lists.
- **E-learning / agency sync** remains DiveShop360 + EVE only (PADI eLearning code auto-assignment,
  TDI/SDI integration); student-progress tracking was still "planned" there as of Feb 2024.
- **Consolidation:** Rezdy + Checkfront + Regiondo; DiveShop360 + EVE — and the reviews show forced
  plan migrations and redesigns are where churn starts.

### The fifteen most-mentioned wants and pains

| # | Want / pain | Distinct sources |
| --- | --- | --- |
| 1 | Integrations that actually work — accounting, email marketing, web store, OTA sync, waiver ↔ booking | 9 |
| 2 | Support that answers | 9 |
| 3 | Spreadsheet / WhatsApp / paper operations that no longer scale | 8 |
| 4 | Fee transparency and lock-in — per-booking fees, hidden API fees, billing after cancel, forced migrations, agency-revocable licences | 8 |
| 5 | No-shows, deposits, weather cancellations and refunds | 7 |
| 6 | Usability, learning curve, too many taps | 7 |
| 7 | Rental gear service clocks, work orders, tank-fill / air cards | 7 |
| 8 | Agency (PADI) integration — cert lookup, eLearning codes, student progress | 7 |
| 9 | Waivers — digital, pre-arrival, group, kiosk, offline | 6 |
| 10 | Data migration, export, history retention | 5 |
| 11 | Cloud, cross-platform, mobile access | 5 |
| 12 | Live availability and overbooking prevention (including OTA-caused) | 5 |
| 13 | OTA commissions and channel dependence | 5 |
| 14 | Staff pay, tips, commission splits, instructor scheduling | 5 |
| 15 | Reporting and analytics | 5 |

Below the cut with thin or vendor-only evidence: multi-language / after-hours WhatsApp AI, dynamic
pricing, group and club bookings, boat maintenance (nothing found), insurance beyond service
records (nothing found), seasonal staffing.

**The signal, in one sentence:** a decade of ScubaBoard threads say the same four things — support
that answers, a UI seasonal staff can learn, integrations that don't break, and a way out — plus
charter operators explaining why deposits and no-show policies exist; everything about WhatsApp,
AI, languages and marketplace pressure in 2025–26 comes from vendors and PADI, not from owners.

## The gap catalog

Every feature the market has that DiveDay lacks, sorted by what to do about it. "Already
tracked" links the existing home; "filed" is a new `needs-triage` issue from this review;
"declined" names the rule that declines it.

### Filed from this review

| Gap | Evidence | Issue |
| --- | --- | --- |
| **Prepaid air-fill cards** as package-style entitlements | Most-requested DiveShop360 summit feature; EnComPOS punch-card replacement; a Florida shop asking ScubaBoard; a Tasmanian shop that built its own; 4 of 32 products; absent from every newcomer | [#1234](https://github.com/AaronBuxbaum/diveday/issues/1234) |
| **Instructor self-service**: pros request the classes they can teach, blackout dates, one-click approval | DiveCrewPro's whole product; instructor scheduling and pay a top-15 pain (5 sources); "too many instructors … dilutes the students" | [#1235](https://github.com/AaronBuxbaum/diveday/issues/1235) |
| **QR self-registration before a booking exists** (person + waiver + medical + sizes) | 12 of 32; ScubaHub's 0% → 90–95% pre-arrival onboarding and 5-minute → 1-minute check-in; DiversDesk, DiverDash, ScubaCloud all sell it | [#1236](https://github.com/AaronBuxbaum/diveday/issues/1236) |
| **Hotel / agent rate cards** — an owner question, not a build | 11 of 32 carry an agent portal; resort-market plumbing every US tool skips; whether Florida shops need it is a first-call question | [#1237](https://github.com/AaronBuxbaum/diveday/issues/1237) |
| **PADI Adventures as a coexist channel guide** | 4.9% widget, 5% referral, Google Things To Do, Klook; PADI says online reaches 42% of bookings by 2029; **gate not met — no self-serve export documented (2026-09-02), so the row shipped and the page did not** | [#1238](https://github.com/AaronBuxbaum/diveday/issues/1238) |
| **The agency rail as a partnership question** | Cert sync in 4 of 32, all incumbents; the one thing EVE is praised for; DiveShop360 gates it to Core as the reason to buy up; 7 sources in the wants table | [#1239](https://github.com/AaronBuxbaum/diveday/issues/1239) |
| **Merge two person records** | DiveShop360 built duplicate merge on request; "no one migrates purchase and service histories" is the loudest switching complaint; email matching leaves phone-only walk-ins and typo'd imports as second people | [#1240](https://github.com/AaronBuxbaum/diveday/issues/1240) |

### Already tracked — do not refile

| Gap the market shows | Where it lives |
| --- | --- |
| Read API + webhooks (DiveAdmin's MCP/OAuth flag; Smartwaiver-grade reads) | [roadmap §1](../features/roadmap.md#1-data-portability-follow-ons-the-wedge) |
| Gift cards (2 verified; generic engines likely) | [roadmap, unscheduled](../features/roadmap.md#gift-cards) |
| Private / buyout charters and a boat entity (12 of 32 multi-boat) | [roadmap §4](../features/roadmap.md#4-multi-boat--multi-shop-configuration) and the boat-resource ADR |
| Snorkellers and riders (Checkfront-style participant types) | [participant-types.md](../features/participant-types.md) |
| Nitrox fill / analysis log, compressor logs (DiveOne) | [roadmap §3](../features/roadmap.md#3-nitrox-fill--analysis-log-open-question), H-11 |
| No-show frees the seat; morning Go / Watching call; seasonal price windows; counted share links; load-out checklist templates; tips by crew; refresher counsel; outbound Google review door | [roadmap §11](../features/roadmap.md#11-product-ideas-from-the-sweep-each-needs-an-owners-nod), triaged in #1079 |
| Credit ledger, buddy referral credit, course cohorts, group pay-your-own-share, alternative-day salvage, cohort/retention view, thermal receipt print | [brainstorm.md](../features/brainstorm.md) |
| Cert-card OCR, natural-language ops assistant, diver Q&A (the "AI agent" wave: DiveOne, Anolla, EquipDash, MOLA, DiveOps.ai, DiveAdmin's Coral, ScubaHub's daily brief) | [ai-ml.md](../features/ai-ml.md) — DiveDay's Today queue already is the "daily brief"; the guardrail stands |
| Guardian co-signature on a minor's waiver (AbyssOS, EquipDash) | H-21: solo signature accepted as-is, returns with H-01–H-03 |
| Birthday cues, welcome cues, rusty-diver re-entry, weather-disappointment recovery, service-recovery inbox (ScubaHub's birthday alert; FareHarbor's rebooking) | Delight backlog #1160 (D18, D22, D37, D46) |
| Course minimum-age enforcement | [story-backlog.md](../features/story-backlog.md) |
| Third-party e-signature adapter | [roadmap §2](../features/roadmap.md#2-third-party-e-signature-adapter-m3-follow-up) |
| Multi-currency on one order; per-trip ratings; review replies; fixed-amount discounts | the ADR consequences listed under [smaller follow-ons](../features/roadmap.md#smaller-follow-ons-live-with-their-adrs) |
| Native iOS/Android app (14 of 32 claim a mobile app; none of the newcomers actually has one) | ADR 20260804-ios-native-shell: PWA, with a measured trigger |

### Declined, and the rule that declines it

- **Retail POS, barcode inventory, vendor catalogs, e-commerce webshop** — DiveShop360's
  fortress and DiveDay's stated non-goal ([vision.md](../vision.md#non-goals-for-now)). The
  consultant advice on ScubaBoard is the split stack: a real POS plus a separate dive-day tool,
  which is the coexist story DiveDay already tells.
- **Customer repair work orders** — retail-service territory, declined 2026-08-15 after a direct
  inquiry ([competitive-analysis.md](competitive-analysis.md#what-blocks-the-purchase)).
- **Staff payroll, commissions and payslips** (6 of 32; AbyssOS's five pay models, Geek Divers'
  "hundreds of ways") — declined in the same list; tips by crew as display arithmetic is the
  bounded version in roadmap §11.
- **OTA channel management** (Viator, GetYourGuide) — the coexist guides are the answer; the
  reviews say OTA ↔ booking-engine sync is a *source* of overbookings, and GetYourGuide raised some
  commissions past 30% mid-season in 2025.
- **Liveaboard cabins, accommodation, hotel PMS, transfers on a map** — a different business;
  DiveAdmin's and DiversDesk's resort tilt is not the Florida cohort.
- **Double-entry accounting** (DiverDash, ScubaCloud, AbyssOS) — QuickBooks Online is the
  connector; DiveDay does not become the ledger.
- **Dynamic pricing beyond the last-minute rule table** — rejected in `ai-ml.md`; only 7% of tour
  operators price dynamically, no dive evidence.
- **Marine-park fees, live DAN/DiveAssure verification** — nobody has them either; the first has
  no Florida case, the second has no API.
- **A "trip cannot depart until every diver is accounted for" lock** (EquipDash) — DiveDay's
  pre-departure check and roll call *inform, never gate* by ADR; the missing-diver escalation is
  the honest version.

### Noticed, not filed — thin evidence

Recorded so the next review does not re-derive them. Each has one product or no owner voice
behind it.

- **Tide data** on the marine outlook (Divery's ESA feed, DivePlanner Pro's Go/No-Go). Open-Meteo
  has no tide endpoint; NOAA CO-OPS is free and Florida-relevant. Pairs naturally with the
  morning conditions call in roadmap §11.
- **Gear damage deposits as a Stripe pre-authorisation** released after return (EquipDash,
  $150–500). One product, no owner ask.
- **A structured incident record** distinct from the departure log (Scuba Manager). The log is
  "facts, not judgments"; a form would be a safety-critical surface with a legal review first.
- **Xero** beside QuickBooks Online (one UK owner ask; Dive Centre HQ had it). The Florida cohort
  is QuickBooks country; the connector registry makes it cheap later.
- **Receipt-upload payments for bank-transfer markets** (ScubaHub's validation queue). Staff
  already mark a payment received; the upload is a resort-market shape.
- **A unified inbound WhatsApp/SMS inbox** with enquiry-to-lead conversion (DiveAdmin). DiveDay's
  channels are outbound with delivery receipts; the inbound half is the D46 service-recovery
  inbox if it is anything.
- **Exception queues as the home page** (ScubaHub). Today is already this; the note is that
  "arrival with no booking" and "payment awaiting validation" are two queues it does not have,
  and the first is what #1236 creates the need for.

## Questions this leaves for the owner

Not issues — they belong to rows a human already owns.

1. **Pricing against the 2026 cohort** (H-12, H-26). The flat-fee peer group now runs $19–$119
   with two activity-bounded free tiers. $99 with everything included still reads well against
   the incumbents' real cost; whether it reads well against DivePrep's "free forever for small
   shops" is a founding-cohort conversation.
2. **Proof** (V-02). The only case study in the peer group with numbers — ScubaHub's Drop Dive
   Maldives — is vendor-written and is still the most-cited evidence in this segment because
   nothing else exists. One founding shop's before/after would be the same for DiveDay.
3. **The agency rail** (#1239 restates H-10 as a partnership question).
4. **Whether resort-market plumbing is ever in scope** (#1237).

## Method and its limits

Four parallel research passes: the two incumbents; the three named newcomers; the wider field of
32 products, defunct names and marketplaces; and owner sentiment. Reddit is blocked to the
research environment and Facebook, LinkedIn, Crunchbase, PRWeb, DiveNewswire, DeeperBlue, G2 and
Arival returned 403 or login walls — so **the social-media half of the brief is answered from
ScubaBoard, review platforms and trade press, not from Reddit or Facebook groups**, and the
2025–26 "trends" are vendor and PADI framing rather than owner testimony. Several vendor sites
block fetches (DivePlanner Pro, DiveStreams, Checkfront, Rezdy, FareHarbor, Divebooker), so their
rows lean on snippets and third-party pages. AI-generated listicles (gitnux, wifitalents, zipdo)
were used only to find names, never as evidence; several names in the brief and in those lists
(Dive Centre HQ, DiveManager, ScubaDesk, Ocean Blue, RentMy, ZenDive, Scubacore) are defunct or
do not exist. Pricing figures are dated 2026-09-01 and should be re-fetched from the vendor's own
page before any of them is quoted publicly ([marketing.md](../marketing.md)'s claims policy).
