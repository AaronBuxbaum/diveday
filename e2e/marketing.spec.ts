import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { earlyAccessPrice } from "../src/lib/marketing";
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
  // Exactly three demo buttons (nav, hero, closing) — the five-chip role
  // picker is gone from the hero (role switching is the in-demo switcher's
  // job), and the mid-page door retired on 2026-08-13 when the page's three
  // consecutive banded CTAs merged into one close, putting the closing door a
  // full band nearer (docs/product/marketing.md). The nav's own door is the
  // marketing header's single CTA slot on every page (#934, "The two doors,
  // and which one leads") — it carries the demo everywhere, not just here.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(3);
  // Still three after the evening moment row landed on 2026-08-28: that row
  // carries no link and no button, deliberately (the recap is something a
  // shop's divers receive, not a screen a visitor is sent to poke), so the
  // band grew a third of the page's height and spent none of the door budget
  // (docs/product/marketing-review-20260827.md).
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

  // The flat price reaches the first screen as a *sentence*
  // (docs/product/marketing-review-20260827.md, "The price reaches the first
  // screen"). The two counts above are the budget it had to arrive inside, so
  // this assertion sits under them deliberately: it is the reason they are
  // re-read on every copy change. A "See pricing" link here would answer the
  // same question and cost the budget a door.
  const heroPriceLine = heroSection.getByText(/^One flat price —/);
  await expect(heroPriceLine).toBeVisible();
  await expect(heroPriceLine).toContainText("No cut of your bookings.");
  await expect(heroPriceLine.getByRole("link")).toHaveCount(0);
  await expect(heroPriceLine.locator("button")).toHaveCount(0);

  // The dock note intentionally rises 20px into the phone's lower edge. The
  // phone's entrance animation creates a stacking context, so the note must
  // explicitly sit above it or its eyebrow and first line are painted under
  // the bezel (the regression shown in the homepage hero screenshot).
  await expect(heroSection.getByText("At the dock", { exact: true }).locator("..")).toHaveCSS(
    "z-index",
    "10",
  );

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
  // The storefront's h1 is the shop, not the word "Schedule" (ADR
  // 20260827-clearwater-surface-language, decision 8).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blue Mantis Divers");
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

  // The flat price renders twice from src/lib/marketing.ts — never a prose
  // literal — so a buyer doesn't have to click through to learn whether this is
  // a hundred-dollar tool or an enterprise quote form. It reached the hero on
  // 2026-08-28 (docs/product/marketing-review-20260827.md); the closing band
  // keeps the two-year lock, which is the detail a reader wants at the ask
  // rather than at the door.
  await expect(page.getByText(/^One flat price —/)).toHaveCount(2);
  await expect(page.getByText(/locked for two years for founding shops/)).toBeVisible();
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

test("the homepage's day reaches the evening, and answers mid-season where it disqualifies", async ({
  page,
}) => {
  await page.goto("/");

  // The moments band is the whole day, and until 2026-08-28 it ended at 8 a.m.
  // — booking, readiness, stop — which left the product's own thesis (the shop
  // gets remembered) with no home on `/` at all
  // (docs/product/marketing-review-20260827.md, "A third moment: the
  // evening"). The band is the second section of the page; the hero is first.
  const momentsBand = page.getByRole("main").locator("section").nth(1);
  await expect(
    momentsBand.getByRole("heading", {
      name: "The desk clears it in the morning. The captain sees it at the dock.",
    }),
  ).toBeVisible();
  await expect(
    momentsBand.getByRole("heading", { name: "Divers go home with a page worth sharing" }),
  ).toBeVisible();
  // The clause that makes this a revenue argument rather than an
  // administrative one: the shop's name is on the artifact the diver sends.
  await expect(
    momentsBand.getByText("with your shop's name on the thing they send their buddy."),
  ).toBeVisible();
  // The screen is the claim in every row of this band, so the recap is shown,
  // not described — and named for a screen reader by a label the *caller*
  // resolves from the bundle, never an English literal in the component.
  await expect(momentsBand.getByRole("img", { name: /recap page/i })).toBeVisible();

  // **The silence this row was built around.** It carries no link and no
  // button: the recap is something a shop's divers receive after a trip, not a
  // screen a visitor is sent to go poke, so the band still offers exactly one
  // door — the diver row's preview — and the page's demo-button count did not
  // move (asserted at 3 in the hero test above). A row that grew a CTA would
  // need a funnel tag and would spend the page's door budget on the one band
  // that is not asking for anything.
  await expect(momentsBand.getByRole("link")).toHaveCount(1);
  await expect(momentsBand.getByRole("link")).toHaveText("See a diver's booking page →");
  await expect(momentsBand.locator("button:not([disabled])")).toHaveCount(0);

  // Mid-season is answered in the column that raises it. A shop reading "bring
  // your records in clean" in August is doing the arithmetic of switching
  // mid-season, and the four-phase move rail that answers it lives on a
  // switching guide this reader may never open.
  const arrivingColumn = page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Coming in" }) })
    .filter({ has: page.getByRole("link", { name: "Your spreadsheet, column by column →" }) })
    .last();
  const midSeason = arrivingColumn.getByText(/^Mid-season isn't a problem:/);
  await expect(midSeason).toBeVisible();
  await expect(midSeason).toContainText("an afternoon, not a project plan.");
  // It is the guides' own shared key rendered here, not a homepage wording of
  // the same promise — the rule marketing.md states one namespace over for the
  // export claim. `src/lib/marketing.test.ts` pins the key's home; this pins
  // that the words actually reach the band.
  await expect(midSeason).toContainText(
    "a second import updates your divers instead of duplicating them",
  );
});

test("public marketing pages lead to the product and pricing details", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Who's booked, who's cleared, who's on the boat — one answer, all day.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Product" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();

  // The portability story is a first-class band on the homepage, and it reads
  // in both directions — records arrive cleanly and leave the same way, which
  // is the reason to join, not a goodbye.
  await expect(
    page.getByRole("heading", { name: "Bring your records in clean. Keep them useful." }),
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
  // The offline claim is answered here, beside the screen it is about, and
  // nowhere else. /pricing carried a second copy of it as a FAQ row until
  // 2026-08-28 — a product question wearing pricing clothes, on a page whose
  // rows are the ones that decide the purchase
  // (docs/product/marketing-review-20260827.md). This assertion is where that
  // deleted row's claim moved, not a new one: the pricing block below used to
  // hold it.
  await expect(page.getByText(/The crew saves the manifest to their phone/)).toBeVisible();
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
  // The hero says what the trip holds together, in the reader's own terms. It
  // opened "DiveDay is organized around the trip itself:" until 2026-08-28 — a
  // sentence about the software's shape, spent on the page's second-most-read
  // line (docs/product/marketing-review-20260827.md, diagnosis 1: the flattest
  // claims sit where the reader actually is). The consequence half is what
  // moved in: asked twice, missed once.
  await expect(
    page.getByText(
      /Every booking, waiver, certification, payment, and head count stays attached to the trip it belongs to/,
    ),
  ).toBeVisible();
  // The honest-no scope block and the demo CTA both land on the product page —
  // five demo doors: the nav (every marketing page's single CTA), the hero
  // (the most evaluation-intent click on the site must offer proof above the
  // fold), mid-page after the dock story, under the capability index, and the
  // closing band. The index door landed on 2026-08-28: the band's lede dares
  // the reader to go do any of these lines in the demo right now, and the page
  // had no way to spend that intent for another two bands
  // (docs/product/marketing-review-20260827.md, "the dare gets a door").
  await expect(page.getByRole("heading", { name: "What DiveDay doesn't do." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(5);

  // Each door added beside the page's original pair carries its own funnel
  // tag. Folded into `product` neither could be shown to have earned its place
  // among ten sections; the hero and closing pair keep the page's original tag
  // so their history holds.
  // Scoped through `<main>` for the same reason the sign-up test is: a previous
  // route's hidden `input[name="source"]` stays reachable while Activity keeps
  // it in the DOM, and a raw `page.locator` would count it.
  const productMain = page.getByRole("main");
  await expect(productMain.locator('input[name="source"][value="product-mid"]')).toHaveCount(1);
  await expect(productMain.locator('input[name="source"][value="product-index"]')).toHaveCount(1);
  await expect(productMain.locator('input[name="source"][value="product"]')).toHaveCount(2);
  await expect(
    productMain.locator('a[href="/onboard?from=product-mid"]'),
    "the mid-page trial link is tagged like its demo twin",
  ).toHaveCount(1);
  await expect(
    productMain.locator('a[href="/onboard?from=product-index"]'),
    "the index door's trial link is tagged like its demo twin",
  ).toHaveCount(1);
  // And the door stands where the dare is made, not somewhere the reader has
  // to go looking for it: inside the band the capability list closes.
  const indexBand = productMain
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "The whole list, plainly." }) });
  await expect(indexBand.locator('input[name="source"][value="product-index"]')).toHaveCount(1);

  // The money band states the figure instead of parking it behind its own
  // link. It read "What DiveDay itself costs →" until 2026-08-28 — an
  // unlabeled door on the one band about money, which is exactly what a burned
  // buyer reads as a card wall (docs/product/marketing-review-20260827.md,
  // diagnosis 2). Interpolated from `earlyAccessPrice`, never a prose literal:
  // `src/lib/marketing.test.ts` pins the key as one that must carry {price}
  // and {cadence}, and this is the render of it.
  const moneyLink = productMain.getByRole("link", { name: /^One flat / });
  await expect(moneyLink).toBeVisible();
  // The figure itself, read out of the one source rather than typed here: a
  // price change must move this render, not this assertion. And it is proof
  // the interpolation ran — the stored message carries `{price}`.
  await expect(moneyLink).toContainText(earlyAccessPrice.price);
  await expect(moneyLink).toHaveAttribute("href", "/pricing");
  // Still one door, not two: the number arrives inside the link that already
  // existed rather than beside it (docs/product/marketing.md, "The budget
  // binds controls, not facts").
  const moneyBand = productMain.locator("section").filter({
    has: page.getByRole("heading", {
      name: "The money runs through your Stripe account, not ours.",
    }),
  });
  await expect(moneyBand.locator("a, button:not([disabled])")).toHaveCount(1);
  // The closing band's door onto the switching surface carries its own tag too
  // (2026-08-15). It was bare while the homepage's two were tagged, so the
  // number that answers "does the spreadsheet audience need a direct door" was
  // about to be read against a denominator missing this page — the one a reader
  // reaches *after* the homepage convinced them.
  await expect(
    productMain.getByRole("link", { name: /See how DiveDay reads your spreadsheet/ }),
  ).toHaveAttribute("href", "/switching/spreadsheet?from=product-spreadsheet");

  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(
    page.getByRole("heading", { name: "One flat price for the whole shop." }),
  ).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();
  // And the terms stand at the figure and at the door, which is the whole of
  // this slice (docs/product/marketing-review-20260827.md, "the terms never
  // stand at the doors"). The lock is a restatement of a binding commercial
  // commitment (H-12) directly under the number it qualifies; it used to be
  // reachable only through the included list and a FAQ row. It names its
  // subject — the price, not the reader — because this is the fine-print slot
  // a burned buyer scans for the catch.
  await expect(
    page.getByText("Today's price, locked for two years for founding shops."),
  ).toBeVisible();
  // The trial's own terms, at both decision points — free, three weeks, no
  // card, and the soft expiry that src/lib/trial.ts actually implements. The
  // demo note beside it answers only for the demo, so before this the trial
  // button carried no terms at all.
  const trialTerms = page.getByText(
    "The trial is a shop of your own — free for 3 weeks, no card, and nothing switches off when the window ends.",
  );
  await expect(trialTerms).toHaveCount(2);
  // The offline row is gone from this page's FAQ, deliberately — the claim
  // lives on /product, asserted above.
  await expect(page.getByRole("heading", { name: "Does the manifest work offline?" })).toHaveCount(
    0,
  );
  // The two rows that replaced it answer questions the price itself raises.
  await expect(
    page.getByRole("heading", { name: "Do I pay more as my crew grows?" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "How long does setup take?" })).toBeVisible();

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
  // Case-insensitive: the attribution now opens the row's last breath unit,
  // because the second "the size of it is unpublished" announcement went — the
  // row's first four words already say it.
  await expect(page.getByText(/third parties report that fee at around 6%/i)).toBeVisible();
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
  // exact per-page synonym drift the one-label rule exists to catch. Three of
  // them: the nav, the hero, and the close, which is the funnel's own rule
  // that both doors appear in every closing band (docs/product/marketing.md,
  // "The two doors, and which one leads").
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(3);

  // And the demo *leads*: first in the DOM, primary weight, with the trial
  // behind it. This page carried them the other way round under the same two
  // labels, so a visitor told on the homepage that the demo was the thing to
  // do found the emphasis reversed one tap later. The order is now decided in
  // one component (src/app/_components/FunnelCtas.tsx), not per page.
  const priceHeroDoors = page.getByRole("main").locator("section").first().locator("a, button");
  await expect(priceHeroDoors.first()).toHaveText("Try the live demo");
  await expect(priceHeroDoors.nth(1)).toHaveText("Start a trial");
  // The trial terms are a sentence, not a third door. When a page owes a
  // reader a fact at a door it states it rather than opening another one
  // (docs/product/marketing.md, "The budget binds controls, not facts") — and
  // this assertion is what stops the note growing a "See the terms" link that
  // would re-order the two above it.
  await expect(trialTerms.first().locator("a, button")).toHaveCount(0);
  await expect(trialTerms.last().locator("a, button")).toHaveCount(0);

  // The page closes on the number it opened with, and that closing door is
  // tagged apart from the hero's. Without it there was no trial door below
  // the fold at all — the header carries the demo now, not the trial (#934)
  // — so a reader who scrolled the objection layer had nothing left to act
  // on. Tagged like `product-mid`, so the position can be shown to have
  // earned its place rather than folding into the page's own bucket
  // (src/lib/funnel.ts).
  await expect(page.getByRole("heading", { name: "That's our whole price." })).toBeVisible();
  const pricingMain = page.getByRole("main");
  // Visible, not merely present: `toHaveCount` passes on a `display:none`
  // anchor, and a closing door nobody can see is the bug this one exists to
  // fix rather than a fix for it.
  await expect(pricingMain.getByRole("link", { name: "Start a trial" }).last()).toBeVisible();
  await expect(pricingMain.locator('a[href="/onboard?from=pricing-close"]')).toHaveCount(1);
  await expect(pricingMain.locator('a[href="/onboard?from=pricing"]')).toHaveCount(1);
  // The demo is offered at the close too, and tagged for that position. It
  // used to be dropped here, leaving the higher-friction door alone at the
  // moment the reader is warmest (issue #785).
  const closingBand = pricingMain.locator("section").last();
  await expect(closingBand.getByRole("button", { name: "Try the live demo" })).toBeEnabled();
  await expect(closingBand.locator('input[name="source"]')).toHaveValue("pricing-close");

  // The switching guides' door out of the FAQ. Without it the footer is the
  // only path to /switching from this page, and the row's href and label are
  // one optional pair in the page's own type precisely so half of it cannot go
  // missing — which renders no link at all, silently.
  await expect(page.getByRole("link", { name: "Browse the switching guides →" })).toHaveAttribute(
    "href",
    "/switching",
  );
});

/**
 * The pin for the 2026-08-28 slice that put a door under `/product`'s
 * capability index: **one primary control per screen**, and it has to hold
 * across *every* screen of the page rather than at the door that was added
 * (docs/product/marketing.md, "One primary CTA per screen"; roadmap 12d).
 *
 * `/product` is the page where that budget is easiest to lose. It is the
 * longest of the marketing surfaces, it now offers the demo from four places
 * inside `<main>`, and each of those doors was added by a different review
 * answering a different objection — which is exactly the shape that produced
 * the homepage hero's nine choices before they were cut back.
 *
 * The primary is the demo submit: every enabled `<button>` on this page is one
 * (the mockups' controls are `disabled` scenery). So the budget is countable
 * without reading a class name — the fragile way to ask which control is
 * "primary" — and a second primary anywhere would land in the same band as the
 * first and fail here.
 */
test("/product holds one primary per screen across all four of its doors", async ({ page }) => {
  await page.goto("/product");
  const main = page.getByRole("main");

  // Four doors inside the page body — hero, mid-page after the dock story,
  // under the capability index, and the closing band. The nav's own demo door
  // is outside `<main>` and is deliberately secondary weight so it never
  // competes (docs/product/marketing.md, "The two doors, and which one leads").
  await expect(main.locator("button:not([disabled])")).toHaveCount(4);

  // …and no band holds two of them. Every `<section>` is checked, nested ones
  // included: the capability index's seven group sections sit inside the band
  // that carries the new door, so a door that drifted into a group row would
  // read as two primaries in one screen and fail here.
  const sections = main.locator("section");
  const sectionCount = await sections.count();
  expect(sectionCount).toBeGreaterThan(8);
  for (let index = 0; index < sectionCount; index += 1) {
    const band = sections.nth(index);
    const primaries = await band.locator("button:not([disabled])").count();
    expect(primaries, `band ${index} offers more than one primary`).toBeLessThanOrEqual(1);
    // And where there is a primary there is exactly one secondary trial link
    // beside it — the pair is one component and a page chooses only where it
    // sits (src/app/_components/FunnelCtas.tsx). A band that grew a second
    // trial link would be a third choice at one moment of decision.
    if (primaries === 1) {
      await expect(band.locator('a[href^="/onboard?from="]')).toHaveCount(1);
    }
  }

  // The four doors are four *positions*, one tag each, so which moment
  // converted can be read apart from the page total (src/lib/funnel.ts).
  const tags = await main
    .locator('input[name="source"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value).sort());
  expect(tags).toEqual(["product", "product", "product-index", "product-mid"]);
});

test("the sign-up form answers the hesitation it creates", async ({ page }) => {
  // The trial link carries the page that sent it, so demo-vs-trial can be read
  // per surface; the form hands that tag back to the action.
  await page.goto("/pricing");
  // Scoped to `<main>`: the header's own CTA is the demo now, not a trial
  // link (#934), and the page closes with a second trial door tagged
  // `pricing-close`, so `.first()` inside `<main>` is unambiguously the hero's.
  await page.getByRole("main").getByRole("link", { name: "Start a trial" }).first().click();
  await expect(page).toHaveURL(/\/onboard\?from=pricing$/);
  // A hidden input can't be scoped with `.filter({ visible: true })` (it would
  // never match), and the previous route's own `input[name="source"]` (this
  // page's FunnelTag) stays reachable while Activity keeps it in the DOM — so
  // scope through the current page's own `<main>` landmark instead, which
  // `getByRole` (visibility-safe, see e2e/fixtures.ts) narrows to the one
  // that's actually on screen.
  await expect(page.getByRole("main").locator('input[name="source"]')).toHaveValue("pricing");

  // Asking for a password is the moment of maximum hesitation, so the door
  // answers it — in one sentence, not the four claims this line used to join
  // together (ADR 20260827-first-light, decision 1). The half that earns it is
  // the second: "free for 3 weeks" alone never says what happens on day 22,
  // and a buyer who has been burned reads an unanswered window as a card wall
  // (docs/product/marketing-review-20260827.md).
  await expect(
    page.getByText("Free for 3 weeks, no card — and nothing switches off when the window ends."),
  ).toBeVisible();
  // The three claims it replaced keep their paragraphs on the marketing pages
  // the visitor came from; the door repeats none of them.
  await expect(page.getByText("No card, no setup fee.")).toHaveCount(0);
  await expect(page.getByText("Your records are ready from day one.")).toHaveCount(0);
  await expect(page.getByText("Real support, one email away.")).toHaveCount(0);
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
  // …and the door out of that band is tagged, like every other in-page
  // switching door (2026-08-15). The nav and footer ones stay bare on purpose:
  // they render on every marketing page, so one tag across them answers
  // nothing (src/lib/funnel.ts).
  await expect(
    page.getByRole("main").getByRole("link", { name: /How switching works, both directions/ }),
  ).toHaveAttribute("href", "/switching?from=about-switching");

  // No fabricated proof anywhere on the page a buyer reads for credibility.
  const rendered = await page.locator("body").innerText();
  for (const pattern of [/trusted by/i, /\d+\+? (shops|customers|divers) (use|trust)/i]) {
    expect(rendered, `unfounded social proof matching ${pattern}`).not.toMatch(pattern);
  }

  // Demo-before-trial, same funnel order as every other marketing page.
  // Scoped to `<main>`: the nav carries its own demo button on every marketing
  // page (#934), so an unscoped locator here would resolve to two.
  const aboutMain = page.getByRole("main");
  await expect(aboutMain.getByRole("button", { name: "Try the live demo" })).toBeVisible();
  await expect(aboutMain.getByRole("link", { name: "Start a trial" }).last()).toBeVisible();
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
  await expect(
    page
      .getByRole("heading", { name: "Bring the file into DiveDay" })
      .locator("..")
      .getByRole("link", { name: "Start a trial" }),
  ).toHaveAttribute("href", "/onboard?from=switching-eve-mid");

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
  // Four doors out, and only four: the nav, the hero, the hinge between the
  // argument and the mechanics, and the close.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(4);
  await expect(
    page.getByRole("heading", { name: "Rather see it than read about it?" }),
  ).toBeVisible();

  // The scope table is the importer's honesty table — a claimed waiver
  // acceptance is trusted, medical clearance included, and marked imported.
  await expect(page.getByText("Signed waivers & medical clearance", { exact: true })).toBeVisible();
  await expect(page.getByText("Stays behind").first()).toBeVisible();
  // Specialty cards moved into the green column and say what waits on staff.
  await expect(
    page.getByText("Specialty certifications (deep, wreck, night, drysuit)"),
  ).toBeVisible();

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

test("help arrives before the homework on a switching guide", async ({ page }) => {
  // The 2026-08-27 conversion review's third diagnosis: the concierge — free,
  // personal, product-owner authorized — sat about 80% down every guide, under
  // the rail that makes switching look like a project, and `/about` spent its
  // strongest impulse on a mailto. This test is the placement half of the fix,
  // which is the half no copy review can see: every sentence below already
  // existed somewhere on these pages, and the change is entirely about which
  // screen a reader meets them on.
  await page.goto("/switching/eve");

  // The lede leads with the wedge the page itself documents rather than with a
  // neutral description of where the data lives. "Shops report" is the same
  // attribution the third context paragraph carries — the compressed form may
  // not sharpen past its citation (marketing.md's claims policy).
  const eveMain = page.getByRole("main");
  await expect(eveMain.getByText(/database on one back-office PC/)).toBeVisible();
  await expect(eveMain.getByText(/shops report the history is the hard part/)).toBeVisible();

  // The move rail's opening line now carries the alternative to running it
  // yourself, in the same breath as the work.
  const moveTitle = page.getByRole("heading", { name: "How the move works" });
  await expect(moveTitle).toBeVisible();
  const moveIntro = eveMain.getByText(/Rather hand it off\?/);
  await expect(moveIntro).toBeVisible();
  await expect(moveIntro).toContainText("a person brings your divers in with you, free");

  // …and it is *above* the full offer, not a replacement for it. The
  // `SwitchingConcierge` block stays on every switching page (marketing.md's
  // claims policy); this is the compressed form arriving first.
  const conciergeHeading = page.getByRole("heading", {
    name: /switch you on — and off — ourselves/,
  });
  await expect(conciergeHeading).toBeVisible();
  const introBox = await moveIntro.boundingBox();
  const conciergeBox = await conciergeHeading.boundingBox();
  expect(introBox?.y ?? 0).toBeLessThan(conciergeBox?.y ?? 0);

  // The fifth cutover step reads first, because its own words place it there
  // ("before you move a single record"). The rail renders `steps` in array
  // order, so an edit that appends it instead lands here.
  const cutoverPhase = page
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: "Cutover without drama" }) })
    .first();
  const cutoverSteps = await cutoverPhase.getByRole("heading", { level: 4 }).allInnerTexts();
  expect(cutoverSteps).toHaveLength(5);
  expect(cutoverSteps[0]).toBe("Let the crew walk their screens first");
  await expect(cutoverPhase.getByText(/the same roles your dock does/)).toBeVisible();

  // The owner call the review recorded and left open: a leave-it guide carries
  // no forward link to /pricing. The single allowed one lives in the coexist
  // guides' leave-path box (marketing.md, decided 2026-08-14), and these guides
  // have no coexist block — so this renders nothing, deliberately, until
  // somebody decides otherwise. Scoped to <main>: the nav and footer carry
  // their own pricing links on every marketing page.
  await expect(eveMain.locator('a[href^="/pricing"]')).toHaveCount(0);

  // The second leave-it lede, same rule: DiveShop360's opens on the export
  // limit its own FAQ documents, and every clause is on the page below it.
  await page.goto("/switching/diveshop360");
  const dsMain = page.getByRole("main");
  await expect(dsMain.getByText(/the four CSVs its own FAQ names/)).toBeVisible();
  await expect(dsMain.getByText(/no bulk export, no API/).first()).toBeVisible();
  await expect(dsMain.locator('a[href^="/pricing"]')).toHaveCount(0);

  // The spreadsheet guide has no incumbent to cut over from, so it renders no
  // cutover rail at all — and with it, none of the parallel-run answer that
  // rail's steps give. That is why the note lives on its import phase instead.
  await page.goto("/switching/spreadsheet");
  await expect(page.getByRole("heading", { name: "Cutover without drama" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Let the crew walk their screens first" }),
  ).toHaveCount(0);
  const importPhase = page
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: "Bring the file into DiveDay" }) })
    .first();
  await expect(importPhase.getByText(/Keep the sheet going as long as you like/)).toBeVisible();
  await expect(importPhase.getByText(/matches divers by email/)).toBeVisible();

  // The tone fix on the wedge that opens this guide: the sheet is described by
  // what it does, never judged. The retired sentence is pinned out by name, the
  // way the apologetics list below is, because it shipped as a line its author
  // thought was charming.
  const sheetMain = page.getByRole("main");
  await expect(
    sheetMain.getByText(/A spreadsheet remembers everything and checks nothing/),
  ).toBeVisible();
  await expect(sheetMain.getByText(/bad teammate/)).toHaveCount(0);
});

test("the homepage's spreadsheet door survives, tagged, and lands on the columns it promises", async ({
  page,
}) => {
  // **This test exists because nothing pinned that link.** It was deleted by a
  // redesign on 2026-08-13 — three consecutive banded CTAs merged into one
  // close and took the records band's direct door to the spreadsheet guide with
  // them — and not one assertion in this suite failed. It was restored by hand
  // on 2026-08-15; a second redesign would remove it exactly as quietly. The
  // hub link is pinned in the same breath for the same reason.
  await page.goto("/");

  const spreadsheetDoor = page
    .getByRole("main")
    .getByRole("link", { name: "Your spreadsheet, column by column →" });
  // The whole href, not just the path. The `?from=` tag is what makes the door
  // measurable, and measurability is the entire reason it came back — an
  // untagged link is a silent regression of the same size as a missing one,
  // and it cannot be seen by eye on a rendered page. `#columns` is the other
  // half: the link's words promise the column table, which is three blocks
  // below where a bare path lands (src/lib/funnel.ts, switchingHref).
  await expect(spreadsheetDoor).toHaveAttribute(
    "href",
    "/switching/spreadsheet?from=home-records-arriving#columns",
  );
  // The band's other door, to the hub that forks to every incumbent guide.
  // Which of the two a spreadsheet shop takes is the question the pair was
  // split to answer, so neither may quietly lose its tag.
  await expect(
    page.getByRole("main").getByRole("link", { name: /Read the guides →$/ }),
  ).toHaveAttribute("href", "/switching?from=home-records");

  await spreadsheetDoor.click();
  await expect(page).toHaveURL(/\/switching\/spreadsheet\?from=home-records-arriving#columns$/);
  // Wait for the guide's own body rather than the segment's skeleton, then ask
  // where the reader is. Two assertions, in that order, because they fail for
  // different reasons and the messages should say which: `toBeVisible` is "the
  // streamed body landed", `toBeInViewport` is "the anchor took the reader
  // there". Neither is a timing guess — both retry against what the destination
  // page itself renders.
  const columns = page.getByRole("heading", { name: "Does your sheet have these columns?" });
  await expect(columns).toBeVisible();
  // Landed on what the words promised — not merely on a page that contains it.
  // This is the one an `id` on the phase can fail: drop the anchor and this
  // heading is two to three screens below the fold, behind the hero, the wedge
  // list and the mid-page CTA.
  await expect(columns).toBeInViewport();
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
  await expect(
    page
      .getByRole("heading", { name: "Bring the file into DiveDay" })
      .locator("..")
      .getByRole("link", { name: "Start a trial" }),
  ).toHaveAttribute("href", "/onboard?from=switching-spreadsheet-mid");

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
  // (The nav's own door is the fourth, on every marketing page.)
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(4);
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
      english: "Who's booked, who's cleared, who's on the boat — one answer, all day.",
      spanish:
        "Quién reservó, quién está listo, quién sube al barco — una sola respuesta, todo el día.",
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
  //
  // Anchored to the <dt> rather than to the text. `getByText` matches a
  // case-insensitive *substring*, and the page's opening paragraph ends "where
  // something is still being decided it says so instead of guessing" -- so the
  // plain text locator matched two elements and failed strict mode. Asserting
  // the term is also the better assertion: what matters is that the retention
  // question is a labelled entry in the list, not that the phrase appears
  // somewhere on a long page.
  await expect(page.getByRole("term").filter({ hasText: "Still being decided" })).toBeVisible();

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
