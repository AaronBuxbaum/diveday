import { FEATURE_PAGE_SLUGS, featurePagePath } from "../src/lib/feature-pages";
import { capabilityGroup, earlyAccessPrice, productCapabilityIndex } from "../src/lib/marketing";
import { expect, test } from "./fixtures";
import { ONBOARD_FORM_PATH } from "./servers";

/**
 * Every public "Get set up" door: a mail to the onboarding inbox, because every
 * shop is set up by hand (ADR 20260925-shops-are-set-up-by-hand). There is no
 * self-serve sign-up for a marketing page to link to.
 */
const SET_UP_HREF = "mailto:onboarding@dive.day?subject=Set%20up%20my%20shop%20on%20DiveDay";

test("the homepage hero offers one demo door, and states the price at it", async ({ page }) => {
  await page.goto("/");

  // One site-wide name for the demo CTA — the hero used to say "Try the
  // staff app" (jargon a first-time visitor can't parse, and a different
  // label than every other page gave the same action). `.first()` targets
  // the hero; the closing band repeats the same label deliberately.
  await expect(page.getByRole("button", { name: "Try the live demo" }).first()).toBeVisible();
  // The click's cost is stated at the point of decision, scoped to the demo —
  // it must not promise "no sign-up" on behalf of the set-up link beside it.
  await expect(
    page
      .getByText("The demo opens a working sample shop in one click. No sign-up and no card.")
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
  // Still three since the 2026-10-05 rework (H-93): the steps under the hero
  // each link to their feature page, whose own door opens the demo on
  // that step's screen, so the band spends none of this page's door budget.
  // The old label is gone site-wide, not merely replaced here: one action
  // wearing two names is what the single-label rule exists to stop, and the
  // rename has to stay renamed (docs/product/marketing.md, Voice).
  await expect(page.getByRole("button", { name: "Try the staff app" })).toHaveCount(0);

  // Hero decision density: one primary action, at most one secondary. The hero
  // once offered ~9 (a five-chip role picker, the diver preview, demo, trial),
  // and every retired destination moved rather than disappeared — the roles
  // into the in-demo switcher, the preview onto the online booking page's own
  // door. The mockup's "Mark boarded" buttons are `disabled` scenery, not
  // doors, so the count is of things a visitor can actually act on.
  const heroSection = page.getByRole("main").locator("section").first();
  await expect(heroSection.locator("button:not([disabled])")).toHaveCount(1);
  await expect(heroSection.getByRole("link")).toHaveCount(1);
  await expect(heroSection.getByRole("link")).toHaveAttribute("href", SET_UP_HREF);

  // The flat price reaches the first screen as a *sentence*
  // (docs/product/marketing-review-20260827.md, "The price reaches the first
  // screen"). The two counts above are the budget it had to arrive inside, so
  // this assertion sits under them deliberately: it is the reason they are
  // re-read on every copy change. A "See pricing" link here would answer the
  // same question and cost the budget a door.
  const heroPriceLine = heroSection.getByText(/^One flat price of/);
  await expect(heroPriceLine).toBeVisible();
  await expect(heroPriceLine).toContainText("no cut of your bookings.");
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
});

test("the homepage answers price and offers a way to ask before the footer", async ({ page }) => {
  await page.goto("/");

  // The flat price renders twice from src/lib/marketing.ts — never a prose
  // literal — so a buyer doesn't have to click through to learn whether this is
  // a hundred-dollar tool or an enterprise quote form. It reached the hero on
  // 2026-08-28 (docs/product/marketing-review-20260827.md); the closing band
  // keeps the two-year lock, which is the detail a reader wants at the ask
  // rather than at the door.
  await expect(page.getByText(/^One flat price of/)).toHaveCount(2);
  await expect(page.getByText(/locked for two years for founding shops/)).toBeVisible();
  await expect(page.getByRole("link", { name: "See what’s included →" })).toHaveAttribute(
    "href",
    "/pricing",
  );

  // The contact band: a hesitant buyer who won't self-serve a demo or trial
  // gets a visible human path — not just an unlabeled address in the footer.
  await expect(page.getByRole("heading", { name: "Ask us first" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Email support@dive\.day/ })).toHaveAttribute(
    "href",
    "mailto:support@dive.day",
  );
});

test("the homepage follows one booking to the boat and home, a feature page per step", async ({
  page,
}) => {
  await page.goto("/");

  // Since 2026-10-05 (H-93) the band under the hero is one booking, followed
  // from the shop's website to the boat and home again: five steps, each the
  // screen that does it, two of the builder's notes, and the feature page that
  // tells the rest. (Check-in at the counter was a sixth until review cut it
  // the same day: its screen read as the readiness step's twin.) It replaced four annotated screens whose headline
  // described the page rather than what a shop gets. The band is the second
  // section of the page; the hero is first.
  const stepsBand = page.getByRole("main").locator("section").nth(1);
  await expect(
    stepsBand.getByRole("heading", {
      level: 2,
      name: "One booking, from your website to the boat and home again.",
    }),
  ).toBeVisible();
  // Each step's own name, from the copy column that is every row's first
  // child (the alternation is `order`, not DOM order). The screens beside them
  // draw headings of their own ("Find your next dive"), which a screen reader
  // never hears inside a `role="img"` but a heading query still finds.
  await expect(stepsBand.locator("ol > li > div:first-child h3")).toHaveText([
    "A diver books and pays without calling the shop",
    "They sign the release and answer the medical form at home",
    "Anyone who can’t board yet is named, with the reason",
    "The crew calls the roll by name, signal or not",
    "Each diver gets the day’s recap, under your shop’s name",
  ]);
  // The screen is the claim in every step, so each one is shown rather than
  // described, and named for a screen reader by a label the *caller* resolves
  // from the bundle, never an English literal in the component.
  await expect(stepsBand.getByRole("img")).toHaveCount(5);
  await expect(stepsBand.getByRole("img", { name: /recap page/i })).toBeVisible();
  // The roll-call step draws the checkpoint the hero's phone does not: the
  // same saved copy after the first dive, so the page shows the boat coming
  // back as well as leaving (design review, 2026-10-05).
  await expect(stepsBand.getByRole("img", { name: /roll call after dive 1/i })).toBeVisible();

  // Each step ends in its feature page, in the booking's order, and none of
  // them is a door into the demo: the page it links to opens the demo on that
  // very screen, as the role that uses it, which a door here could only do by
  // repeating it.
  const stepPages = await stepsBand
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(stepPages).toEqual(
    (["online-booking", "waivers", "certifications", "boat-manifest", "messages"] as const).map(
      (slug) => featurePagePath(slug),
    ),
  );
  await expect(stepsBand.locator("button:not([disabled])")).toHaveCount(0);
  await expect(stepsBand.locator('input[name="source"]')).toHaveCount(0);
});

test("the homepage lists every feature page, filed by when its job falls", async ({ page }) => {
  await page.goto("/");

  // The page's answer to "does it do X?": every feature page, under the part
  // of a shop's year it serves, read off the registry, so a page added there
  // is listed here without this page naming it.
  const directory = page
    .getByRole("main")
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "What the whiteboard, the clipboard and the three apps did, in one plan.",
      }),
    });
  await expect(directory.getByRole("heading", { level: 3 })).toHaveText([
    "Before the dive day",
    "On the day",
    "Across the season",
  ]);
  const listed = await directory
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  // …and it ends on the hub's full list, landing on the rows that hold every
  // page's lines rather than on the hub's hero above the same directory.
  expect(listed).toEqual([
    ...FEATURE_PAGE_SLUGS.map((slug) => featurePagePath(slug)),
    "/product#full-list",
  ]);

  await directory.getByRole("link", { name: /^Rental gear/ }).click();
  await expect(page).toHaveURL(/\/product\/rental-gear$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the homepage answers mid-season where it disqualifies", async ({ page }) => {
  await page.goto("/");

  // Mid-season is answered in the column that raises it. A shop reading "bring
  // your records in clean" in August is doing the arithmetic of switching
  // mid-season, and the four-phase move rail that answers it lives on a
  // switching guide this reader may never open.
  const arrivingColumn = page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Coming in" }) })
    .filter({ has: page.getByRole("link", { name: "Your spreadsheet, column by column →" }) })
    .last();
  const midSeason = arrivingColumn.getByText(/^Mid-season is fine\./);
  await expect(midSeason).toBeVisible();
  await expect(midSeason).toContainText("Budget an afternoon for it.");
  // It is the guides' own shared key rendered here, not a homepage wording of
  // the same promise — the rule marketing.md states one namespace over for the
  // export claim. `src/lib/marketing.test.ts` pins the key's home; this pins
  // that the words actually reach the band.
  await expect(midSeason).toContainText(
    "second import updates your divers instead of duplicating them",
  );
});

test("public marketing pages lead to the product and pricing details", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Every diver booked, signed, checked and accounted for.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Product" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();

  // The portability story is a first-class band on the homepage, and it reads
  // in both directions — records arrive cleanly and leave the same way, which
  // is the reason to join, not a goodbye.
  await expect(
    page.getByRole("heading", { name: "How records arrive, and how they leave." }),
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
      level: 1,
      name: "From the first booking to the roll call after the last dive.",
    }),
  ).toBeVisible();
  // The full capability index, the thing a buyer comparing DiveDay against
  // an incumbent's feature page goes looking for, lives in the directory's
  // rows since 2026-10-05 and is counted under them.
  await expect(page.getByText(/^There is one plan, with all \d+ workflows in it\.$/)).toBeVisible();

  // The hub is the directory of the feature pages (H-93), and the offline
  // claim lives on the one it is about, beside its screen, and nowhere else.
  // /pricing carried a second copy of it as a FAQ row until 2026-08-28 — a
  // product question wearing pricing clothes (docs/product/marketing-review-
  // 20260827.md) — and `/product`'s dock chapter held it until 2026-10-05.
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Boat manifest and roll call/ })
    .click();
  await expect(page).toHaveURL(/\/product\/boat-manifest$/);
  // The hero's lede, beside the screen: the page's how-it-works steps say it
  // again further down, where it is the first step rather than the claim.
  await expect(
    page
      .getByRole("main")
      .locator("section")
      .first()
      .getByText(/saves the next two days’ manifests/),
  ).toBeVisible();

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
  // One group per feature page since 2026-10-05 (H-93), under that page's
  // own row of the directory, then the three groups no page owns.
  const fullList = page.locator("#full-list");
  await expect(fullList.getByRole("heading", { name: "Also in the plan" })).toBeVisible();
  await expect(fullList.locator("summary").filter({ hasText: /^Your records/ })).toBeVisible();
  // The product hero has the same decision budget as the homepage hero: the
  // live demo and trial are its two doors, while the price is a fact stated
  // under them rather than a third way out to /pricing.
  const productMain = page.getByRole("main");
  const productHero = productMain.locator("section").first();
  await expect(productHero.locator("button:not([disabled])")).toHaveCount(1);
  await expect(productHero.getByRole("link")).toHaveCount(1);
  const productHeroPrice = productHero.getByText(/^One flat price of/);
  await expect(productHeroPrice).toBeVisible();
  await expect(productHeroPrice).toContainText(earlyAccessPrice.price);
  await expect(productHeroPrice).toContainText("no cut of your bookings.");
  await expect(productHeroPrice.locator("a, button")).toHaveCount(0);
  // The hero says what DiveDay runs, then what each row below holds. It was
  // five annotated screens of the day from 2026-09-24 until 2026-10-05, when
  // each feature got its own page and this one became their directory (H-93).
  await expect(productHero.getByText(/^Booking, waivers, certification checks/)).toBeVisible();
  // The demo CTA lands on the product page — three demo doors: the nav (every marketing page's single CTA), the hero
  // (the most evaluation-intent click on the site must offer proof above the
  // fold), and the closing band. A fourth stood under the capability index
  // from 2026-08-28 (docs/product/marketing-review-20260827.md, "the dare gets
  // a door") until the index folded into the directory's rows on 2026-10-05,
  // and the mid-page door after the dock story left with the story.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(3);

  // Each door added beside the page's original pair carries its own funnel
  // tag. Folded into `product` neither could be shown to have earned its place
  // among ten sections; the hero and closing pair keep the page's original tag
  // so their history holds.
  // Scoped through `<main>` for the same reason the sign-up test is: a previous
  // route's hidden `input[name="source"]` stays reachable while Activity keeps
  // it in the DOM, and a raw `page.locator` would count it.
  await expect(productMain.locator('input[name="source"][value="product-mid"]')).toHaveCount(0);
  await expect(productMain.locator('input[name="source"][value="product-index"]')).toHaveCount(0);
  await expect(productMain.locator('input[name="source"][value="product"]')).toHaveCount(2);
  // Every demo door has its set-up mail beside it (two), and there is no
  // self-serve trial link left to tag.
  await expect(productMain.locator(`a[href="${SET_UP_HREF}"]`)).toHaveCount(2);
  await expect(productMain.locator('a[href^="/onboard"]')).toHaveCount(0);

  // The index is a reference, not the page's argument, so it is closed at rest
  // (2026-09-17): a count under each feature page's row, and a row of its own
  // for each group no page owns, with the lines themselves one keystroke away.
  // Flat it ran ~2,900px of a 9,600px page, arriving after the argument had
  // already finished; as a band of its own it repeated the directory's twelve
  // names one band down, until review folded it into the rows (2026-10-05).
  const indexGroups = fullList.locator("details");
  await expect(indexGroups).toHaveCount(productCapabilityIndex.length);
  const firstGroup = indexGroups.first();
  const firstLine = firstGroup.locator("li").first();
  await expect(firstLine).toBeHidden();
  // Opened with the keyboard, because that is the half a disclosure can lose:
  // `<summary>` is focusable and Enter toggles it natively, and `e2e/a11y.spec.ts`
  // scans this page.
  await firstGroup.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(firstLine).toBeVisible();

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
    page.getByRole("heading", { name: "What a shop pays, line by line." }),
  ).toBeVisible();
  // The price as an invoice (2026-09-24): eight labelled lines under the
  // figure, beside the builder's notes on them, so the terms a buyer scans
  // for are on the first screen as a ledger rather than as prose.
  const invoice = page.getByRole("main").locator("dl[aria-label='The invoice']");
  await expect(invoice.getByRole("term")).toHaveCount(8);
  await expect(invoice.getByRole("term").filter({ hasText: "Cut of your bookings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes on the invoice" })).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();
  // And the terms stand at the figure and at the door, which is the whole of
  // this slice (docs/product/marketing-review-20260827.md, "the terms never
  // stand at the doors"). The lock is a restatement of a binding commercial
  // commitment (H-12) directly under the number it qualifies; it used to be
  // reachable only through the included list and a FAQ row. It names its
  // subject — the price, not the reader — because this is the fine-print slot
  // a burned buyer scans for the catch.
  await expect(
    page.getByText("Today’s price, locked for two years for founding shops."),
  ).toBeVisible();
  // The trial's own terms, at both decision points — free, three weeks, no
  // card, and the soft expiry that src/lib/trial.ts actually implements. The
  // demo note beside it answers only for the demo, so before this the trial
  // button carried no terms at all.
  const trialTerms = page.getByText(
    "The trial is a shop of your own: free for 3 weeks, no card, and nothing switches off when the window ends.",
  );
  await expect(trialTerms).toHaveCount(2);
  // The offline row is gone from this page's FAQ, deliberately — the claim
  // lives on the boat manifest page, asserted above.
  await expect(page.getByRole("heading", { name: "Does the manifest work offline?" })).toHaveCount(
    0,
  );
  // The two rows that replaced it answer questions the price itself raises.
  await expect(
    page.getByRole("heading", { name: "Do I pay more as my crew grows?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What do I have to do to get set up?" }),
  ).toBeVisible();

  // A flat price only means something next to the model it replaces, so the
  // page anchors against the per-booking fees the switching guides document —
  // each stated as the incumbent's own published terms (or, for FareHarbor,
  // explicitly as an unpublished rate third parties report), each linked to the
  // guide that carries the citation. No claim about what a shop pays in
  // practice and no savings arithmetic: we have no customers to know either.
  await expect(
    page.getByRole("heading", { name: "What two booking channels charge, in their own words." }),
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
  await expect(priceHeroDoors.nth(1)).toHaveText("Get set up");
  // The trial terms are a sentence, not a third door. When a page owes a
  // reader a fact at a door it states it rather than opening another one
  // (docs/product/marketing.md, "The budget binds controls, not facts") — and
  // this assertion is what stops the note growing a "See the terms" link that
  // would re-order the two above it.
  await expect(trialTerms.first().locator("a, button")).toHaveCount(0);
  await expect(trialTerms.last().locator("a, button")).toHaveCount(0);

  // The page closes on the number it opened with, and that closing door is
  // tagged apart from the hero's. Without it there was no second door below
  // the fold at all — the header carries the demo now, not the trial (#934)
  // — so a reader who scrolled the objection layer had nothing left to act
  // on. Tagged for its position, so it can be shown to have earned its place
  // rather than folding into the page's own bucket (src/lib/funnel.ts).
  await expect(page.getByRole("heading", { name: "That is the full price." })).toBeVisible();
  const pricingMain = page.getByRole("main");
  // Visible, not merely present: `toHaveCount` passes on a `display:none`
  // anchor, and a closing door nobody can see is the bug this one exists to
  // fix rather than a fix for it.
  await expect(pricingMain.getByRole("link", { name: "Get set up" }).last()).toBeVisible();
  await expect(pricingMain.locator(`a[href="${SET_UP_HREF}"]`)).toHaveCount(2);
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
 * `/product` is where that budget is easiest to lose: each of its doors was
 * added by a different review answering a different objection — which is
 * exactly the shape that produced the homepage hero's nine choices before
 * they were cut back. Two left on 2026-10-05: the one after the dock story,
 * with the story, and the one under the capability index, when the index
 * folded into the directory's rows. Two remain inside `<main>`.
 *
 * The primary is the demo submit: every enabled `<button>` on this page is one
 * (the hub draws no mockup since it became the feature pages' directory, and a
 * mockup's controls are `disabled` scenery anyway). So the budget is countable
 * without reading a class name — the fragile way to ask which control is
 * "primary" — and a second primary anywhere would land in the same band as the
 * first and fail here.
 */
test("/product holds one primary per screen across both of its doors", async ({ page }) => {
  await page.goto("/product");
  const main = page.getByRole("main");

  // Two doors inside the page body — the hero and the closing band. The nav's
  // own demo door is outside `<main>` and is deliberately secondary weight so
  // it never competes (docs/product/marketing.md, "The two doors, and which
  // one leads").
  await expect(main.locator("button:not([disabled])")).toHaveCount(2);

  // …and no band holds two of them. Every `<section>` is checked, so a door
  // that drifted into another band would read as two primaries in one screen
  // and fail here: the hero, the directory, and the close.
  const sections = main.locator("section");
  const sectionCount = await sections.count();
  expect(sectionCount).toBeGreaterThanOrEqual(3);
  for (let index = 0; index < sectionCount; index += 1) {
    const band = sections.nth(index);
    const primaries = await band.locator("button:not([disabled])").count();
    expect(primaries, `band ${index} offers more than one primary`).toBeLessThanOrEqual(1);
    // And where there is a primary there is exactly one secondary set-up link
    // beside it — the pair is one component and a page chooses only where it
    // sits (src/app/_components/FunnelCtas.tsx). A band that grew a second
    // one would be a third choice at one moment of decision.
    if (primaries === 1) {
      await expect(band.locator(`a[href="${SET_UP_HREF}"]`)).toHaveCount(1);
    }
  }

  // The hero and the close keep the page's original tag so their history
  // holds (src/lib/funnel.ts); `product-index` stays registered for the
  // history it collected, and no door carries it.
  const tags = await main
    .locator('input[name="source"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value).sort());
  expect(tags).toEqual(["product", "product"]);
});

test("a visitor who wants a shop is sent to a person, not a sign-up form", async ({ page }) => {
  // Every shop is set up by hand (ADR 20260925-shops-are-set-up-by-hand): the
  // pricing page's second door is a mail to the onboarding inbox.
  await page.goto("/pricing");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Get set up" }).first(),
  ).toHaveAttribute("href", SET_UP_HREF);

  // And the old address, from a bookmark or a search result, is a closed door
  // that says where to write — with no form, and nothing to submit.
  await page.goto("/onboard?from=pricing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We set up every shop by hand");
  await expect(page.getByRole("link", { name: "Email onboarding@dive.day" })).toHaveAttribute(
    "href",
    SET_UP_HREF,
  );
  await expect(page.locator('input[name="ownerPassword"]')).toHaveCount(0);
  // The one form left on the closed door is the demo, at link weight under the
  // mail that is the page's primary, with its own funnel tag (issue #1956). It
  // linked to `/` until 2026-10-06, sending a reader to find the demo again.
  const mainForms = page.getByRole("main").locator("form");
  await expect(mainForms).toHaveCount(1);
  const demoDoor = page.getByRole("main").getByRole("button", { name: "Try the live demo" });
  await expect(demoDoor).toBeVisible();
  await expect(demoDoor).not.toHaveClass(/bg-primary/);
  await expect(mainForms.locator('input[name="source"]')).toHaveValue("onboard-demo");
  // A wrong key is no key.
  await page.goto("/onboard?setup=not-the-key-not-the-key-not-the-key");
  await expect(page.locator('input[name="ownerPassword"]')).toHaveCount(0);
  // And the demo door opens the demo, not the homepage.
  await page.getByRole("main").getByRole("button", { name: "Try the live demo" }).click();
  await expect(page).toHaveURL(/\/shop\//);
});

test("the setup link opens the form, which answers the hesitation it creates", async ({ page }) => {
  await page.goto(`${ONBOARD_FORM_PATH}&from=pricing`);
  // The tag still reaches the form when the link carries one. Scoped to the
  // sign-up form: the footer's demo door carries a `source` of its own.
  const signUpForm = page.locator('form:has(input[name="ownerPassword"])');
  await expect(signUpForm.locator('input[name="source"]')).toHaveValue("pricing");
  // The footer's demo door stays link weight, so "Create shop & start trial"
  // is still the page's one primary (issue #1956).
  const demoDoor = page.getByRole("main").getByRole("button", { name: "Try the live demo" });
  await expect(demoDoor).toBeVisible();
  await expect(demoDoor).not.toHaveClass(/bg-primary/);
  await expect(
    page.locator('form:has(button:text-is("Try the live demo")) input[name="source"]'),
  ).toHaveValue("onboard-demo");

  // Asking for a password is the moment of maximum hesitation, so the door
  // answers it — in one sentence, not the four claims this line used to join
  // together (ADR 20260827-first-light, decision 1). The half that earns it is
  // the second: "free for 3 weeks" alone never says what happens on day 22,
  // and a buyer who has been burned reads an unanswered window as a card wall
  // (docs/product/marketing-review-20260827.md).
  await expect(
    page.getByText("Free for 3 weeks, no card, and nothing switches off when the window ends."),
  ).toBeVisible();
  await expect(page.getByText("No card, no setup fee.")).toHaveCount(0);
  await expect(page.getByText("Your records are ready from day one.")).toHaveCount(0);
  await expect(page.getByText("Real support, one email away.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create shop & start trial" })).toBeVisible();

  // An unrecognized tag is bucketed rather than echoed into the funnel.
  await page.goto(`${ONBOARD_FORM_PATH}&from=Not%20A%20Real%20Source`);
  await expect(signUpForm.locator('input[name="source"]')).toHaveValue("unknown");
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
  // "Your season doesn't hang on us." survived all four by stating the
  // reassurance as a fact about the shop's operation rather than a posture
  // about us. Since 2026-09-24 the page is written as speech (docs/design/
  // brand.md, "The spoken register on /about"): every heading is the owner's
  // question, repeated back without a mark, and that sentence is now the
  // first thing said under the H1 rather than the H1 itself — the reassurance
  // is still the answer, and the proof still follows it: the shop's own Stripe
  // account, the ZIP, roll call with no signal. The Stripe half is asserted
  // beside the headline because the headline alone would be the second failure
  // again.
  //
  // Since 2026-10-06 the page opens on why DiveDay exists (the Lonergans,
  // left behind on the Great Barrier Reef in 1998) and "Who am I dealing
  // with" is the band right under it, still closing on the same reassurance.
  await expect(
    page.getByRole("heading", { level: 1, name: "Why did you build this" }),
  ).toBeVisible();
  await expect(page.getByText(/Tom and Eileen Lonergan/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who am I dealing with" })).toBeVisible();
  await expect(page.getByText(/doesn’t hang on the two of us/)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "What’s the catch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DiveDay is new." })).toBeVisible();

  // Trust here is checkable, not asserted: each rule ships with the demo action
  // that proves it.
  await expect(
    page.getByRole("heading", { name: "How do I know any of that’s true" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "It has to work on the boat." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A blank field is never a yes." })).toBeVisible();
  await expect(page.getByText("open a manifest on your phone")).toBeVisible();

  // The checkable half comes *before* the conceding half. The rules used to sit
  // fourth, below two sections of prose, which put the page's only verifiable
  // content off the bottom of every screen a visitor actually saw. Asserted as
  // an order rather than a presence, because both blocks existed then too.
  const headings = await page.getByRole("heading", { level: 2 }).allInnerTexts();
  expect(headings.indexOf("How do I know any of that’s true")).toBeLessThan(
    headings.indexOf("What’s the catch"),
  );

  // A trust page that didn't land on the exit would be missing the point, and
  // the heading over that band has to *be* the exit answer rather than gesture
  // at it. It re-asked the founder band's question ("Who you're actually
  // buying from.") until slice 12f, and then spent one revision on a metaphor
  // ("What you're standing on.") that every incumbent could have pasted onto
  // their own site truthfully — the exact failure docs/product/marketing.md's
  // headline test says binds `/about` hardest. It then stated the plan terms
  // ("Month to month, and the export is one button.") until the page moved to
  // the spoken register on 2026-09-24: the heading is now the owner's exit
  // question, and the terms it used to carry are the first thing said under
  // it (src/app/about/copy.test.ts holds the arithmetic).
  await expect(
    page.getByRole("heading", { name: "What happens to my records if I go" }),
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

  // The impulse is spent where it is made (slice 12f;
  // docs/product/marketing-review-20260827.md, "help arrives after the
  // homework"). The rules band dares the reader to go and check four things,
  // and until 2026-08-28 the nearest thing to act on was a primary-weight
  // mailto two bands down, with the demo waiting past the founder story, the
  // concessions and the export terms. Scoped to `<main>`: the nav carries its
  // own demo button on every marketing page (#934).
  const aboutMain = page.getByRole("main");
  const rulesBand = aboutMain.locator("section").filter({
    has: page.getByRole("heading", { name: "How do I know any of that’s true" }),
  });
  await expect(rulesBand.getByRole("button", { name: "Try the live demo" })).toBeEnabled();
  await expect(rulesBand.locator(`a[href="${SET_UP_HREF}"]`)).toHaveCount(1);

  // …and the note that answers the only question that button raises, at the
  // page's *first* door (docs/product/marketing.md, "The demo's cost is stated
  // once per page, at the first door"). `/about` carried it nowhere at all
  // until 2026-08-28: a page that dares a buyer to go and check four things
  // and then offers an unlabeled button leaves them guessing whether the click
  // costs them their email address, which at the moment of maximum impulse
  // makes scrolling past it the safest move — and by the closing band the
  // impulse is spent.
  await expect(rulesBand.locator("p", { hasText: "No sign-up and no card" })).toHaveCount(1);
  // Once on the page, not under both doors. The answer is worth nothing the
  // second time — repeated under every demo button it stops reading as
  // reassurance and starts reading as insistence — so the closing band repeats
  // the door, not the note.
  await expect(aboutMain.locator("p", { hasText: "No sign-up and no card" })).toHaveCount(1);

  // Two positions, in DOM order, each tagged for itself — a reader who moved
  // at the proof is a different moment from one who read the whole page and
  // reached the close, and folded into one bucket neither could be read on its
  // own (src/lib/funnel.ts). Asserted as a list rather than a presence: the
  // page total is the thing this split exists to stop.
  const aboutTags = await aboutMain
    .locator('input[name="source"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
  expect(aboutTags).toEqual(["about-rules", "about-closing"]);

  // One primary per screen still holds with a second door on the page — the
  // pin `/product` earned when its fourth door landed
  // (docs/product/marketing.md, "One primary CTA per screen"). Every enabled
  // button in `<main>` is a demo submit; the phone mockup's controls are
  // `disabled` scenery, so the budget is countable without reading a class.
  await expect(aboutMain.locator("button:not([disabled])")).toHaveCount(2);
  const bands = aboutMain.locator("section");
  const bandCount = await bands.count();
  for (let index = 0; index < bandCount; index += 1) {
    const band = bands.nth(index);
    const primaries = await band.locator("button:not([disabled])").count();
    expect(primaries, `band ${index} offers more than one primary`).toBeLessThanOrEqual(1);
    // Where there is a primary there is exactly one set-up link beside it: the
    // pair is one component and a page chooses only where it sits
    // (src/app/_components/FunnelCtas.tsx).
    if (primaries === 1) {
      await expect(band.locator(`a[href="${SET_UP_HREF}"]`)).toHaveCount(1);
    }
  }

  // …which is what the support mailto gave up to make room. It is a real offer
  // and stays on the page, demoted to the secondary variant beside the pricing
  // door it now sits level with: `bg-primary` is the primary variant's own
  // fill (src/components/ui/button.ts), so its absence here is the demotion,
  // asserted where a reader would feel it rather than in a class list nobody
  // reads.
  const supportDoor = aboutMain.getByRole("link", { name: "Email support@dive.day" });
  // Anchored on both sides, or `hover:bg-surface-sunken` would satisfy it and
  // the assertion would pass on a button whose resting fill had changed.
  await expect(supportDoor).toHaveClass(/(^|\s)bg-surface(\s|$)/);
  await expect(supportDoor).not.toHaveClass(/bg-primary/);

  // The door beside it states the figure rather than parking it behind itself
  // — the same unlabeled-door fix `/product`'s money band took on 2026-08-28.
  // This band raises the cost question three times (the "One price, no seats."
  // rule sends the reader here to *check it*, the heading promises
  // straightforward pricing, the paragraph says the whole of it is on one
  // page) and answered it with "See what it costs", which a skeptic reading a
  // trust page reads as "they won't say"
  // (docs/product/marketing-review-20260827.md, diagnosis 2).
  const aboutPriceDoor = aboutMain.getByRole("link", { name: /^One flat / });
  await expect(aboutPriceDoor).toHaveAttribute("href", "/pricing");
  // The figure read out of the one source rather than typed here, which is
  // also the proof the interpolation ran: the stored message carries `{price}`
  // (`src/lib/marketing.test.ts` pins it among the keys that must).
  await expect(aboutPriceDoor).toContainText(earlyAccessPrice.price);
  // Still no new control on the page — the number arrived inside a door that
  // already existed (docs/product/marketing.md, "The budget binds controls,
  // not facts"), so the band's link count is unchanged and it still offers no
  // primary at all.
  // `has:` is resolved from the outer match, so it takes a page-rooted
  // locator rather than `aboutPriceDoor` — the same shape `rulesBand` uses.
  const runBand = aboutMain
    .locator("section")
    .filter({ has: page.getByRole("link", { name: /^One flat / }) });
  await expect(runBand.locator("button:not([disabled])")).toHaveCount(0);
  await expect(runBand.locator("a")).toHaveCount(3);
});

test("migration guides walk a shop from an incumbent export into the importer", async ({
  page,
}) => {
  // The switch surface is reachable from the footer on any marketing page.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Switch" }).click();

  await expect(
    page.getByRole("heading", { name: "Every guide ends at the same import screen." }),
  ).toBeVisible();

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
    page.getByRole("heading", { name: "What comes across, and what does not" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bring the file into DiveDay" })).toBeVisible();
  // …and the return trip, stated on the same page rather than left implied.
  // A guide that only walks a shop *out of* an incumbent sells a one-way door;
  // the scope table has to read in both directions, so the block that says so
  // is part of the guide's contract, not decoration.
  await expect(
    page.getByRole("heading", { name: "The same table, read the other way." }),
  ).toBeVisible();
  // Same guard as the spreadsheet guide: no shop session, no deep-link CTA —
  // and no second door in its place, since the concierge band already offers
  // a person to write to.
  await expect(page.getByRole("link", { name: "Open Import in your shop" })).toBeHidden();

  // A buyer can act from the hero, not only from the closing block seven
  // sections down: the demo form and the set-up link sit in the same section
  // as the h1, and the demo carries this guide's funnel tag. This is the
  // *buyer's* CTA — distinct from the deep-link above, which is for an owner
  // who already has a shop and is correct to stay hidden here.
  const heroSection = page.getByRole("main").locator("section").first();
  await expect(heroSection.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(heroSection.getByRole("button", { name: "Try the live demo" })).toBeEnabled();
  await expect(heroSection.getByRole("link", { name: "Get set up" })).toHaveAttribute(
    "href",
    SET_UP_HREF,
  );
  // Four doors out, and only four: the nav, the hero, the hinge between the
  // argument and the mechanics, and the close.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "See it in the live demo" })).toBeVisible();

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
    page.getByRole("heading", { name: "Keep FareHarbor. Add the day it can’t run." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Or leave the per-booking fee behind." }),
  ).toBeVisible();
  // The website ledger (slice 13e): what the shop pasted from FareHarbor
  // beside the DiveDay twin, the hosted-site figure rendered from its one
  // source with its attribution, and the built-to-order offer as a mail door.
  await expect(
    page.getByRole("heading", { name: "Leaving FareHarbor does not mean rebuilding your site." }),
  ).toBeVisible();
  await expect(page.getByText("Lightframe", { exact: true })).toBeVisible();
  await expect(page.getByText(/third parties report \$5,000 a year/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Or have us build the website." })).toBeVisible();
  // The concierge section further down carries the same words with a
  // ?subject=, so the offer's door is picked by its bare href.
  await expect(page.locator('a[href="mailto:switch@dive.day"]')).toHaveText(
    /Email us at switch@dive\.day/,
  );
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
    page.getByRole("heading", { name: "Keep Rezdy. Add the day it can’t run." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Or leave the monthly fee and the per-booking cut behind." }),
  ).toBeVisible();
  // No website ledger: Rezdy's footprint is a marketplace, not the shop's site.
  await expect(page.getByRole("heading", { name: /rebuilding your site/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Get your data out of Rezdy" })).toBeVisible();

  // An unlisted incumbent has no page — no coming-soon shells. This assertion
  // is content-level on purpose and no longer for want of a status one: the
  // status is asserted on its own below, for all three routes at once, because
  // that is the byte three issues chased without a test reading it.
  await page.goto("/switching/checkfront");
  await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
  // `.first()`: this route used to resolve a dynamic hole client-side after a
  // full navigation and insert a second, identical `<meta name="robots">` — a
  // harmless PPR-resolution duplicate, never a second differing directive.
  // `src/proxy.ts` now rewrites the request before the route renders at all
  // (issue #1734), so there is no hole left to resolve and the count may well
  // be one. `.first()` stays because the assertion is about the *directive*,
  // and pinning a count here would be asserting a framework detail this test
  // does not care about.
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", "noindex");
});

/**
 * **The public dynamic route outside `/s/**` answers a real 404** (issue
 * #1734, ADR 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * A status assertion rather than a heading assertion, and that is the whole
 * point of the test. Every one of these URLs already rendered the right
 * not-found page, so every heading assertion in `e2e/` was green for the entire
 * life of the soft 404 — the shell streamed at 200, the page's `notFound()`
 * landed in the body far too late to change a status line, and a crawler kept
 * the URL as a page worth re-fetching. `/s/**` was fixed and asserted in
 * `e2e/seo.spec.ts`; the guides were left, went on answering 200 for six more
 * weeks, and nothing anywhere went red. This is the assertion that can tell,
 * and it is a copy of that one's shape.
 *
 * **Twice.** `/switching/[competitor]` prerenders only its registered slugs, so
 * an unregistered one used to answer 200 on the first, cold hit and 404 only
 * once that path had resolved — a single probe could have called the bug fixed
 * while it was not. The edge decides before any of that, so both hits must
 * agree now.
 *
 * **The 200s are not decoration.** A guard that only proves unknown URLs are
 * refused is satisfied by refusing everything, which is the far worse bug: a
 * guide that is written. The spreadsheet guide is the sharpest of them — a shipped page whose slug is
 * deliberately not in `MIGRATION_GUIDE_SLUGS`, because a spreadsheet is not an
 * incumbent, so a `[competitor]`-shaped judgement of its path would 404 it.
 */
test("an unknown incumbent answers 404, not 200 with the not-found page", async ({ page }) => {
  for (const path of [
    // An incumbent with no guide. `checkfront` appears once in
    // `src/lib/migration-guides.ts`, inside a Rezdy source URL, and names no
    // guide.
    "/switching/checkfront",
  ]) {
    const cold = await page.request.get(path);
    expect(cold.status(), `${path} (cold hit)`).toBe(404);
    // A negative answer must never be pinned to a URL that later becomes real:
    // a guide gets written.
    expect(cold.headers()["cache-control"], path).toContain("no-store");
    // The same path again, resolved. Not a retry — both hits must answer 404,
    // and it is the *cold* one that used to be a 200.
    const warm = await page.request.get(path);
    expect(warm.status(), `${path} (second hit)`).toBe(404);
    expect(warm.headers()["cache-control"], path).toContain("no-store");
  }

  for (const path of ["/switching/eve", "/switching/spreadsheet"]) {
    expect((await page.request.get(path)).status(), path).toBe(200);
  }
});

test("an unknown feature page answers 404, and every listed one answers 200", async ({ page }) => {
  // The feature pages are a closed list (`src/lib/feature-pages.ts`), refused
  // at the edge like the switching guides above: a kiosk page was never built,
  // and a slug in the wrong case is not a page either.
  for (const path of ["/product/kiosk", "/product/Waivers"]) {
    const cold = await page.request.get(path);
    expect(cold.status(), `${path} (cold hit)`).toBe(404);
    expect(cold.headers()["cache-control"], path).toContain("no-store");
    const warm = await page.request.get(path);
    expect(warm.status(), `${path} (second hit)`).toBe(404);
  }

  for (const slug of FEATURE_PAGE_SLUGS) {
    const path = featurePagePath(slug);
    expect((await page.request.get(path)).status(), path).toBe(200);
  }
});

test("a feature page lists all of its feature and leads on to the next question", async ({
  page,
}) => {
  await page.goto("/product/waivers");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Waivers and medical forms come back signed before the diver walks in.",
  );
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Features" }),
  ).toHaveAttribute("href", "/product");

  // The first door says where the demo opens, and the price stands under it.
  const hero = page.getByRole("main").locator("section").first();
  await expect(hero).toContainText(
    "The demo opens on the release and every signed copy, as the owner.",
  );
  await expect(hero).toContainText(earlyAccessPrice.price);

  // The checklist is the page's whole group from the capability index, not a
  // selection: the list a buyer holds against a competitor's feature page.
  // It names only what is in it (the "What it doesn't do" rows were cut on
  // 2026-10-06), and how leaving works stands beside it with the price.
  const included = page
    .getByRole("main")
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "What’s in it" }) });
  await expect(included.getByRole("list")).toHaveCount(1);
  await expect(included.getByRole("listitem")).toHaveCount(capabilityGroup("waivers").items.length);
  await expect(included).toContainText(earlyAccessPrice.price);
  await expect(included).toContainText("Data export");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Questions shops ask" })).toBeVisible();
  await expect(main.getByText("How do minors sign?")).toBeVisible();

  await main.getByRole("link", { name: /^Certification checks/ }).click();
  await expect(page).toHaveURL(/\/product\/certifications$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Know who can board");
});

test("a feature page's demo door opens the demo on the screen the page is about", async ({
  page,
}) => {
  // The hero door on the rental gear page drops the visitor on the demo's own
  // gear register, as its owner, rather than on Today with the register two
  // taps away (`FeaturePage.demo`).
  await page.goto("/product/rental-gear");
  await page
    .getByRole("main")
    .locator("section")
    .first()
    .getByRole("button", { name: "Try the live demo" })
    .click();

  await expect(page).toHaveURL(/\/shop\/[^/]+\/gear$/);
  await expect(page.getByText("Demo shop")).toBeVisible();
});

test("the online booking page opens the demo as a diver, on a schedule with departures", async ({
  page,
}) => {
  // The diver preview. It left the homepage hero for the homepage's first
  // screen row when the role picker was retired (#328), and since 2026-10-05
  // it is the online booking page's own door: a diver has no staff page, so
  // the door names no landing and opens the public schedule of the shop it
  // just minted (`FeaturePage.demo`).
  await page.goto("/product/online-booking");
  await page
    .getByRole("main")
    .locator("section")
    .first()
    .getByRole("button", { name: "Try the live demo" })
    .click();

  await expect(page).toHaveURL(/\/s\/[^/?#]+$/);
  // Departures on it, not merely a page titled "Schedule". The door promises
  // a booking page, and the heading renders identically over the "No trips on
  // the books yet" empty state (ADR 20260812-demo-schedule-keeper).
  await expect(
    page.getByRole("list", { name: "Upcoming trips" }).getByRole("listitem").first(),
  ).toBeVisible();
  // The diver-facing schedule, not a staff console — no sign-in chrome.
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
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
  const moveIntro = eveMain.getByText(/rather hand it off/);
  await expect(moveIntro).toBeVisible();
  await expect(moveIntro).toContainText("a person brings your divers in with you, free");

  // …and it is *above* the full offer, not a replacement for it. The
  // `SwitchingConcierge` block stays on every switching page (marketing.md's
  // claims policy); this is the compressed form arriving first.
  const conciergeHeading = page.getByRole("heading", {
    name: /switch you on, and off, ourselves/,
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
    .filter({ has: page.getByRole("heading", { name: "Cutover without downtime" }) })
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
  await expect(page.getByRole("heading", { name: "Cutover without downtime" })).toHaveCount(0);
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
    sheetMain.getByText(/A spreadsheet holds the names and the numbers and checks none of them/),
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
    page.getByRole("main").getByRole("link", { name: /and one for a spreadsheet →$/ }),
  ).toHaveAttribute("href", "/switching?from=home-records");

  await spreadsheetDoor.click();
  await expect(page).toHaveURL(/\/switching\/spreadsheet\?from=home-records-arriving#columns$/);
  // Wait for the guide's own body rather than the segment's skeleton, then ask
  // where the reader is. Two assertions, in that order, because they fail for
  // different reasons and the messages should say which: `toBeVisible` is "the
  // streamed body landed", `toBeInViewport` is "the anchor took the reader
  // there". Neither is a timing guess — both retry against what the destination
  // page itself renders.
  const columns = page.getByRole("heading", { name: "The columns it reads" });
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
    page.getByRole("heading", { name: "Bring the spreadsheet with you." }),
  ).toBeVisible();

  // The three-part shape, reframed for a shop with no vendor to leave:
  // ready your own sheet, the shared scope table, the importer.
  await expect(page.getByRole("heading", { name: "The columns it reads" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What comes across, and what does not" }),
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
    page.getByRole("heading", { name: /switch you on, and off, ourselves/ }),
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
  await expect(spreadsheetHero.getByRole("link", { name: "Get set up" })).toHaveAttribute(
    "href",
    SET_UP_HREF,
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
    page.getByRole("heading", {
      name: "The preview reads your file back to you before a row is saved.",
    }),
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
    "/product/waivers",
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
    // shared link card applies. Every marketing page names DiveDay's card
    // (`sharedLinkCard` -> `src/app/link-card/route.tsx`), so today that is all
    // of them, and asserting the image beside the card type is what keeps the
    // pair honest: a large-image card with no image unfurls worse than a small
    // one. A segment with its own `opengraph-image.tsx` overrides it — see the
    // per-shop card in e2e/seo.spec.ts.
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
      english: "Every diver booked, signed, checked and accounted for.",
      spanish: "Cada buceador reservado, firmado, verificado y localizado.",
    },
    "/product": {
      english: "From the first booking to the roll call after the last dive.",
      spanish: "De la primera reserva al pase de lista después de la última inmersión.",
    },
    "/pricing": {
      english: "What a shop pays, line by line.",
      spanish: "Lo que paga un centro, línea por línea.",
    },
    // The three that still carried the fallback-is-the-body shape on
    // 2026-08-14 (FU-20260814-remaining-fallback-is-the-body-marketing-pages).
    // `/switching` renders its skeleton from an in-page `<Suspense>` rather
    // than a `loading.tsx`, because that file would also be the boundary for
    // `/switching/[competitor]`; the guarantee this test checks is the same
    // either way.
    "/switching": {
      english: "Every guide ends at the same import screen.",
      spanish: "Todas las guías terminan en la misma pantalla de importación.",
    },
    "/switching/spreadsheet": {
      english: "Bring the spreadsheet with you.",
      spanish: "Trae la hoja de cálculo contigo.",
    },
    "/about": {
      english: "Why did you build this",
      spanish: "Por qué lo construiste",
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

  test("/product's directory takes an es-ES reader to the feature they asked for", async ({
    page,
  }) => {
    // The acceptance case from the follow-up, and the reason the fix is worth
    // its skeleton: the directory is the page's whole table of contents, it is
    // the first interactive thing under the hero, and a tap on it is what the
    // old double render could spoil, landing in a subtree about to be thrown
    // away (FU-20260812-marketing-suspense-swap-discards-interaction). The
    // chapter strip that proved this until 2026-10-05 left with the chapters.
    await page.goto("/product");

    const entry = page
      .getByRole("main")
      .getByRole("link", { name: /^Manifiesto del barco y pase de lista/ });
    await expect(entry).toHaveAttribute("href", "/product/boat-manifest");
    await entry.click();
    await expect(page).toHaveURL(/\/product\/boat-manifest$/);
    // In Spanish, in the one and only body the page renders.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Pasa lista por nombre a cada buceador después de cada inmersión, con o sin señal.",
    );
  });
});

test("the legal pages are published, honest about what is unsettled, and reachable", async ({
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

  // **The footer is the only route to either page from anywhere on the site**
  // (#1649, merged 2026-09-10). This assertion used to demand the opposite:
  // the 2026-08-14 call was that the pages exist but nothing advertises them
  // until the open rows close, so a drive-by "you forgot the link" failed
  // here. #1649 reversed that call — the SES production-access case names both
  // by URL and tells the reviewer our privacy policy states AWS processes our
  // mail, which is a claim a reviewer checks by looking for the link. So the
  // link is now the thing this test protects, and removing it fails here.
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms");
});
