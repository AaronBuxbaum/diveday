import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

test("the homepage hero offers one demo door, and the diver preview lives on its daily-moment row", async ({
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
  // Exactly two demo buttons (hero, closing) — the five-chip role picker is
  // gone from the hero (role switching is the in-demo switcher's job), and the
  // mid-page door retired on 2026-08-13 when the page's three consecutive
  // banded CTAs merged into one close, putting the closing door a full band
  // nearer (docs/product/marketing.md).
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(2);
  // The old label is gone site-wide, not merely replaced here: one action
  // wearing two names is what the single-label rule exists to stop, and the
  // rename has to stay renamed (docs/product/marketing.md, Voice).
  await expect(page.getByRole("button", { name: "Try the staff app" })).toHaveCount(0);

  // Hero decision density: one primary action, at most one secondary. The hero
  // once offered ~9 (a five-chip role picker, the diver preview, demo, trial),
  // and every retired destination moved rather than disappeared — the roles
  // into the in-demo switcher, the preview onto its daily-moment row below. The
  // mockup's "Mark boarded" buttons are `disabled` scenery, not doors, so the
  // count is of things a visitor can actually act on.
  const heroSection = page.getByRole("main").locator("section").first();
  await expect(heroSection.locator("button:not([disabled])")).toHaveCount(1);
  await expect(heroSection.getByRole("link")).toHaveCount(1);
  await expect(heroSection.getByRole("link")).toHaveAttribute("href", "/onboard?from=home-hero");

  // The diver preview moved out of the hero (where it was a third competing
  // door) onto the diver's row of the daily-moments section, still tagged for
  // attribution.
  const scheduleLink = page.getByRole("link", { name: "See a diver's booking page →" });
  const href = await scheduleLink.getAttribute("href");
  // Sourced from DEMO_SHOP_SLUG rather than a hand-typed literal, and tagged
  // for funnel attribution the same way the trial link is. The source moved to
  // the diver's daily-moments row when the hero's role picker was retired
  // (#328); the path is the split public namespace's.
  expect(href).toBe(`/s/${DEMO_SHOP_SLUG}?from=home-diver-moment`);

  await scheduleLink.click();
  await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
  // Departures on it, not merely a page titled "Schedule". The link promises a
  // booking page, and the heading renders identically over the "No trips on the
  // books yet" empty state — which is exactly what the canonical demo shows once
  // its clock-anchored seed ages out (ADR 20260812-demo-schedule-keeper).
  await expect(
    page.getByRole("list", { name: "Upcoming trips" }).getByRole("listitem").first(),
  ).toBeVisible();
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
  // Both directions are shown, not just described: the importer's preview for
  // arriving, the export inventory for leaving. This band is the portability
  // wedge — the strongest claim DiveDay has against any incumbent — and it made
  // that claim in two paragraphs and a checklist until 2026-08-12. Asserting the
  // mockup keeps it from quietly reverting to prose.
  await expect(page.getByRole("img", { name: /import preview/i })).toBeVisible();
  // The two directions are named, and the geometry that names them is the
  // claim: a mirrored pair of columns for a section arguing that records leave
  // the same way they arrive (2026-08-13 redesign, docs/product/marketing.md).
  // Headings rather than text, so a future edit cannot demote them back into
  // an eyebrow that leaves each column unnamed in the outline.
  await expect(page.getByRole("heading", { name: "Coming in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Going out" })).toBeVisible();

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

  // The click-through above has done its job — the Product link leads here.
  // The capability index is re-checked from a fresh `goto`, so it is asserted
  // against a directly-rendered document as well as a client navigation.
  //
  // This block used to click a `<details>` open, and that click was the one
  // interaction on the page that could lose a race. `/product` painted a
  // **default-locale body as its own Suspense fallback** and swapped in the
  // negotiated-locale one when it resolved; for an en-US run both rendered
  // identical copy, but the swap replaced the subtree, and `<details>`
  // open/closed is DOM state a replaced subtree does not carry over. A click
  // landing in that window opened a disclosure that was about to be thrown
  // away, and the next assertion then queried a *closed* `<details>` —
  // contents outside the accessibility tree, so `getByRole` reported
  // "element(s) not found" rather than "not visible". That is exactly how this
  // failed on CI (shard 3/4, run 31549005047) and never once locally.
  //
  // Both halves are closed now. The disclosure went first (the index renders
  // flat — a section headed "the whole list, plainly" that hid the list was the
  // emptiest band on the page), and on 2026-08-14 the double render went too:
  // the body renders once, in the reader's own language, behind the segment's
  // `loading.tsx`, so there is no doomed subtree left to interact with at all
  // (see `ProductPage`, and the `Accept-Language: es` describe at the bottom of
  // this file, which is the regression guard). The load-gated `goto` stays: it
  // is the navigation's own completion, never a guessed interval.
  await page.goto("/product");
  await expect(page.getByRole("heading", { name: "The whole list, plainly." })).toBeVisible();
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
  // demo without committing to a trial form. This row asked "DiveDay is new.
  // What happens to my data if this doesn't work out?" until 2026-08-12: a FAQ
  // question is the one place a page speaks in the reader's voice, and putting
  // our own weakest framing in their mouth talked them into a doubt they hadn't
  // arrived with. The answer beneath it is unchanged — the exit is the point,
  // not the flinch (docs/product/marketing.md, "Concede the facts; never
  // apologize for them").
  await expect(
    page.getByRole("heading", { name: "What happens to my records if I leave?" }),
  ).toBeVisible();
  // Same shared label as everywhere else — "Try the live demo first" was the
  // exact per-page synonym drift the one-label rule exists to catch.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();

  // The page closes on the number it opened with, and that closing door is
  // tagged apart from the hero's. Without it the only trial door below the
  // fold was the header's, which does not stick — a reader who scrolled the
  // objection layer had nothing left to act on. Tagged like `product-mid`, so
  // the position can be shown to have earned its place rather than folding
  // into the page's own bucket (src/lib/funnel.ts).
  await expect(page.getByRole("heading", { name: "That's our whole price." })).toBeVisible();
  const pricingMain = page.getByRole("main");
  // Visible, not merely present: `toHaveCount` passes on a `display:none`
  // anchor, and a closing door nobody can see is the bug this one exists to
  // fix rather than a fix for it.
  await expect(pricingMain.getByRole("link", { name: "Start a trial" }).last()).toBeVisible();
  await expect(pricingMain.locator('a[href="/onboard?from=pricing-close"]')).toHaveCount(1);
  await expect(pricingMain.locator('a[href="/onboard?from=pricing"]')).toHaveCount(1);

  // The switching guides' door out of the FAQ. Without it the footer is the
  // only path to /switching from this page, and the row's href and label are
  // one optional pair in the page's own type precisely so half of it cannot go
  // missing — which renders no link at all, silently.
  await expect(page.getByRole("link", { name: "Browse the switching guides →" })).toHaveAttribute(
    "href",
    "/switching",
  );
});

test("the sign-up form answers the hesitation it creates", async ({ page }) => {
  // The trial link carries the page that sent it, so demo-vs-trial can be read
  // per surface; the form hands that tag back to the action.
  await page.goto("/pricing");
  // Scoped to `<main>` and taken first: the header carries its own `nav`-tagged
  // trial link, and the page now closes with a second one tagged
  // `pricing-close`, so neither end of the document is the hero's door.
  await page.getByRole("main").getByRole("link", { name: "Start a trial" }).first().click();
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

  // This headline has walked into four different failures, so it is pinned
  // against all of them. "Built by divers, for divers." was true of every
  // dive-adjacent vendor on earth — a rival could paste it unchanged, making it
  // an eyebrow in a headline's clothes. "One person owns every line of code
  // running on this boat." conceded smallness so hard it read as a vendor with
  // no infrastructure behind it — the fear this page exists to answer, not
  // feed. "Small enough to answer you." then spent the site's most valuable
  // line on the company's *size*, the one thing about DiveDay a buyer has no
  // reason to want. "We'd rather be checked than believed." fixed the register
  // but picked a fight: it presumes the reader's distrust and answers it with a
  // dare, which is a strange way to open a page about who you are.
  //
  // What survives all four states the reassurance as a fact about the shop's
  // operation rather than a posture about us, and the sentence under it is the
  // proof — the shop's own Stripe account, the ZIP, roll call with no signal.
  // The Stripe half is asserted beside the headline because the headline alone
  // would be the second failure again.
  await expect(
    page.getByRole("heading", { name: "Your season doesn't hang on us." }),
  ).toBeVisible();
  // Case-insensitive on purpose. The claim is "the money is in the shop's own
  // account"; whether the sentence happens to start with it is not part of the
  // claim, and pinning the capital broke this line when the hero was reordered
  // for reasons that had nothing to do with what it asserts. The *words* stay
  // pinned — that is the point of the marketing specs — but incidental form
  // does not.
  await expect(page.getByText(/payments run through your own Stripe account/i)).toBeVisible();

  // The page earns trust by conceding, not by claiming: the honest-no block is
  // the load-bearing part. (It used to also pin "Aaron Buxbaum, founder" from
  // the "Who builds it" credential row; that row was removed 2026-08-05 — see
  // docs/product/marketing.md — so the page names no individual, and asserting
  // one here would only re-introduce it by the back door.)
  await expect(
    page.getByRole("heading", { name: "What we're not going to pretend." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "DiveDay is new." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "It doesn't do everything." })).toBeVisible();

  // Trust here is checkable, not asserted: each rule ships with the demo action
  // that proves it.
  await expect(
    page.getByRole("heading", { name: "Four rules, and you can check every one." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "It has to survive the dock." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No silent passes." })).toBeVisible();
  await expect(page.getByText("save a manifest to your phone")).toBeVisible();

  // The checkable half comes *before* the conceding half. The rules used to sit
  // fourth, below two sections of prose, which put the page's only verifiable
  // content off the bottom of every screen a visitor actually saw. Asserted as
  // an order rather than a presence, because both blocks existed then too.
  const headings = await page.getByRole("heading", { level: 2 }).allInnerTexts();
  expect(headings.indexOf("Four rules, and you can check every one.")).toBeLessThan(
    headings.indexOf("What we're not going to pretend."),
  );

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
  // Three doors out, and only three: the hero, the hinge between the argument
  // and the mechanics, and the close.
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

test("no marketing page apologizes for the company's size or age", async ({ page }) => {
  // The claims policy requires the honest no — "DiveDay is new." is still a
  // heading on /about, and the scope concessions still lead /product's own
  // section. What it never required is *apologizing* for those facts, and by
  // 2026-08-12 nine separate framings of "we're small, we're new, you've never
  // heard of us, don't take us on faith" had accumulated across five pages.
  // Each read as reasonable candor alone; together they argued a buyer out of
  // the sale before the product got a word in.
  //
  // So the facts stay and the self-deprecation is pinned out by name. This is a
  // ratchet, not a style note: every one of these shipped as a sentence someone
  // thought was honest, which is exactly why a review won't catch the next one.
  //
  // Scope, stated rather than assumed: the suite negotiates the default locale,
  // so these patterns only ever meet en-US. That is deliberate — English is
  // where this copy is authored and where the flinch gets invented — but it
  // does mean an apologetic Spanish string would pass. What guards es-ES is the
  // edit-both-locales-together rule (`pnpm check:locale`) plus this rulebook,
  // not this test. Widening it means rendering each page a second time under a
  // `diveday_locale` cookie with a parallel Spanish pattern list; worth doing if
  // the register ever drifts between the bundles, and not worth guessing at now.
  const apologetics = [
    /small (enough|vendor|team|company)/i,
    /(new|small) vendor/i,
    /on faith/i,
    /never heard of/i,
    /no install base/i,
    /wall of logos/i,
    /the least we can do/i,
    /borrow credibility/i,
  ];
  for (const path of ["/", "/product", "/pricing", "/about", "/switching"]) {
    await page.goto(path);
    const rendered = await page.locator("body").innerText();
    for (const pattern of apologetics) {
      expect(rendered, `${path} apologizes: ${pattern}`).not.toMatch(pattern);
    }
  }
});

test("the switching hub shows the import preview rather than describing it", async ({ page }) => {
  // "Exactly what comes across" is this page's entire promise and it was made
  // only in prose. The mockup mirrors the real wizard's preview step, so the
  // parts that make the promise credible — the columns it *didn't* recognize,
  // and the row it intends to skip — are the parts asserted here.
  await page.goto("/switching");
  await expect(
    page.getByRole("heading", { name: "You see the whole file before a single row lands." }),
  ).toBeVisible();
  const preview = page.getByRole("img", { name: /import preview/i });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(/Not recognized, so ignored/)).toBeVisible();
  // `exact` (and so case-sensitive): the mockup also carries a "Skipped" stat
  // tile, and the badge on the row is the half that shows the file being read
  // rather than merely counted.
  await expect(preview.getByText("skipped", { exact: true })).toBeVisible();
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
    // A page's own `openGraph` block replaces the root layout's rather than
    // merging into it, so these two drop off silently the moment a page says
    // anything about itself — see src/lib/site-metadata.ts.
    expect(await content('meta[property="og:site_name"]'), `${path} og:site_name`).toBe("DiveDay");
    expect(await content('meta[property="og:type"]'), `${path} og:type`).toBe("website");
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

/**
 * **The marketing pages render their body once, in the reader's own language.**
 *
 * Until 2026-08-14 each of `/`, `/product` and `/pricing` rendered its body
 * *twice*: the `<Suspense>` fallback was the whole page in the default locale,
 * and the negotiated-locale body replaced it when `requestLocale()` resolved.
 * That is what made these routes paint instantly, and it meant a visitor could
 * see, scroll, and tap a subtree that was about to be torn down — React carries
 * no DOM state across a replaced subtree. On `/product` the cost was the anchor
 * strip: an `es-ES` reader who tapped "Con el barco de vuelta" before the
 * Spanish body landed scrolled to that heading in the *English* subtree, and
 * the preserved offset then put them somewhere in the payment band, because
 * every Spanish section above it is taller. Quiet, and impossible to attribute
 * from the reader's side (FU-20260812-marketing-suspense-swap-discards-interaction).
 *
 * Why no en-US test could ever have caught it: for an en-US reader the two
 * renders are the same words, so the swap is invisible in every screenshot and
 * every English-pinned assertion, and it still tears the DOM down.
 *
 * Why this one catches it without a timing guess. Under the old arrangement the
 * English body was not merely *likely* to be on screen first — it was literally
 * in the first HTML frame, part of the prerendered static shell, before a byte
 * of Spanish existed. So the assertion is not "wait and hope to catch the
 * window": an init script (installed before any page script runs) watches the
 * document from its creation and records whether English body copy is *ever*
 * present, however briefly. Old code: recorded every run. New code: never,
 * because the first frame is a skeleton with no words and nothing to tap.
 *
 * The markers are body copy, never chrome — `MarketingNavFallback` and
 * `MarketingFooterFallback` still render the default-locale header and footer
 * for one frame, which is a separate (stateless) trade and not what this guards.
 */
test.describe("with Accept-Language: es", () => {
  test.use({ locale: "es-ES" });

  /** One phrase per page, unique to its body and absent from the chrome. */
  const bodyCopy = {
    "/": {
      english: "Run the whole dive day, from booking to head count.",
      spanish: "Lleva todo el día de buceo, desde la reserva hasta el recuento final.",
    },
    "/product": {
      english: "From the first booking to the last head count.",
      spanish: "Desde la primera reserva hasta el último recuento.",
    },
    "/pricing": {
      english: "One flat price for the whole shop.",
      spanish: "Un precio fijo para todo el centro.",
    },
    // The three that still carried the fallback-is-the-body shape on
    // 2026-08-14 (FU-20260814-remaining-fallback-is-the-body-marketing-pages).
    // `/switching` renders its skeleton from an in-page `<Suspense>` rather
    // than a `loading.tsx`, because that file would also be the boundary for
    // `/switching/[competitor]`; the guarantee this test checks is the same
    // either way.
    "/switching": {
      english: "The door swings both ways.",
      spanish: "La puerta se abre en ambos sentidos.",
    },
    "/switching/spreadsheet": {
      english: "The spreadsheet got you this far.",
      spanish: "La hoja de cálculo te trajo hasta aquí.",
    },
    "/about": {
      english: "Your season doesn't hang on us.",
      spanish: "Tu temporada no depende de nosotros.",
    },
  } as const;

  test("a marketing page never paints a body in a language its reader did not ask for", async ({
    page,
  }) => {
    await page.addInitScript(
      (markers: string[]) => {
        const recorder = window as unknown as { __englishBodyEverSeen?: string[] };
        const seen: string[] = [];
        recorder.__englishBodyEverSeen = seen;
        const look = () => {
          const text = document.body?.textContent ?? "";
          for (const marker of markers) {
            if (text.includes(marker) && !seen.includes(marker)) seen.push(marker);
          }
        };
        look();
        // Parser-inserted nodes generate mutation records too, so this sees the
        // streamed document as it is built — including a Suspense fallback that
        // exists for a single frame.
        new MutationObserver(look).observe(document, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      },
      Object.values(bodyCopy).map((copy) => copy.english),
    );

    for (const [path, copy] of Object.entries(bodyCopy)) {
      await page.goto(path);
      // The page is finished rendering in the reader's language — so anything
      // the recorder caught was on screen at some point before this, which is
      // exactly the window the old fallback lived in.
      await expect(page.getByRole("heading", { level: 1, name: copy.spanish })).toBeVisible();
      const seen = await page.evaluate(
        () =>
          (window as unknown as { __englishBodyEverSeen?: string[] }).__englishBodyEverSeen ?? [],
      );
      expect(seen, `${path} painted default-locale body copy before its own`).toEqual([]);
    }
  });

  test("/product's anchor strip lands an es-ES reader in the chapter they asked for", async ({
    page,
  }) => {
    // The acceptance case from the follow-up, and the reason the fix is worth
    // its skeleton: the strip is the page's whole table of contents, it is the
    // first interactive thing under the hero, and it was the control the swap
    // could spoil. (The `<details>` that originally raised this was deleted on
    // 2026-08-13; the strip replaced it as the thing to prove.)
    await page.goto("/product");

    const arc = page.getByRole("navigation", { name: "Un día de buceo" });
    await expect(arc).toBeVisible();
    const recapEntry = arc.getByRole("link", { name: /Con el barco de vuelta/ });
    await expect(recapEntry).toHaveAttribute("href", "#recap");

    await recapEntry.click();
    await expect(page).toHaveURL(/\/product#recap$/);
    // Still looking at chapter 05 — in Spanish, in the one and only body this
    // page renders. Under the old double render this heading existed twice in
    // succession at two different offsets, and a tap early enough scrolled to
    // the copy that was about to be discarded.
    await expect(
      page.getByRole("heading", {
        name: "El día termina con un resumen que los buceadores quieren compartir.",
      }),
    ).toBeInViewport();
  });
});

test("the legal pages are published, honest about what is unsettled, and not yet advertised", async ({
  page,
}) => {
  // Published 2026-08-14 (FU-20260812-no-privacy-or-terms-page). DiveDay stores
  // signed waivers, medical answers and certification evidence belonging to
  // shops' divers, and had no page saying what happens to any of it.
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "What we hold, where it lives, and how it leaves",
  );

  // The sub-processor list reads as exhaustive, so it has to be. A 2026-08-14
  // security review found three live ones missing from the first draft --
  // Sentry (mounted from instrumentation.ts, invisible to the
  // observability-client.tsx derivation the copy was written from), Google
  // (the embedded map on a *diver's* trip-prep page), and the browser push
  // vendors. Naming each here means adding a fourth third party to the app
  // without adding it to this page fails a test rather than shipping a
  // published falsehood.
  for (const processor of ["Stripe", "AWS", "Meta", "Vercel", "Neon", "Sentry", "Google"]) {
    await expect(page.getByRole("term").filter({ hasText: processor }).first()).toBeVisible();
  }

  // The retention windows are RETENTION_DAYS as prose. If that constant moves,
  // this copy is part of that change. "Attempts", not "outcomes": the 400-day
  // window prunes notification_delivery_attempts, and the first draft attached
  // that number to notification_deliveries, which has no timer at all.
  await expect(page.getByText("Staff activity history: 3 years.")).toBeVisible();
  await expect(
    page.getByText("Message delivery attempts: 400 days", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Payment event history: 7 years", { exact: false })).toBeVisible();

  // The honest-no that keeps this page from pre-empting an open human decision:
  // H-02 has not settled how long a waiver and its medical answers are kept, so
  // the page says the question is open rather than inventing a number.
  await expect(page.getByText("Still being decided")).toBeVisible();

  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("What we owe each other");
  // Conceded loudly rather than quietly omitted: there is no uptime guarantee,
  // and saying so is worth more than an SLA with no track record behind it.
  await expect(page.getByRole("heading", { name: "What we do not promise" })).toBeVisible();

  // H-12: one source for the price, which is /pricing. A terms page quoting a
  // stale figure is worse than one that quotes none.
  await expect(page.getByText("$99")).toHaveCount(0);

  // H-18 is open, so neither page names a legal entity. A generic template
  // would have — which is exactly why one wasn't used.
  for (const route of ["/privacy", "/terms"]) {
    await page.goto(route);
    await expect(page.getByText(/\b(Inc\.|LLC|Ltd\.?|GmbH|S\.L\.)\b/)).toHaveCount(0);
  }

  // The owner's explicit call (2026-08-14): the pages exist and are reachable,
  // but nothing advertises them until the open rows close and counsel has read
  // them. This asserts the *absence* on purpose — adding a footer link is a
  // decision, not a tidy-up, and a drive-by "you forgot the link" fails here.
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: /privacy/i })).toHaveCount(0);
  await expect(footer.getByRole("link", { name: /terms/i })).toHaveCount(0);
});
