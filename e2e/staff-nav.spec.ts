import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { STAFF_DAY_HEADING } from "./helpers";

/**
 * **The bar is three times** — ADR 20260919-one-idea, decision I · Tide, slice
 * 23b: "A date, a search and the shop's name in the bar — no tabs, no More, no
 * dock."
 *
 * What this spec used to cover was a nav of *nouns*: five primary tabs, a
 * "More" menu from `lg` up and a bottom sheet rising from a phone dock's sixth
 * slot, three consumers deriving twenty-one destinations from one registry
 * (ADR 20260813-more-is-the-shops-other-door). What it covers now is Today,
 * Week and Season, and the two things that have to stay true without the nav:
 * **everything else is reachable through the search**, and **a gated place is
 * absent rather than shown and refused** (ADR
 * 20260724-role-gated-surfaces-hide-not-explain).
 */

test.describe("owner", () => {
  signedInAsOwner();

  test("the bar wears three times, and the one you are on is lit", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const bar = page.locator("header").getByRole("navigation", { name: "When" });
    await expect(bar.getByRole("link")).toHaveText([/Today/, "Week", "Season"]);
    // The nouns are gone from the bar — all twenty-one of them. Divers and
    // Check-in are the two that were tabs longest, so they are the ones worth
    // naming rather than trusting the list above.
    for (const noun of ["Divers", "Check-in", "Board", "Orders", "More"]) {
      await expect(bar.getByRole("link", { name: noun, exact: true })).toHaveCount(0);
    }

    // **Not `exact`, because Today's badge is part of its name.** The blocked
    // count rides the pill, so the accessible name is "Today 20 divers
    // blocked" — an exact match on "Today" finds nothing. A substring match is
    // unambiguous in a bar of three, where the other two are Week and Season.
    await expect(bar.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");

    // A time is a link to a page, and the page behind it may be rebuilt
    // without this bar changing: Week is the board today and becomes the week
    // in 23f.
    await bar.getByRole("link", { name: "Week" }).click();
    await expect(page).toHaveURL(/\/schedule\/board$/);
    await expect(bar.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");
    await expect(bar.getByRole("link", { name: "Today" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a departure lights the week it sails in, because the board claims it", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    const bar = page.locator("header").getByRole("navigation", { name: "When" });
    await page
      .getByRole("main")
      .getByRole("link")
      .filter({ hasText: /Reef|Wreck|Night/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/trips\//);
    await expect(bar.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");
  });

  test("a page with no hour lights nothing, because it lives behind the shop's name", async ({
    page,
  }) => {
    // Settings, the gear register and the site library are `shop` — the one
    // place with no time in it. A bar of three times has no pill for them, and
    // that is the design rather than a gap.
    for (const suffix of ["/settings", "/gear", "/dive-sites"]) {
      await page.goto(`/shop/blue-mantis${suffix}`);
      const bar = page.locator("header").getByRole("navigation", { name: "When" });
      await expect(bar.getByRole("link")).toHaveCount(3);
      await expect(bar.locator("[aria-current='page']")).toHaveCount(0);
    }
  });

  test("Settings is behind the shop's own name, which is the only door it has", async ({
    page,
  }) => {
    // "Only Settings has no hour and lives behind the shop's name" (ADR
    // 20260919-one-idea, decision I · Tide). It lived here once and left when
    // the nav's More groups arrived, because a second door would have been a
    // duplicate control — there is no nav now, and no second door.
    await page.goto("/shop/blue-mantis");
    await expect(page.locator("header").getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.locator("header [data-identity-menu]").click();
    await page.locator("header").getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("everything that is not one of the three is reached through the search", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");
    // The search is a control in the bar, not a keyboard shortcut — ADR
    // 20260813-more-is-the-shops-other-door retired an earlier bar for making
    // fourteen destinations ⌘K-only, and that finding outlived the bar.
    await page.locator("header").getByRole("button", { name: "Search" }).click();
    await page.getByRole("combobox").fill("Orders");
    await page
      .getByRole("option", { name: /Orders/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/orders$/);
  });

  /**
   * **The one thing the search finds that has no hour** — ADR
   * 20260919-one-idea, decision I · Tide, slice 23e: "a diver with no booking
   * has no hour; the search finds them, and their record opens as a sheet over
   * the day."
   *
   * Every other destination the search offers is a place, and taking the
   * staffer to it is the answer. A person is not: the question is usually one
   * glance, and paying for it with the day they were reading — the boats, the
   * blockers, the hour they were standing in — is the trade this slice refuses.
   */
  test("a diver the search finds is laid over the day, not opened instead of it", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");
    await page.locator("header").getByRole("button", { name: "Search" }).click();
    await page.getByRole("combobox").fill("Priya");
    // `exact`, because a person's name is also the text of every seat they
    // hold: a loose match took whichever row the ranking happened to put up,
    // which was a booking on a departure. The diver row is the one whose whole
    // accessible name is the person.
    await page.getByRole("option", { name: "Priya Sharma", exact: true }).first().click();

    // Still the day, with the diver over it — the URL says so, and so does the
    // fact that the day's own heading is still on the page behind the sheet.
    await expect(page).toHaveURL(/\/shop\/blue-mantis\?diver=[0-9a-f-]+$/);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();

    // **It is a reading, and its one door is the record.** Every act on a
    // diver redirects with a `?notice=`, which would tear the sheet off the
    // screen — so the sheet offers none and points at the page that does.
    await expect(sheet.getByRole("link", { name: /Open the full record/ })).toBeVisible();

    // Closing puts the staffer back on the day they never left, and takes the
    // param with it so a refresh does not reopen what they just closed.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
  });

  /**
   * **A `?diver=` is not a key to anything.** It is the one param on this page
   * that names a person, so the two ways of writing one by hand both have to
   * end in a day with nobody over it: an id that is not a uuid, which is
   * narrowed before it reaches a query, and a well-formed one that names
   * nobody *of this shop* — the same answer `getDiverProfile` gives for
   * another tenant's diver, which is what makes a copied URL worth nothing
   * (`src/db/divers.test.ts`, "does not open another shop's live diver").
   *
   * The day rendering is half the assertion: a 404 or a 500 here would be a
   * different bug wearing the same green.
   */
  test("a diver id that names nobody leaves the day with nobody over it", async ({ page }) => {
    for (const id of ["not-a-uuid", "6f1c9a2e-0b3d-4f5a-8c7e-1d2a3b4c5d6e"]) {
      const response = await page.goto(`/shop/blue-mantis?diver=${id}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("the demoted doors on owning surfaces still hold", async ({ page }) => {
    // The monthly report keeps its door on the Orders header — the same
    // money, summed.
    await page.goto("/shop/blue-mantis/orders");
    await expect(page.getByRole("link", { name: "Monthly report" })).toBeVisible();
  });
});

test.describe("captain", () => {
  signedInAs("captain");

  test("a gated time is absent from the bar, not shown and refused", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const bar = page.locator("header").getByRole("navigation", { name: "When" });
    // Season is Reports, which is gated. A captain's bar is two pills — the
    // honest picture, rather than a third that refuses when tapped.
    await expect(bar.getByRole("link")).toHaveText([/Today/, "Week"]);
    await expect(bar.getByRole("link", { name: "Season" })).toHaveCount(0);
  });

  test("the search offers a captain only what their role can open", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await page.locator("header").getByRole("button", { name: "Search" }).click();
    // Named one by one rather than left to a list's length, so a gate is
    // asserted rather than implied.
    for (const gated of ["Waivers", "Reports", "Team", "Promo codes", "Settings"]) {
      await page.getByRole("combobox").fill(gated);
      await expect(page.getByRole("option", { name: gated, exact: true })).toHaveCount(0);
    }
    // **Requests and the Inbox are not on that list, and the pairing is the
    // point.** Both gates were deleted rather than relaxed (issues #1505/#1518
    // on 2026-09-10 and #1679 on 2026-09-16, H-14 amendments): the inbox shows
    // this same captain a stranger's address and message and lets them answer
    // as the shop, so "these carry contact details for people who have not
    // booked" had stopped telling the two surfaces apart.
    for (const open of ["Requests", "Inbox"]) {
      await page.getByRole("combobox").fill(open);
      await expect(page.getByRole("option", { name: open, exact: true }).first()).toBeVisible();
    }
  });
});

test.describe("the phone", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 } });

  test("has no dock — a name, a date and a search, which is what the artboard draws", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");

    // The dock was a fixed bottom tab bar whose sixth slot raised a sheet.
    // Nothing stands at the bottom edge now.
    await expect(page.locator("[data-dock-more]")).toHaveCount(0);
    // And the three times do not *stand* here: at 390px they are folded, so
    // nothing wearing them is on screen until the date is tapped.
    await expect(
      page.getByRole("navigation", { name: "When" }).filter({ visible: true }),
    ).toHaveCount(0);

    // What a thumb has instead — `Tide.dc.html`'s pocket, left to right.
    await expect(page.locator("header [data-identity-menu]")).toBeVisible();
    await expect(page.locator("header [data-place-menu]")).toBeVisible();
    await expect(page.locator("header").getByRole("button", { name: "Search" })).toBeVisible();
  });

  test("folds the three times into the date, and they are the same three", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    await page.locator("header [data-place-menu]").click();
    const when = page.getByRole("navigation", { name: "When" });
    await expect(when.getByRole("link")).toHaveText([/^Today/, "Week", "Season"]);
    // The same one is lit as on the desk bar: the day, because that is where
    // this page sits.
    await expect(when.getByRole("link", { name: /^Today/ })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await when.getByRole("link", { name: "Week" }).click();
    await expect(page).toHaveURL(/\/schedule\/board$/);

    // And the fold knows where the reader went: reopened on the board, Week
    // is lit and Today is not.
    await page.locator("header [data-place-menu]").click();
    await expect(when.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");
    await expect(when.getByRole("link", { name: /^Today/ })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("reaches everything that is not a time through the search", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const search = page.locator("header").getByRole("button", { name: "Search" });
    await search.click();
    await page.getByRole("combobox").fill("Divers");
    await page
      .getByRole("option", { name: /Divers/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/divers$/);
  });
});

/**
 * The other half of what the dock bought: with the tabs off the header, a
 * phone header holds the logo, the shop's name, the date and the search, and
 * the name gets whatever the row has left. It kept a 10rem clamp from before
 * that — a shop whose name ran past about twenty characters read as "Blue
 * Horizon Dive Ch…" with 80px of empty header beside it.
 *
 * **What is asserted is the absence of a cap, not that any one name fits.**
 * This used to demand that "Blue Horizon Dive Charters" render whole, which
 * was true of a bar with two controls in it and stopped being true when the
 * three times folded into a third (ADR 20260919-one-idea, slice 23b): at
 * 390px that name now gives up its last eleven pixels, which is flex doing
 * its job rather than a clamp doing its worst. So the measurements are the two
 * that tell those apart — the name is wider than the clamp ever allowed, and
 * there is no idle space between where it ends and the next control begins.
 *
 * Driven against a freshly onboarded shop because the seeded demo shop's name
 * is short enough to fit either way — the clamp is invisible until a name is
 * long enough to hit it.
 */
test.describe("a long shop name on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the header one row, however long the shop calls itself", async ({ page }) => {
    const unique = `long-name-${Date.now()}`;
    await page.goto("/onboard");
    await page
      .locator('input[name="shopName"]')
      .filter({ visible: true })
      .fill("Blue Horizon Dive Charters");
    await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
    await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
    await page
      .locator('input[name="ownerEmail"]')
      .filter({ visible: true })
      .fill(`${unique}@example.com`);
    await page
      .locator('input[name="ownerPassword"]')
      .filter({ visible: true })
      .fill("trial-pass-123");
    await page.getByRole("button", { name: "Create shop & start trial" }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${unique}$`));

    const name = page
      .locator("header [data-identity-menu] span")
      .filter({ hasText: /Blue Horizon/ });
    await expect(name).toHaveText("Blue Horizon Dive Charters");
    // **At rest**, said out loud rather than assumed. This measures the bar's
    // resting width, and since ADR 20260907-nothing-from-nowhere's fold the
    // name gives way as the page scrolls — so a page that arrives at a restored
    // or redirected scroll offset (this one lands at 24px) is measured a fifth
    // of the way through a fold, and the name is legitimately clipped there.
    // The assertion below is about the top of the page; this is what puts it
    // there.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() =>
        page
          .locator("[data-chrome-shop-name]")
          .first()
          .evaluate((el) => Number(getComputedStyle(el).opacity)),
      )
      .toBe(1);
    // Wider than the 10rem clamp that used to cut it.
    const width = await name.evaluate((el) => ({
      shown: el.clientWidth,
      wants: el.scrollWidth,
    }));
    expect(width.shown).toBeGreaterThan(160);

    // Taking the width must not cost a second header row: past the point where
    // the name genuinely runs out of room it truncates, and the flex row never
    // wraps the search buttons under it.
    const trigger = page.locator("header [data-identity-menu]");
    const date = page.locator("header [data-place-menu]");
    const search = page.locator("header").getByRole("button", { name: "Search" });
    const [triggerBox, dateBox, searchBox] = await Promise.all([
      trigger.boundingBox(),
      date.boundingBox(),
      search.boundingBox(),
    ]);
    if (!triggerBox || !dateBox || !searchBox) throw new Error("header controls have no box");

    // And nothing is being held back: whatever the name does not get, the row
    // has already spent. This is the clamp's actual signature — a truncated
    // name with empty header beside it — and it fails on a cap of any size,
    // where a fixed width only fails on the one that was shipped. Measured
    // from the identity control rather than from the name, because the caret
    // that opens it is part of the control and not idle space; what is left
    // between the two is the row's own two gaps (8px each) and nothing else.
    const idle = dateBox.x - (triggerBox.x + triggerBox.width);
    expect(idle).toBeLessThan(24);
    expect(Math.abs(triggerBox.y - searchBox.y)).toBeLessThan(triggerBox.height);
    expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(searchBox.x);
    // And nothing spilled sideways off the phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});

/**
 * **The title folds into the bar** — ADR 20260907-nothing-from-nowhere,
 * decision 5, slice 18e (issue #1422).
 *
 * `e2e/visual.spec.ts` photographs the folded bar; these are the two things a
 * photograph cannot answer. First, whether the words are on screen twice for a
 * screen reader — the folded label is a copy of the page's `<h1>`, so the bar's
 * accessible name has to stay the shop's and the heading has to stay the only
 * announced one. Second, whether a page that never fills the slot still folds
 * its shop name away and leaves a bar holding nothing but a mark.
 */
test.describe("the folding title", () => {
  signedInAsOwner();

  const PHONE = { width: 390, height: 844 };
  /**
   * Twice the fold's own range. `animation-range: 0 120px` in globals.css, so
   * anything past 120 is the folded end state; 240 leaves room for the page to
   * be a few pixels shorter than it was measured at without landing mid-fold.
   */
  const FOLD_SCROLL_PX = 240;
  // `.first()`: the attribute marks the shop's name *and* the caret beside it,
  // because a caret with no label is pointing at nothing. They fold together,
  // so reading either one reads the fold.
  const opacityOf = (page: import("@playwright/test").Page, selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((node) => Number(getComputedStyle(node).opacity));

  test("hands the bar the page's name without saying it twice", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
    // The portal fills the slot after mount; its text is what the fold reveals.
    await expect(page.locator("[data-chrome-title-slot]")).toHaveText("Divers");

    // **At rest the bar is exactly what it has always been.** The label is
    // present in the DOM and costs the row nothing: no width, no opacity.
    //
    // Polled, for the same reason the folded state below is: the fold is a
    // scroll progress timeline, and a timeline attaches when the animation
    // does rather than when the markup parses. Read once, between hydration
    // and that attach, the shop name computes at the *other* keyframe — 0 at a
    // scroll offset of zero, which is the one thing this pair says cannot
    // happen. Both spellings of it were seen: `[data-chrome-title-slot]` empty
    // because the portal had not mounted, and both opacities 0 because it had
    // and the timeline had not. One in six locally, on main, and once on CI.
    //
    // Not a timeout widened — there is still no duration anywhere in this
    // test. The end state is the assertion, here as below; what changed is
    // that the at-rest end state is now waited for rather than assumed to be
    // the first thing rendered.
    await expect
      .poll(() => opacityOf(page, "[data-chrome-shop-name]"), {
        message: "the shop’s name never settled at rest",
      })
      .toBe(1);
    expect(await opacityOf(page, "[data-chrome-title-slot]")).toBe(0);

    /*
     * **The page has to be able to scroll before a scroll means anything.**
     *
     * This list streams in behind its own `loading.tsx` (`instant = true`),
     * while the heading and the slot both belong to the shell — so every wait
     * above is satisfied with the skeleton still standing in for the rows. A
     * skeleton shorter than the viewport makes `scrollTo` a no-op: the scroll
     * stays at 0, the timeline stays at progress 0, and the fold never starts.
     * Eight seconds of opacity 0 then reads exactly like a timeline that never
     * attached, which is what it looked like on CI (shard 4/4, 2026-09-19) —
     * green here and on main, six local repeats.
     *
     * Not a timeout widened: there is still no duration in this test. This
     * waits for the *precondition the scroll below spends*, in the same spirit
     * as the at-rest poll above.
     */
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), {
        message: "the page never grew tall enough for the fold to have a clock",
      })
      .toBeGreaterThanOrEqual(FOLD_SCROLL_PX);

    await page.evaluate((y) => window.scrollTo(0, y), FOLD_SCROLL_PX);
    // The scroll *is* the clock, so a scroll that did not move is the failure
    // — said here, rather than arriving below as an unexplained opacity.
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)), {
        message: "the page did not scroll, so the fold had no clock to run on",
      })
      .toBe(FOLD_SCROLL_PX);

    // Waiting on the end state itself, not on a duration — the scroll is the
    // clock, so there is no duration to wait out.
    await expect
      .poll(() => opacityOf(page, "[data-chrome-title-slot]"), {
        message: "the page’s title never folded into the bar",
      })
      .toBe(1);
    expect(await opacityOf(page, "[data-chrome-shop-name]")).toBe(0);

    // **The word is on screen twice and announced once.** The label is
    // `aria-hidden`, so the shop's name is still what names the menu button and
    // the page's own heading is still the only "Divers" a screen reader meets.
    await expect(page.getByRole("button", { name: /Blue Mantis Divers/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Divers", exact: true })).toHaveCount(1);
  });

  /**
   * **The one exemption the global kill-switch could not deliver.**
   * `globals.css`'s universal reduced-motion block overrides
   * `animation-duration`, `-delay` and `-iteration-count` — every one a
   * statement about *time*, and an animation on a scroll progress timeline
   * takes none of its progress from time. Without a rule naming
   * `animation-timeline` this reader would still get the fold, and at a 0.01ms
   * duration it would snap in within the first fraction of a pixel of scroll:
   * louder than the motion the setting asked to remove. Asserted in a browser
   * because that claim is about the cascade, not about the source.
   */
  test("gives a reduced-motion reader the bar exactly as it ships", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(PHONE);
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 400));

    // Well past the 120px range, and nothing has folded.
    expect(await opacityOf(page, "[data-chrome-shop-name]")).toBe(1);
    expect(await opacityOf(page, "[data-chrome-title-slot]")).toBe(0);
    expect(await opacityOf(page, "[data-chrome-fold-title]")).toBe(1);
  });

  /**
   * The four departure surfaces carry their own `TripPageHeader`, which fills
   * no slot. Without the `:not(:empty)` gate in `globals.css` the shop's name
   * would still fade out on them and the bar would end up holding a mark and a
   * blank — a regression on a page that never asked for the feature.
   */
  test("leaves the bar alone on a page that fills no slot", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/shop/blue-mantis/schedule/board");
    // Into a departure, which is where `TripPageHeader` lives. Clicked rather
    // than addressed by id: the board is the door a staffer uses, and the id
    // is the seed's to choose.
    const departure = await page
      .locator('a[href*="/shop/blue-mantis/trips/"]')
      .first()
      .getAttribute("href");
    if (!departure) throw new Error("the board listed no departure to open");
    await page.goto(departure);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    // Empty, not absent: the staff bar always renders the slot, and it is this
    // page declining to fill it that the `:not(:empty)` gate reads. `toBeEmpty`
    // rather than a `waitFor`, which would wait for visibility on an element
    // that is deliberately zero-width and transparent.
    await expect(page.locator("[data-chrome-title-slot]")).toBeEmpty();

    await page.evaluate(() => window.scrollTo(0, 240));
    await expect
      .poll(() => opacityOf(page, "[data-chrome-shop-name]"), {
        message: "the shop’s name gave way to a label that was never there",
      })
      .toBe(1);
  });
});
