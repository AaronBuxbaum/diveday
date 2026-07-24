# FareHarbor positioning — coexist, or compete

> How DiveDay wins the FareHarbor dive shop. Written 2026-07-24 from a sourced research pass
> (FareHarbor's own site, help centre, and provider terms; Booking Holdings' acquisition release;
> third-party pricing and distribution explainers), checked against the running codebase. A
> companion to [competitive-strategy.md](competitive-strategy.md) (the DiveAdmin/DiveShop360 fight)
> and the buyer's-eye [competitive-analysis.md](competitive-analysis.md). An assessment, not a
> commitment; the shipped surface it produced is the `/switching/fareharbor` guide.

## Why FareHarbor is a different fight

The four incumbents the migration guides already target — EVE, DiveShop360, DiveAdmin, Smartwaiver —
are **records systems**: the shop's people, cards, and history live inside them, and the play is to
help the shop *leave*. FareHarbor is not that. It is an **online booking-and-checkout engine plus a
distribution network** for tours and activities generally — owned by Booking Holdings (the
Booking.com parent) since 2018 — that a dive shop bolts a storefront onto. Its category is the
storefront, not the back office.

That single fact reshapes the fight:

- A FareHarbor shop has **already crossed the "I'll take online bookings and card payments" chasm.**
  They are software-comfortable — a far warmer lead than the spreadsheet pool.
- But FareHarbor **was never built for the boat.** It makes no claim to certification gating,
  fail-closed medical waivers, rental-gear fit, or a manifest built for a roll call — because a
  general booking engine has no concept of a C-card. Its "manifest" is a downloadable passenger
  list. So the guest books beautifully, and the part that keeps people safe on the water still runs
  on a clipboard.
- The honest answer to "compete or coexist" is therefore **both, and the shop's use of the
  distribution network decides which** — which is why the public guide is coexist-led with a clean
  leave path, not a straight leave-it migration.

## Verified facts (cite these; honour the flags)

| Fact | Source | Note |
| --- | --- | --- |
| All-in booking platform for tours/activities/rentals; online booking, checkout, payments, waivers-on-checkout, dashboard, distribution | [fareharbor.com](https://fareharbor.com/) | FareHarbor-stated. **General, not dive-specific.** |
| Owned by Booking Holdings; announced Apr 2018 | [Booking Holdings release](https://www.bookingholdings.com/press-releases/booking-holdings-announces-it-has-signed-an-agreement-to-acquire-fareharbor/) | Primary. (~$250M price is third-party/SEC-derived, not in the release.) |
| No monthly fee; a **per-booking fee added to the guest's checkout price** | [TrekkSoft guide](https://www.trekksoft.com/en/blog/fareharbor-pricing-guide-what-to-know-before-you-buy) | Third-party. The *model* is well documented. |
| Rate reported ~6% (6–8%) | third-party pricing explainers | **FareHarbor does not publish the rate — disclosed on a sales call.** Never state "6%" as their published price; say "reported at around 6%". |
| Operator is the merchant of record; payments run through **Adyen / Stripe / PayPal**; FareHarbor's booking fee is taken at the processor before payout | [Provider ToS](https://fareharbor.com/legal/tos-providers/) | **Do NOT claim FareHarbor holds the shop's money / is merchant of record — the opposite is true.** |
| Export path = Dashboard → Reports → **Contacts / Bookings / Sales / Manifest** report → download **CSV**; date-scoped, no one-click "everything" dump | [FareHarbor Help](https://help.fareharbor.com/hc/en-us/articles/40897898334619-How-do-I-download-a-manifest-or-report) | FareHarbor-stated. Contacts report is the customer-list route out. |
| API exists but is **partner-gated** (email support to request; built for resellers), not a self-serve operator export | [FareHarbor docs](https://github.com/FareHarbor/fareharbor-docs) | The Dashboard CSV is the real route out. |
| **FareHarbor Distribution Network** — lists inventory to hotels, concierges, OTAs, affiliates | [FHDN for operators](https://fareharbor.com/scale/distribution-network/operators/) | FareHarbor-stated. **A genuine strength and a real switching cost — concede it, don't dismiss it.** |
| Rezdy is the comparable channel competitor (monthly subscription + smaller booking fee) | [rezdy.com/pricing](https://rezdy.com/pricing/) | The other future channel guide; verify live tiers before publishing figures. |

Two things research **could not** verify, so no claim leans on them: whether the Contacts export
carries full historical PII or only a date-ranged subset (the guide assumes date-ranged and tells
the shop to widen the range), and any explicit contractual data-portability guarantee on exit (the
Provider ToS is silent).

## The positioning: coexist-led, leave-clean

Two honest paths, and the public guide (`/switching/fareharbor`) presents both, coexist first:

1. **Coexist — keep FareHarbor, add the dive day.** FareHarbor keeps the storefront and its
   distribution network; DiveDay runs the water side it can't: fail-closed readiness, certification
   gating, native versioned waivers with medical review, the offline roll-call manifest, rental fit
   and the trip's packing list, the night-before brief, and the recap. This is the product page's
   "bring your POS, we run the water" division of labor, extended to a booking channel.
   - **Honesty guardrail:** there is **no integration** between DiveDay and FareHarbor. The bridge is
     the CSV import — the shop re-imports as its roster grows. The guide says this plainly; never
     imply a live sync (marketing.md forbids claiming unconfigured integrations).
2. **Compete — leave the per-booking fee behind.** For a shop using FareHarbor as just a booking
   *button* (not its network), DiveDay already takes the booking itself — a public schedule anyone
   can book without an account, checkout through the shop's own Stripe account, native waivers — so
   the per-booking fee stops. This is the clean single-system path (no double-entry) and the
   standard switching-guide posture.

Both paths bring divers across the same way, so the guide reuses the shared export → honesty table →
import mechanics. FareHarbor holds contacts (and bookings/waivers), **not** certs or rental sizes,
so the import is contact-shaped, like Smartwaiver's.

## How to target this population

- **High-intent SEO**, the same wedge that's working: `/switching/fareharbor` captures "FareHarbor
  alternative / fees for dive shops" and "leaving FareHarbor" searches — motivated buyers, little
  competition. It auto-joins the `/switching` hub and the sitemap.
- **Lead with the live demo**, as every sales surface does — walk the dive day FareHarbor can't run.
- **Owner channels** (ScubaBoard, shop-owner groups) where the per-booking fee and the
  clipboard-behind-the-booking gap are already felt.

## What NOT to do

- **Don't claim an integration or sync with FareHarbor.** Coexistence is "run alongside, bridged by
  CSV," not a wire between the systems.
- **Don't state a hard fee rate as FareHarbor's published price.** It isn't published; "reported at
  around 6%" with a third-party citation is the honest phrasing.
- **Don't claim FareHarbor is the merchant of record or holds the shop's money** — the operator is,
  and payments run through Adyen/Stripe/PayPal. Its own ToS says so.
- **Don't disparage the distribution network.** It genuinely fills seats and is a real reason a shop
  keeps FareHarbor — concede it, and let coexist be the answer.
- **Don't over-promise replacement of the storefront's reach.** DiveDay has no distribution network
  and says so.

## Relationship to the roadmap

This closes the FareHarbor half of competitive-strategy.md build item #3 ("migration guides as
public pages … '…from FareHarbor/Rezdy'"), which had listed FareHarbor as a future, unbuilt guide.
Rezdy — the comparable channel with a monthly-plus-fee model — remains the open follow-on; when its
export path is verified it takes the same coexist-capable guide shape.
