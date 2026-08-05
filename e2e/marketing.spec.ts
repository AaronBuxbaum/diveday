import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

test("the homepage hero offers one demo door, and the diver preview lives on its moment card", async ({
  page,
}) => {
  await page.goto("/");

  // One site-wide name for the demo CTA — the hero used to say "Try the
  // staff app" (jargon a first-time visitor can't parse, and a different
  // label than every other page gave the same action). `.first()` targets
  // the hero; the closing band repeats the same label deliberately.
  await expect(page.getByRole("button", { name: "Try the live demo" }).first()).toBeVisible();
  // The click's cost is stated at the point of decision, scoped to the demo —
  // it must not promise "no sign-up" on behalf of the trial button beside it.
  await expect(
    page
      .getByText("The demo opens a working sample shop in one click — no sign-up, no card.")
      .first(),
  ).toBeVisible();
  // Exactly three demo buttons (hero, mid-page, closing) — the five-chip role
  // picker is gone from the hero; role switching is the in-demo switcher's job.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(3);
  // The old label is gone site-wide, not merely replaced here: one action
  // wearing two names is what the single-label rule exists to stop, and the
  // rename has to stay renamed (docs/product/marketing.md, Voice).
  await expect(page.getByRole("button", { name: "Try the staff app" })).toHaveCount(0);

  // Hero decision density: one primary action, at most one secondary. The hero
  // once offered ~9 (a five-chip role picker, the diver preview, demo, trial),
  // and every retired destination moved rather than disappeared — the roles
  // into the in-demo switcher, the preview onto its moment card below. The
  // mockup's "Mark boarded" buttons are `disabled` scenery, not doors, so the
  // count is of things a visitor can actually act on.
  const heroSection = page.getByRole("main").locator("section").first();
  await expect(heroSection.locator("button:not([disabled])")).toHaveCount(1);
  await expect(heroSection.getByRole("link")).toHaveCount(1);
  await expect(heroSection.getByRole("link")).toHaveAttribute("href", "/onboard?from=home-hero");

  // The diver preview moved out of the hero (where it was a third competing
  // door) onto the "For the diver" moment card, still tagged for attribution.
  const scheduleLink = page.getByRole("link", { name: "See a diver's booking page →" });
  const href = await scheduleLink.getAttribute("href");
  // Sourced from DEMO_SHOP_SLUG rather than a hand-typed literal, and tagged
  // for funnel attribution the same way the trial link is. The source moved to
  // the "For the diver" moment card when the hero's role picker was retired
  // (#328); the path is the split public namespace's.
  expect(href).toBe(`/s/${DEMO_SHOP_SLUG}?from=home-diver-moment`);

  await scheduleLink.click();
  await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
  // The diver-facing schedule, not a staff console — no sign-in chrome.
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("the homepage answers price and offers a way to ask before the footer", async ({ page }) => {
  await page.goto("/");

  // The flat price renders in the closing band (from src/lib/marketing.ts —
  // never a prose literal), so a buyer doesn't have to click through to learn
  // whether this is a $99 tool or an enterprise quote form.
  await expect(page.getByText(/One flat price/)).toBeVisible();
  await expect(page.getByRole("link", { name: "See what's included →" })).toHaveAttribute(
    "href",
    "/pricing",
  );

  // The contact band: a hesitant buyer who won't self-serve a demo or trial
  // gets a visible human path — not just an unlabeled address in the footer.
  await expect(page.getByRole("heading", { name: "Rather ask a question first?" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Email support@dive\.day/ })).toHaveAttribute(
    "href",
    "mailto:support@dive.day",
  );
});

test("public marketing pages lead to the product and pricing details", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Run the whole dive day, from booking to head count." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Product" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();

  // The portability story is a first-class band on the homepage, and it reads
  // in both directions — records arrive cleanly and leave the same way, which
  // is the reason to join, not a goodbye.
  await expect(
    page.getByRole("heading", { name: "Your records come in clean, and leave the same way." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Product" }).first().click();
  await expect(
    page.getByRole("heading", {
      name: "From the first booking to the last head count.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "A manifest that stays useful after the signal disappears.",
    }),
  ).toBeVisible();
  // The money story and the full capability index — the two things a buyer
  // comparing DiveDay against an incumbent's feature page goes looking for.
  await expect(
    page.getByRole("heading", { name: "The money runs through your Stripe account, not ours." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "The whole list, plainly." })).toBeVisible();
  // The full capability index sits behind a disclosure by default.
  await page.getByText("The full list").click();
  await expect(page.getByRole("heading", { name: "Booking and the public pages" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your records" })).toBeVisible();
  // The honest-no scope block and the demo CTA both land on the product page —
  // three demo doors: the hero (the most evaluation-intent click on the site
  // must offer proof above the fold), mid-page after the dock story, and the
  // closing band.
  await expect(page.getByRole("heading", { name: "What DiveDay doesn't do." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(3);

  // The mid-page door carries its own funnel tag. Folded into `product` it
  // could never be shown to have earned its place among ten sections; the hero
  // and closing pair keep the page's original tag so their history holds.
  // Scoped through `<main>` for the same reason the sign-up test is: a previous
  // route's hidden `input[name="source"]` stays reachable while Activity keeps
  // it in the DOM, and a raw `page.locator` would count it.
  const productMain = page.getByRole("main");
  await expect(productMain.locator('input[name="source"][value="product-mid"]')).toHaveCount(1);
  await expect(productMain.locator('input[name="source"][value="product"]')).toHaveCount(2);
  await expect(
    productMain.locator('a[href="/onboard?from=product-mid"]'),
    "the mid-page trial link is tagged like its demo twin",
  ).toHaveCount(1);

  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(
    page.getByRole("heading", { name: "One flat price for the whole shop." }),
  ).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();
  await expect(page.getByText(/The crew saves the manifest to their phone/)).toBeVisible();

  // A flat price only means something next to the model it replaces, so the
  // page anchors against the per-booking fees the switching guides document —
  // each stated as the incumbent's own published terms (or, for FareHarbor,
  // explicitly as an unpublished rate third parties report), each linked to the
  // guide that carries the citation. No claim about what a shop pays in
  // practice and no savings arithmetic: we have no customers to know either.
  await expect(
    page.getByRole("heading", { name: "A flat price, or a cut of every seat you sell." }),
  ).toBeVisible();
  await expect(
    page.getByText(/monthly subscription plus 3% of every online booking/),
  ).toBeVisible();
  await expect(page.getByText(/publishes no rate at all/)).toBeVisible();
  await expect(page.getByText(/third parties report that fee at around 6%/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /What moving off Rezdy looks like/ }),
  ).toHaveAttribute("href", "/switching/rezdy");
  await expect(
    page.getByRole("link", { name: /What moving off FareHarbor looks like/ }),
  ).toHaveAttribute("href", "/switching/fareharbor");
  // The claims-policy guard for this section: no savings promise, no invented
  // figure for what shops actually pay.
  const pricingBody = await page.locator("body").innerText();
  for (const pattern of [/\bsave[sd]? (you )?\$?\d/i, /shops (pay|save) (around|about|roughly)/i]) {
    expect(pricingBody, `unfounded savings claim matching ${pattern}`).not.toMatch(pattern);
  }
  // The objection layer answers the deal-killers, and a skeptic can reach the
  // demo without committing to a trial form.
  await expect(
    page.getByRole("heading", {
      name: "DiveDay is new. What happens to my data if this doesn't work out?",
    }),
  ).toBeVisible();
  // Same shared label as everywhere else — "Try the live demo first" was the
  // exact per-page synonym drift the one-label rule exists to catch.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();
});

test("the sign-up form answers the hesitation it creates", async ({ page }) => {
  // The trial link carries the page that sent it, so demo-vs-trial can be read
  // per surface; the form hands that tag back to the action.
  await page.goto("/pricing");
  await page.getByRole("link", { name: "Start a trial" }).last().click();
  await expect(page).toHaveURL(/\/onboard\?from=pricing$/);
  // A hidden input can't be scoped with `.filter({ visible: true })` (it would
  // never match), and the previous route's own `input[name="source"]` (this
  // page's FunnelTag) stays reachable while Activity keeps it in the DOM — so
  // scope through the current page's own `<main>` landmark instead, which
  // `getByRole` (visibility-safe, see e2e/fixtures.ts) narrows to the one
  // that's actually on screen.
  await expect(page.getByRole("main").locator('input[name="source"]')).toHaveValue("pricing");

  // Asking for a password is the moment of maximum hesitation, so the three
  // reassurances sit with the form, not on a page the visitor already left.
  await expect(page.getByText("No card, no setup fee.")).toBeVisible();
  await expect(page.getByText("Your records leave with you.")).toBeVisible();
  await expect(page.getByText("Real support, one email away.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create shop & start trial" })).toBeVisible();

  // An unrecognized tag is bucketed rather than echoed into the funnel.
  await page.goto("/onboard?from=Not%20A%20Real%20Source");
  await expect(page.locator('input[name="source"]')).toHaveValue("unknown");
});

test("the about page says who is behind DiveDay and what it won't pretend", async ({ page }) => {
  // Reachable from the footer on any marketing page — the conventional place a
  // buyer looks for who they're dealing with.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "About" }).click();

  // The hero has to survive the rulebook's own paste test: "Built by divers,
  // for divers." was true of every dive-adjacent vendor on earth — a rival
  // could paste it unchanged — which made it an eyebrow wearing a headline's
  // clothes. This one names the thing only DiveDay can say — one person
  // owns every line running on this boat — and the page proves it two
  // sections down in the founder bio.
  await expect(
    page.getByRole("heading", {
      name: "One person owns every line of code running on this boat.",
    }),
  ).toBeVisible();
  await expect(page.getByText(/one of them owns it, writes every line of it/)).toBeVisible();

  // The page earns trust by conceding, not by claiming: the honest-no block and
  // the named accountable human are the load-bearing parts.
  await expect(
    page.getByRole("heading", { name: "What we're not going to pretend." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "DiveDay is new." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "It doesn't do everything." })).toBeVisible();
  await expect(page.getByText("Aaron Buxbaum, founder")).toBeVisible();

  // Trust from a vendor with no install base is checkable, not asserted: each
  // rule ships with the demo action that proves it.
  await expect(
    page.getByRole("heading", { name: "Four rules, and you can check every one." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "It has to survive the dock." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No silent passes." })).toBeVisible();
  await expect(page.getByText("save a manifest to your phone")).toBeVisible();

  // A trust page that didn't land on the exit would be missing the point.
  await expect(
    page.getByRole("heading", { name: "Who you're actually buying from." }),
  ).toBeVisible();
  await expect(page.getByText(/No export fee, no support ticket/)).toBeVisible();

  // No fabricated proof anywhere on the page a buyer reads for credibility.
  const rendered = await page.locator("body").innerText();
  for (const pattern of [/trusted by/i, /\d+\+? (shops|customers|divers) (use|trust)/i]) {
    expect(rendered, `unfounded social proof matching ${pattern}`).not.toMatch(pattern);
  }

  // Demo-before-trial, same funnel order as every other marketing page.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a trial" }).last()).toBeVisible();
});

test("migration guides walk a shop from an incumbent export into the importer", async ({
  page,
}) => {
  // The switch surface is reachable from the footer on any marketing page.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Switch" }).click();

  await expect(page.getByRole("heading", { name: "The door swings both ways." })).toBeVisible();

  // The named incumbents each have a live guide (no coming-soon entries).
  for (const name of [
    /Switching from EVE/,
    /Switching from DiveShop360/,
    /Switching from Smartwaiver/,
    /Switching from FareHarbor/,
    /Switching from Rezdy/,
  ]) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }

  await page.getByRole("link", { name: /Switching from EVE/ }).click();
  await expect(page.getByRole("heading", { name: "Moving your shop off EVE" })).toBeVisible();

  // The three-part promise: export click-path, the scope table, the importer.
  await expect(page.getByRole("heading", { name: "Get your data out of EVE" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What comes across — and what doesn't" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bring the file into DiveDay" })).toBeVisible();
  // …and the return trip, stated on the same page rather than left implied.
  // A guide that only walks a shop *out of* an incumbent sells a one-way door;
  // the scope table has to read in both directions, so the block that says so
  // is part of the guide's contract, not decoration.
  await expect(
    page.getByRole("heading", { name: "The same table, read the other way." }),
  ).toBeVisible();
  // Same guard as the spreadsheet guide: no shop session, no deep-link CTA.
  await expect(page.getByRole("link", { name: "Open Import in your shop" })).toBeHidden();

  // A buyer can act from the hero, not only from the closing block seven
  // sections down: the demo form and the trial link sit in the same section as
  // the h1, and the trial link carries this guide's funnel tag. This is the
  // *buyer's* CTA — distinct from the deep-link above, which is for an owner
  // who already has a shop and is correct to stay hidden here.
  const heroSection = page.getByRole("main").locator("section").first();
  await expect(heroSection.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(heroSection.getByRole("button", { name: "Try the live demo" })).toBeEnabled();
  await expect(heroSection.getByRole("link", { name: "Start a trial" })).toHaveAttribute(
    "href",
    "/onboard?from=switching-eve",
  );
  // Three doors out: the hero, the repeat under the scope table, and the close.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Rather see it than read about it?" }),
  ).toBeVisible();

  // The scope table is the importer's honesty table — a claimed waiver
  // acceptance is trusted, medical clearance included, and marked imported.
  await expect(page.getByText("Signed waivers & medical clearance", { exact: true })).toBeVisible();
  await expect(page.getByText("Stays behind").first()).toBeVisible();
  // Specialty cards moved into the green column and say what waits on staff.
  await expect(page.getByText("Specialty cards (deep, wreck, night, drysuit)")).toBeVisible();

  // Nothing on a published page may cite how *we* talk about a decision. The
  // honesty table and the guides render verbatim, so a note written for the next
  // agent ("see the imported-waiver ADR") would ship to a buyer as a dead end —
  // and this reads the rendered page, so it also catches copy a component
  // assembles rather than a data file. Unit-level guard: src/test/copy.ts.
  const rendered = await page.locator("body").innerText();
  for (const pattern of [
    /\bADRs?\b/,
    /\b20\d{6}-[a-z-]+\b/,
    /\bH-\d\d\b/,
    /\bCR-\d{3}\b/,
    /\bsrc\/[a-z]/,
    /dive-domain-expert|security-reviewer/,
  ]) {
    expect(rendered, `internal reference matching ${pattern} on a published page`).not.toMatch(
      pattern,
    );
  }

  // Demo-before-trial funnel and cited competitor claims both land on the guide.
  await expect(page.getByRole("button", { name: "Try the live demo" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.getByRole("link", { name: /DiveShop360 acquires EVE Diving/ })).toBeVisible();

  // Another live guide carries its own export path and a competitor-specific note.
  await page.goto("/switching/smartwaiver");
  await expect(
    page.getByRole("heading", { name: "Moving your waivers off Smartwaiver" }),
  ).toBeVisible();
  await expect(page.getByText(/For a Smartwaiver export:/)).toBeVisible();

  // FareHarbor is a booking channel, not a records system, so its guide is
  // coexist-led: keep the storefront and run the dive day, or leave the fee —
  // then the same export/scope/import mechanics every guide shares.
  await page.goto("/switching/fareharbor");
  await expect(
    page.getByRole("heading", { name: "FareHarbor fills the seats. DiveDay runs the boat." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keep FareHarbor. Add the day it can't run." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Or leave the per-booking fee behind." }),
  ).toBeVisible();
  // It still renders the shared three-part promise and the honesty table.
  await expect(
    page.getByRole("heading", { name: "Get your data out of FareHarbor" }),
  ).toBeVisible();
  await expect(page.getByText("Signed waivers & medical clearance", { exact: true })).toBeVisible();

  // Rezdy is the second booking-channel guide — same coexist template, its own
  // copy (a monthly-plus-per-booking model rather than FareHarbor's fee).
  await page.goto("/switching/rezdy");
  await expect(
    page.getByRole("heading", { name: "Rezdy sells the seats. DiveDay runs the boat." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keep Rezdy. Add the day it can't run." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Or leave the monthly fee and the per-booking cut behind." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get your data out of Rezdy" })).toBeVisible();

  // An unlisted incumbent has no page — no coming-soon shells. Content-level,
  // not `response?.status()`: `/switching/[competitor]` prerenders only the
  // registered slugs via `generateStaticParams`, so an unregistered one like
  // "checkfront" falls back to a dynamic render, and cacheComponents'
  // Partial Prerendering unconditionally serves an optimistic 200 "App
  // Shell" for a dynamic-param combination without a static shell, upgrading
  // it in the background once `notFound()` resolves — confirmed locally: the
  // first hit to an unseen slug answers 200, and only a subsequent hit to
  // the same (now-resolved) path answers 404. There is no per-route opt-out
  // (`dynamicParams = false` and `experimental_ppr` are both removed under
  // `nextConfig.cacheComponents`). The rendered document still correctly
  // lands on Next's own not-found boundary — only the raw first-byte HTTP
  // status of a cold hit is 200 instead of 404. Same known Next 16
  // cacheComponents limitation the certification-path spec documented before
  // ADR 20260805-remove-certification-paths deleted it.
  await page.goto("/switching/checkfront");
  await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
  // `.first()`: the server HTML (confirmed via curl against a fresh build)
  // carries exactly one `<meta name="robots">`, but this route's dynamic
  // hole resolving client-side after a full navigation inserts a second,
  // identical one — a harmless PPR-resolution duplicate, not a second,
  // differing directive: a route with no dynamic-hole resolution step hits
  // the same not-found boundary and never duplicates it.
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", "noindex");
});

test("the spreadsheet guide brings a no-system shop across for free", async ({ page }) => {
  // Reachable from the hub — the largest under-served pool gets a front door.
  await page.goto("/switching");
  await page.getByRole("link", { name: /Coming from a spreadsheet/ }).click();
  await expect(
    page.getByRole("heading", { name: "The spreadsheet got you this far." }),
  ).toBeVisible();

  // The three-part shape, reframed for a shop with no vendor to leave:
  // ready your own sheet, the shared scope table, the importer.
  await expect(
    page.getByRole("heading", { name: "Does your sheet have these columns?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What comes across — and what doesn't" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bring the file into DiveDay" })).toBeVisible();
  // The direct-to-import CTA only makes sense for a signed-in owner already
  // sitting on their own shop's session (see import.spec.ts) — an anonymous
  // visitor has no shop to deep-link into.
  await expect(page.getByRole("link", { name: "Open Import in your shop" })).toBeHidden();

  // The starter template downloads a real CSV (not a dead link).
  const templateHref = await page
    .getByRole("link", { name: /Download the starter template/ })
    .getAttribute("href");
  expect(templateHref).toBe("/diveday-diver-import-template.csv");
  const template = await page.request.get(templateHref ?? "");
  expect(template.ok()).toBeTruthy();
  const templateBody = await template.text();
  // Nitrox needs its card-number column, or a "yes" flag lands nothing.
  expect(templateBody).toContain("certification_number");
  expect(templateBody).toContain("nitrox_certification_number");
  // The columns the spreadsheet guide documents but the template used to
  // omit (task 102).
  expect(templateBody).toContain("dive_insurance");
  expect(templateBody).toContain("specialty");
  expect(templateBody).toContain("refresher_due");
  // A few realistic, clearly-fake example rows (task 102) — headers alone
  // left a shop owner guessing at the shape of a filled-in row.
  const templateRows = templateBody.trim().split("\n");
  expect(templateRows.length).toBeGreaterThan(1);
  expect(templateBody).toContain("@example.com");

  // The scope table is the importer's honesty table — same safety spine.
  await expect(page.getByText("Signed waivers & medical clearance", { exact: true })).toBeVisible();

  // The owner-authorized concierge switch offer lands, phrased as a human
  // commitment, with a real handoff: an email link the shop can act on.
  await expect(
    page.getByRole("heading", { name: /switch you on — and off — ourselves/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Email us at/ })).toHaveAttribute(
    "href",
    /^mailto:switch@dive\.day/,
  );

  // Demo-before-trial funnel, same as every guide — and, same as every guide,
  // the first of those doors is in the hero rather than nine sections down.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(3);
  const spreadsheetHero = page.getByRole("main").locator("section").first();
  await expect(spreadsheetHero.getByRole("button", { name: "Try the live demo" })).toBeEnabled();
  await expect(spreadsheetHero.getByRole("link", { name: "Start a trial" })).toHaveAttribute(
    "href",
    "/onboard?from=switching-spreadsheet",
  );
});

test("every public marketing page unfurls as a card, not a bare URL", async ({ page }) => {
  // Shared links are one of two free inbound channels, and these pages get
  // pasted into shop owners' chat groups. `/switching/spreadsheet` shipped
  // without an Open Graph block at all, and the Twitter card had no per-page
  // words anywhere — both are silent failures that only show up in someone
  // else's chat window, so they get a test rather than a review habit.
  for (const path of [
    "/",
    "/product",
    "/pricing",
    "/about",
    "/switching",
    "/switching/spreadsheet",
    "/switching/eve",
    "/onboard",
  ]) {
    await page.goto(path);
    // `.first()`: a dynamic hole resolving after a client-side render can
    // insert a second, identical tag — see the `meta[name="robots"]` note above.
    const content = async (selector: string) =>
      await page.locator(selector).first().getAttribute("content");

    expect(await content('meta[property="og:title"]'), `${path} og:title`).toBeTruthy();
    expect(await content('meta[property="og:description"]'), `${path} og:description`).toBeTruthy();
    expect(await content('meta[property="og:url"]'), `${path} og:url`).toContain(
      path === "/" ? "/" : path,
    );
    // Policy (docs/product/marketing.md): `summary_large_image` wherever the
    // shared link card applies. The root `src/app/opengraph-image.tsx` renders
    // for every marketing page (a segment with its own file overrides it — see
    // the per-shop card in e2e/seo.spec.ts), so today that is all of them, and
    // asserting the image beside the card type is what keeps the pair honest:
    // a large-image card with no image unfurls worse than a small one.
    expect(await content('meta[property="og:image"]'), `${path} og:image`).toMatch(/^https?:\/\//);
    expect(await content('meta[name="twitter:card"]'), `${path} twitter:card`).toBe(
      "summary_large_image",
    );
    expect(await content('meta[name="twitter:title"]'), `${path} twitter:title`).toBeTruthy();
    expect(
      await content('meta[name="twitter:description"]'),
      `${path} twitter:description`,
    ).toBeTruthy();
  }
});

test("a signed-out visitor reaches the demo from the top of a switching guide", async ({
  page,
}) => {
  // The whole point of the hero CTA: no session, no export, no form — the
  // highest-intent page in the funnel opens the working shop in one click.
  await page.goto("/switching/eve");
  await page
    .getByRole("main")
    .locator("section")
    .first()
    .getByRole("button", { name: "Try the live demo" })
    .click();

  await expect(page).toHaveURL(/\/shop\//);
  await expect(page.getByText("Demo shop")).toBeVisible();
});
