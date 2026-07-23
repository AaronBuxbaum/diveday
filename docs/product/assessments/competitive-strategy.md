# Competitive strategy — beating DiveAdmin and DiveShop360

> The battle plan against the two most dangerous named rivals, and the data-portability wedge that
> makes "try us" a safe decision. Written 2026-07-22 from three deep research passes (vendor sites
> and API docs, review platforms, ScubaBoard, migration-industry and regulatory sources), checked
> against the running codebase. Companion to [competitive-analysis.md](competitive-analysis.md)
> (the buyer's whole-market view); this document is the operator's view of two specific fights.
> An assessment, not a commitment; items that survive review move to [roadmap.md](../roadmap.md).

## The two rivals, verified

### DiveAdmin — fast, cheap, loud, and tiny

A portfolio product of AWcode, a Thailand-based agency/startup studio; three named staff; launched
~2023–2024 ([about](https://diveadmin.com/en/about)). Priced at $39/$59/$119 per month with a
$3,495 lifetime tier — a classic small-vendor cash-flow move. What the research verified:

- **Zero independent reviews anywhere.** Capterra listing exists with 0 reviews
  ([capterra](https://www.capterra.com/p/10042096/Dive-Admin/)); no G2/Trustpilot presence; the only
  ScubaBoard mention is the founder promoting his own product. Their WordPress plugin has <10
  active installs. Claimed "143+ dive centers" is vendor-stated only. **There is no reputation moat
  to overcome — but also no failure stories to point at.**
- **The AI/open flag is rhetorically strong, practically shallow.** OAuth 2.1 + MCP server +
  `llms.txt` is genuinely shipped and ahead of the niche
  ([api docs](https://diveadmin.com/en/api-documentation)) — but the *documented* REST surface is
  lead-ingestion-shaped (data flows **in**): no bulk read/export endpoints, no webhooks, no
  documented full-account export, and the data policy is silent on what happens after cancellation
  ([data policy](https://diveadmin.com/data-policy)). They do market **automated backups to the
  shop's own Google Drive** — the one portability lever we must at least match.
- **Ops depth is thin where we are deep.** Manifests are "printable boat lists"; offline is
  admitted-weak ("unstable internet connections will break the workflow",
  [their own vs-EVE page](https://diveadmin.com/resources/dive-admin-vs-eve/)); no PADI sync
  (mySSI listed); no QuickBooks/Xero; they concede retail/inventory depth to EVE.
- **They ship and market fast** (~2 blog posts/week, MCP/OAuth shipped, 15 languages). Expect any
  talking point we adopt to be matched in copy within months — which is why the wedge must be
  *substantive* (working exporters, documented schemas), not a pledge page.

### DiveShop360 — the PE-owned POS incumbent

The vertical dive brand of Rain Retail Software, owned by Quilt Software (PSG private equity);
acquired **EVE** — PADI's long-endorsed desktop CRM — in July 2023
([divernet](https://divernet.com/scuba-news/dive-shop-360-acquires-eve-diving/)). Startup tier
$149–199/mo plus setup fees ($1,000–3,000 by tier); Core/Plus quote-only. What the research
verified:

- **Retail POS is the fortress; don't attack it.** Cloud POS, ~100 preloaded vendor catalogs,
  integrated payments, repair tickets, rentals. This is their DNA (Rain is a specialty-retail POS
  roll-up) and our explicit non-goal.
- **The agency rail is their moat.** PADI eLearning-code and cert management (marketed as
  exclusive), SSI, SDI/TDI/ERDI/PFI — but **gated to the mid (Core) tier**: a shop must buy up to
  get cert integration and waivers ([pricing](https://diveshop360.com/pricing),
  [integrations](https://diveshop360.com/integrations)).
- **Waivers are outsourced** (Smartwaiver integration, also Core-gated) — ours are native,
  versioned, and in every tier.
- **No API, no webhooks, no developer docs — at all.** Export is manual per-dataset CSV from the
  UI, and their FAQ names only four exportable classes: customers, inventory, sales reports,
  certification data ([faq](https://diveshop360.com/faq)). Trip/manifest history, rentals, repair
  tickets, and the e-commerce site are not named — the lock-in is soft-contractual
  (month-to-month, "export before you cancel") but **hard-technical**.
- **The EVE install base is the freshest switching pool in the market.** EVE users were already
  unhappy ("crappy UI," "kludge," near-nonexistent support — ScubaBoard), face a migration
  regardless, and ScubaBoard reports "no one seems to be able to migrate customer purchase and
  service histories" out of EVE
  ([thread](https://scubaboard.com/community/threads/dive-shop-software.532088/page-2)). A shop
  forced to migrate anyway will consider more than one destination.
- **Known soft spots:** e-commerce quality and slow feature delivery are the recurring Rain POS
  review complaints (Capterra 4.2); pricing is opaque with setup fees; support hours limited.

## Head-to-head: where each deal is won or lost

| Axis | vs DiveAdmin | vs DiveShop360 |
| --- | --- | --- |
| Price | They undercut ($39–119). We cannot win a price war against a 3-person studio; win on substance and make pricing honest (see [competitive-analysis.md](competitive-analysis.md#pricing-posture)) | We undercut their real all-in cost (setup fees + Core-tier gating + processing quotes). "No setup fee, everything in every tier" lands hard here |
| Boat-day ops | **We win now.** Their manifest is a printable list; ours is roll-call checkpoints, append-only history, offline snapshots | **We win now.** Their "Manifest 2.0" is booking admin, not on-boat safety ops |
| Safety spine | **We win.** No fail-closed readiness anywhere in their product | Same — certs are records to sync, not a typed boarding gate |
| Waivers | Comparable on paper (both native e-sign); ours are versioned/immutable and free-tier | **We win.** Theirs is a third-party add-on behind the mid tier |
| Retail POS | Neither has it; they concede it too | **They win. Concede it loudly** — "bring your POS, we run the water" |
| Agency rail (PADI) | Neither has PADI sync — shared open flank | **They win** and it is partnership-gated; do not promise to match. Counter: import what the shop can download, verify SSI programmatically (open [diver check](https://my.divessi.com/online_diver_check)) |
| AI/open story | They hold the flag (MCP, OAuth) but the API only ingests | Nothing at all. Any API we ship beats theirs by existing |
| Portability | **Open flank**: no bulk export, no webhooks, silent on cancellation. Must match their Google Drive backup | **Open flank**: manual CSV of 4 datasets, no API. Their own FAQ scopes the wedge for us |
| Trust/track record | Dead heat — both young, both reviewless. Substance (working demo, published schemas) breaks the tie | They win on longevity claims; counter is PE-roll-up risk (EVE users lived one acquisition already) — and that argument only works if *our* exit door is provably open |

## The portability wedge

The hypothesis — *if shops don't feel locked in, trying us is a safe decision* — survives research,
with one sharpening: **no vertical-SaaS winner won on portability alone.** Jane (clinics), Fresha
(salons), ServiceTitan (trades), and Shopify all bundle easy switching with a price or UX edge;
portability removes the *barrier*, the daily loop wins the *deal*. Our Today queue, fail-closed
readiness, and no-login diver arc are the product edge; portability is how a skeptical owner lets
themselves feel it.

The strongest documented template is **Jane** ([jane.app/switch](https://jane.app/switch)): free
concierge import in every subscription, **named per-competitor migration guides** stating exactly
what imports fully / partially / never, and — the masterstroke — a published
**"[Importing from Jane](https://jane.app/guide/importing-from-jane)"** guide: how to *leave*.
The anti-model is Mindbody: ~$500 full-export fee, 30-day post-cancellation retrieval window, and
an entire ecosystem of competitors SEO-farming "how to get your data out of Mindbody."

Regulatory tailwind: the **EU Data Act** (applies from Sept 2025) mandates SaaS switching support
and bans switching fees entirely from Jan 2027
([overview](https://www.garrigues.com/en_GB/garrigues-digital/data-act-and-cloud-switching-keys-new-rules-changing-cloud-service-providers)).
Adopting Data-Act-grade portability *globally* turns compliance into positioning, and DiveAdmin's
UK/EU base means they must spend effort here anyway.

**Legal guardrail (hard):** migrate from files the shop exports itself. Never log into a
competitor's system with the shop's credentials or automate against it — *Facebook v. Power
Ventures* made credentialed extraction a CFAA violation once the platform objects
([EFF](https://www.eff.org/cases/facebook-v-power-ventures)). Stop immediately on any
cease-and-desist.

### Where we start from

At the time of writing: zero — no CSV import, no export, no ICS, no API of any kind.
[competitive-analysis.md](competitive-analysis.md) already flags "Open API / easy export" as the
watch item. As of 2026-07-22 the export (#1 below) has shipped; the rest is greenfield.

### The build plan, in order

Ordered by leverage per effort; imports touch certs and medical state, so the importer is a
**safety-critical surface** (boring code, adversarial tests, `dive-domain-expert` review).

1. ✅ **Full-shop export, self-serve, every tier** — **shipped 2026-07-22, completeness pass
   2026-07-23** ([ADR](../../architecture/decisions/20260722-full-shop-export.md)): Settings → Data
   export downloads one ZIP of documented RFC-4180 CSVs (people + roles, all three certification
   kinds, trips + dives + series, boarding gates, crew, bookings + payment state, wait lists,
   waiver templates with full versioned bodies, signed waiver records including medical evidence,
   the roll-call ledger, rental fit, orders + line items, and the shop's dive-site library and
   course catalog) plus a README manifest that also states what is *not* included. The bundle
   leads with **`contacts.csv`** — a flat one-row-per-person file (names pre-split, best card
   with verification status, nitrox flag, sizes) shaped for the generic customer-import wizard
   every rival ships, so "importable elsewhere" is a property of the file, not a promise.
   Signed-waiver "PDFs" turned out not to exist — waiver evidence is versioned template text +
   signature rows, and the bundle carries both. This is the "leave anytime" guarantee that makes
   every other claim credible; its CSV schemas are the contract the importer reuses. Note the
   honest limit: rivals' importers can't be tested from here, so the claim we make is "flat,
   documented, wizard-mappable CSV" — per-competitor import verification belongs to the migration
   guides (#3).
2. ✅ **Diver/customer CSV importer with a published honesty table** — **shipped 2026-07-23**
   ([ADR](../../architecture/decisions/20260723-contact-importer.md)): Settings → Import contacts,
   matched by email, with the scope table up front and the safety spine held (imported certs land
   *claimed*, never *verified*; medical answers never import).
   Column-mapped, previewed, validated import for the shop's people + cert + sizes data, with
   templates matching what the rivals actually emit (DiveShop360's customer/cert exports,
   DiveAdmin's CSVs, Smartwaiver participant CSVs, generic spreadsheet). Publish Jane-style scope
   tables: what imports fully / partially / never (card-on-file: never; incumbent repair/service
   history: never — say so plainly, it's the documented un-migratable residue everyone resents).
   **Imported certifications land as *claimed*, never *verified*** — the verified/claimed
   distinction we already model is exactly what makes a fast import honest instead of dangerous;
   staff verify at first contact, same as today. Medical flags import fail-closed.
3. **Migration guides as public pages** *(S, marketing)*. "Switching from DiveShop360," "…from
   EVE" (the forced-migration pool), "…from DiveAdmin," "…from Smartwaiver," "…from
   FareHarbor/Rezdy." Each: exact click-path to the incumbent's own export, our scope table, the
   importer. These double as SEO capture of "leaving <incumbent>" searches — the documented
   pattern across Jane, ServiceTitan, and the anti-Mindbody ecosystem. **Shipped 2026-07-23:** the
   `/switching` hub plus live guides for all four named incumbents — **EVE** (first), **DiveShop360**,
   **DiveAdmin**, and **Smartwaiver** — each with its export click-path, the scope table rendered
   from the importer's own `IMPORT_HONESTY_TABLE`, and the import walkthrough. A FareHarbor/Rezdy
   guide is a future addition — not yet built, and (per the marketing claims policy) not shown until
   it is. See [marketing.md](../marketing.md#migration-guides).
4. **Scheduled backup export to shop-owned storage** *(S–M)*. Weekly bundle from #1 to the shop's
   email/Drive. Matches DiveAdmin's one real portability lever and converts "your data is yours"
   from pledge to running fact. Calendar (.ics) feeds for trips ride along cheaply here.
5. **Read API + webhooks, every tier** *(M — ADR required)*. Smartwaiver-grade: token-scoped read
   endpoints over the same documented schema as #1, webhooks for booking/waiver/manifest events.
   This out-substances DiveAdmin's ingestion-only API and gives DiveShop360 nothing to answer
   with. An MCP layer can follow — after the boring REST surface exists, not before.
6. **Agency-rail pragmatism** *(S each, ongoing)*. SSI verification via the open diver check;
   PADI = import whatever cert-history file the shop can download from PADI Pros (treat a real
   PADI partnership as a separate strategic conversation, not a build item). UDDF export of course
   dives later as an open-standards credibility garnish — delight, not a rail.

### What this is worth in the two fights

- **vs DiveShop360:** the EVE pool must migrate anyway; a published "Switching from EVE" guide +
  honest importer is a direct funnel into the market's most motivated buyers, and "manual CSV of
  four datasets, no API" is a contrast we can state factually from their own FAQ.
- **vs DiveAdmin:** they own the *rhetoric* of openness; shipping working export + webhooks takes
  the flag on substance. Expect them to respond in marketing quickly — which is fine, because the
  battleground moves to demonstrable artifacts (schema docs, guides, a button that works in the
  demo shop) where a 3-person studio must spend real engineering time to follow.
- **For blocker #6 (trust):** "new + unproven" is our biggest objection
  ([competitive-analysis.md](competitive-analysis.md#what-blocks-the-purchase)); a provably open
  exit door is the cheapest counter available and also the precondition for honestly wielding the
  PE-roll-up risk argument against DiveShop360.

## What NOT to do

- Don't fight DiveShop360 on POS/retail/vendor catalogs, or DiveAdmin on price or language count.
- Don't promise PADI sync we can't deliver; the rail is partnership-gated and DS360 markets it as
  exclusive.
- Don't automate logins or scraping against incumbent systems — files the shop exports itself,
  only (*Power Ventures*).
- Don't ship a pledge page before the export button works; DiveAdmin proves rhetoric is cheap.
- Don't let imported data bypass the safety spine — no imported cert is ever born verified.

## Implications for the queue

1. Slot **full-shop export (#1)** and the **importer + honesty tables (#2)** into the next P1
   band — together they are the "easy data export (attack lock-in fear head-on)" counter that
   [competitive-analysis.md](competitive-analysis.md) already prescribes for blocker #6, now
   specced.
2. Migration guides (#3) belong to the marketing surface ([marketing.md](../marketing.md)); they
   shipped as a `/switching` hub with "Switching from EVE" first (`/switching/eve`) — the live-now pool —
   followed by live guides for DiveShop360, DiveAdmin, and Smartwaiver. A FareHarbor/Rezdy guide is
   a future addition, unbuilt for now.
3. Backup export (#4) and the read API + webhooks (#5) are P2; the API needs an ADR.
4. The pricing decision ([competitive-analysis.md](competitive-analysis.md#pricing-posture))
   gains a datum: both named rivals confirm the specialist ceiling ($119 DiveAdmin, $149–199+setup
   DS360 entry). The wedge strengthens the meet-the-market posture — "no lock-in" and "no
   add-ons" are one story about respecting the shop.
5. Re-check this document when either rival ships: DiveAdmin webhooks/bulk export, or any
   DiveShop360 API. Both would be direct responses.
