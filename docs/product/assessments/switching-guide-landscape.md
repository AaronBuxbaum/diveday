# Switching-guide landscape — who else gets a guide

> A survey of the software a dive shop might leave (or run DiveDay alongside), and which ones earn a
> switching guide next. Written 2026-07-24 from a multi-source research sweep (vendor sites, help
> centres, API docs, review platforms, ScubaBoard), checked against the shipping gate below.
> Companion to [competitive-strategy.md](competitive-strategy.md) and
> [fareharbor-positioning.md](fareharbor-positioning.md). An assessment, not a commitment — a guide
> ships only when its export path is verified.

## The shipping gate (don't skip this)

A guide is a live page the moment it's in `MIGRATION_GUIDES`, so it may only be added once **the
incumbent's own export produces a customer/booking file the shop downloads itself** — no credentialed
extraction (*Power Ventures*), no "coming soon" shells (claims policy). That makes the **export path
the binding constraint**, not the incumbent's popularity. Every row below carries an export-path
verdict:

- **Verified** — a documented self-serve CSV/report export (help-doc or API cited). Guide can ship.
- **Documented-thin** — export is claimed on the vendor's pages but no step-by-step doc was
  isolated. Confirm one live help-doc before shipping.
- **Unverified / closed** — no export path found, or the only "export" is an accounting sync
  (e.g. QuickBooks) or a shutdown-era "back up your data" notice. Do not build until confirmed.

## Two shapes of guide

- **Coexist (booking channels)** — general tours-and-activities booking/checkout/distribution
  engines a shop can *keep* for its reach while running the dive day in DiveDay. These get the
  `coexist` block (see [fareharbor-positioning.md](fareharbor-positioning.md)). Shipped: FareHarbor,
  Rezdy.
- **Leave-it (records systems)** — dive-specific or POS systems that hold the shop's people/certs;
  the play is to help the shop move off. Shipped: EVE, DiveShop360, Smartwaiver. (A DiveAdmin
  guide shipped 2026-07-23 and was retired 2026-08-05 — too little market share to earn the page.)

## Category A — booking channels (coexist-capable)

| Service | Model | Dive adoption | Export path | Verdict |
| --- | --- | --- | --- | --- |
| **Rezdy** | Monthly sub + ~3%/booking | Real (course/tour bookings) | **Verified** — Sales/Orders report + Data export CSV, operator API ([help](https://support.rezdy.com/hc/en-us/articles/203690794-How-To-Use-the-Sales-Orders-Report), [API](https://developers.rezdy.com/)) | **Shipped 2026-07-24** |
| **WeTravel** | Free software + per-transaction fee | **Strong — dive product page + named shops** (Blue Planet Scuba, Dolphin Scuba) | **Verified** — Customers list CSV export + APIs ([help](https://help.wetravel.com/en/articles/4591991-what-is-possible-with-the-customers-list)) | **Build next (top A pick)** |
| **Rezgo** | No sub, 4.9% web / 0.9% agent | **Strong — dedicated dive vertical pages** | **Verified** — any report → Excel/CSV, scheduled exports ([help](https://support.rezgo.com/kb/create-transaction-report/)) | **Build next** |
| **Bókun** (Tripadvisor/Viator) | Low sub + ~1–1.5% (0% via Viator) | Generic (dive via Viator) | **Verified** — sales-feed spreadsheet + customer export + REST API ([docs](https://docs.bokun.io/docs/bookings/sales-feed/how-to-export-the-sales-feed-to-a-spreadsheet)) | **Build next — OTA-distribution hook** |
| **TrekkSoft** | Sub + per-booking + payment fees | Dated (Diviac partnership, 2015) | **Verified** — Guest Manifest → CSV, reports → Excel ([help](https://support.trekksoft.com/view-your-guests-manifest-to-manage-bookings)) | **Second tier** — active but shrinking; dive evidence old |
| **Peek Pro** | Per-booking fee, marketplace | High (watersports/dive tours) | **Documented-thin** — dashboard CSV + API (prior), no doc isolated | **Second tier — verify export, then a strong FareHarbor twin** |
| **Checkfront** | Subscription (flat tiers) | Medium-high (rentals/watersports) | **Documented-thin** — booking/customer CSV + REST API (historically) | **Second tier — Rezdy's sibling** (same parent group); likely shares mechanics, cheap cluster build after verification |
| **Bookeo** | Pure subscription, **no booking fee** | Medium-high (dive *courses*/schools) | **Documented-thin** — customer CSV + API claimed | **Second tier — fresh "no booking fee" contrast** |
| **Xola** | Hybrid sub + per-booking | Medium | **Unverified** | Hold — verify export |
| **Regiondo** | Sub + ticket fee | EU only | **Verified** (CSV/Excel + Pro API) | Low priority — EU-only, no dive evidence |
| **Ventrata** | Enterprise (~€833+/mo + fees) | None found | Verified but N/A | **Not worth it** — segment/price mismatch |
| **TicketingHub** | Flat 3%, no sub | Thin marketing page only | Documented-thin | **Not worth it now** |
| Arttrail, FreshTrip | — | — | Unverifiable | Could not confirm these exist |

## Category B — dive-specific records systems (leave-it)

The dive-native field is many small vendors whose **export path is the whole question** — and most
don't document one. Higher confidence than Category A on "is it dive software," far lower on "can a
shop get its data out."

| Service | Dive adoption | Export path | Verdict |
| --- | --- | --- | --- |
| **Bloowatch** (EU) | Real EU dive/watersports | **Verified** — customers → EXPORT CSV, one citable help-doc ([help](https://help.bloowatch.com/en/articles/2111455-en-export-a-list-of-bookings-customers)) | **Best B pick — the only one with a citable export doc** |
| **DiverDash** | Newer entrant | **Verified (paid tiers)** — CSV import + CSV/PDF export ([pricing](https://www.diverdash.com/pricing)) | **Worth a guide** — confirm certs vs invoices only |
| **DiversDesk** (EU) | Markets to dive centers | Documented-thin — CSV claimed in marketing | Worth it — verify field coverage (esp. certs) first |
| **Diverse / EncomPos** (US) | **Real US dive POS adoption** | **Unverified / closed** — only a one-way QuickBooks sync | Worth it *if honest* — guide must say "request a data extract from support," not promise self-serve |
| **DIVE Manager** (divemanager.it) | Early-stage, EU | Unverified — no export found | Low priority — watch |
| Divereport, DivePlannerPro, AquaDivePro, Custom Aquatics, Diving.Management | Vendor-side only | Unverified | Hold — export unproven |
| Scubawhere, Deepblu, DiveShopHQ, RevoBooking, DiveCentreHQ, Trainingu, Regnavi | Dead domain / winding down / unverifiable | None found | **Drop** — defunct or phantom names |

**Import-source (not guide) targets:** Visible Divers and DiveCentreHQ come up as *dead/legacy*
systems shops are actively fleeing — worth recognizing in the importer's column aliases, not worth a
marketing page.

## Agencies are not switching targets (PADI / SSI)

PADI (Pros site / Student Management Portal / PIC Online) and SSI (MySSI / SSI Digital Platform) are
**agency rails, not competitors you leave** — a shop doesn't switch off PADI. Both are import-friendly
and **export-hostile**: SSI states cert records are held on its servers; PADI only lets cert data out
through its endorsed-partner (EVE) download pipe. This is exactly the **agency-rail pragmatism** the
strategy doc already books as build item #6 (import a PADI Pros cert file; verify SSI via the open
[diver check](https://my.divessi.com/online_diver_check)) — an importer feature and a glossary of
column aliases, **not** a `/switching/*` page. Cert history is the stickiest, most agency-locked asset;
any migration copy must set the expectation that certs are re-verified via the agency, never bulk
exported.

## Recommended roadmap (beyond Rezdy)

Ranked by dive adoption × switching-search intent × export-path confidence × differentiation:

1. **WeTravel** *(coexist)* — verified export **and** named dive-shop customers; the clearest next build.
2. **Rezgo** *(coexist)* — verified export, dedicated dive vertical, a distinct no-subscription model.
3. **Bókun** *(coexist)* — verified export; the "keep it for Viator/GetYourGuide reach" hook is unique.
4. **Bloowatch** *(leave-it)* — the only Category-B system with a citable export doc; opens the dive-native leave-it lane.
5. **Peek Pro** *(coexist)* — the closest structural twin to FareHarbor; **verify the export help-doc first**, then the page nearly writes itself.
6. **Checkfront + Bookeo** *(coexist)* — a cheap cluster: Checkfront shares Rezdy's corporate group (and likely its export mechanics), Bookeo adds the "no booking fee" angle. Verify each export doc first.

Everything below the line is either export-unverified (Xola, DiversDesk, DiverDash cert-coverage,
Diverse/EncomPos), wrong-segment (Ventrata, TicketingHub, Regiondo), or unverifiable/defunct. The
structural takeaway: **Category A yields 4–6 shippable coexist guides; Category B yields ~2 leave-it
guides plus agency-rail import notes** — so the next wave of switching SEO is mostly booking channels.

## Verification debts to clear before building each

- **WeTravel:** its scuba product page intermittently 404'd on fetch (indexed, named-shop subdomains
  resolve) — confirm live before quoting the dive page.
- **Peek Pro / Checkfront / Bookeo / Xola:** open one export help-doc each to confirm the exact
  click-path (the same honesty the shipped guides already apply to version-drifting menus).
- **Bloowatch / DiverDash / DiversDesk:** confirm the export includes **certification** fields, not
  just contacts/invoices, before promising what comes across.
- **Pricing is change-prone:** re-fetch any fee/tier figure at build time and cite the vendor's own
  page, dated — never a third-party pricing recap as the source of a number.
