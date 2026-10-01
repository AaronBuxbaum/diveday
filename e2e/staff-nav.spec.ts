import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { ONBOARD_FORM_PATH } from "./servers";

/**
 * **The nav is the shop's sections, by name, always on screen** — ADR
 * 20261001-logbook, decision 1.
 *
 * A labelled sidebar from `lg` up and a bottom tab bar below it: Today,
 * Schedule, Divers, Inbox, Money, Courses and Gear when the shop uses them,
 * and Settings at the foot. The search is a shortcut to the same places, never
 * the only door, and **a gated section is absent rather than shown and
 * refused** (ADR 20260724-role-gated-surfaces-hide-not-explain).
 */

test.describe("owner", () => {
  signedInAsOwner();

  /**
   * How far down the board the scroll test below reads before clicking a row.
   *
   * **157, because that is the number the bug was reported at** (issue #1941)
   * — the offset `e2e/a11y.spec.ts`'s cert-gated roster kept inheriting, where
   * axe measured the back-link at "63.7px by 9.5px" and failed WCAG 2.5.8.
   *
   * It is not an arbitrary point inside a range. Next's router leaves the
   * scroll alone while the destination's first non-sticky element is inside
   * the *usable* viewport, which `scroll-padding-top` now starts at the bar's
   * bottom edge. Measured against the seeded board, on a warm route:
   *
   *     board offset     0   60  100  120  140  157  200
   *     lands, before    0   60  100  120  140  157  157
   *     lands, after     0   60  100    0    0    0    0
   *
   * So anything from about 101 up arrives at the departure's own top, and
   * below that the inherited offset is small enough that nothing is covered —
   * except a hairline band around 100, which is issue #1946. 157 is the
   * reported case, sits well clear of that edge, and is the only column where
   * the two rows differ by the full carry-over.
   */
  const BOARD_SCROLL_PX = 157;

  test("the sidebar names every section, and the one you are on is lit", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(nav.getByRole("link")).toHaveText([
      /^Today/,
      "Schedule",
      "Divers",
      "Inbox",
      "Money",
      "Courses",
      "Gear",
      "Settings",
    ]);
    // **Not `exact`, because Today's badge is part of its name**: the blocked
    // count rides the row, so the accessible name is "Today 20 divers blocked".
    await expect(nav.getByRole("link", { name: /^Today/ })).toHaveAttribute("aria-current", "page");

    const divers = nav.getByRole("link", { name: "Divers", exact: true });
    await divers.click();
    await expect(page).toHaveURL(/\/divers$/);
    await expect(divers).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: /^Today/ })).not.toHaveAttribute("aria-current");
  });

  test("a departure lights Schedule, because the board claims it", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    const door = page.locator("[data-week-board] a[data-departure-door]").first();
    const title = (await door.getAttribute("aria-label")) ?? "";
    await door.click();
    await expect(page).toHaveURL(/\/trips\//);
    // The address moves before the page commits; under load the nav can still
    // be reading the board when the URL already names the trip.
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    // **Lit, and `"true"` rather than `"page"`** (#1938): the board claims
    // `/trips`, so Schedule is the honest answer to "where am I", but its link
    // does not open this URL.
    await expect(nav.getByRole("link", { name: "Schedule" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  /**
   * **A row click opens a departure at the departure, not partway down it.**
   *
   * It did not. A staffer who had read down the week and clicked a row landed
   * at `window.scrollY === 157` — the board's own position, carried over — with
   * the masthead that names the departure already under the staff bar and the
   * `‹ BOARD` back-link half covered by it. Axe read that as a WCAG 2.5.8
   * failure at "63.7px by 9.5px", which is why `e2e/a11y.spec.ts`'s cert-gated
   * roster was red on some CI runs and green on others (issue #1941).
   *
   * Nothing in this app scrolled: `getScrollTargetState` in Next's
   * `layout-router` treats an element as "already in the viewport" from
   * `scroll-padding-top` downwards, that was 0 because the stylesheet declared
   * none, and the router took its early return and moved nothing at all. The
   * fix is one `scroll-padding-top: var(--chrome-h)` on `html`
   * (`src/app/globals.css`); this is the reader's half of it, and
   * `chrome.test.ts` holds the stylesheet's.
   *
   * Here rather than in `trips.spec.ts` because the claim is about where a
   * *navigation* puts you, which is this file's subject, and because it is
   * true of every staff page rather than of a departure.
   */
  test("a departure opened from a scrolled board starts at its own top", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    const departure = page.locator("[data-week-board] a[data-departure-door]").first();
    await expect(departure).toBeVisible();

    // **Open the departure once and come back, the way a staffer does.**
    //
    // This is not setup; it is the condition the bug needs, and leaving it out
    // is what made two earlier drafts of this test pass with the fix deleted.
    // A route opened cold renders its shell first, and a document barely taller
    // than the viewport cannot *hold* an inherited offset — the browser clamps
    // it to 0, the body streams in underneath, and the page looks correct for
    // a reason that has nothing to do with the router. Warm, it renders at full
    // height immediately and the inherited offset stays exactly where the
    // router left it.
    //
    // Which is also why `e2e/a11y.spec.ts`'s cert-gated roster was red on some
    // CI runs and green on others: whether the route was already in the client
    // cache decided whether the defect could show at all.
    //
    // The return leg is a click rather than a `goto`, because a document load
    // would empty the router cache and put the route back to cold.
    await departure.click();
    await expect(page).toHaveURL(/\/trips\//);
    await expect(page.locator("#roster")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "Schedule" })
      .click();
    await expect(page).toHaveURL(/\/schedule\/board$/);
    await expect(departure).toBeVisible();

    // **The offset has to be one the bug actually reaches.**
    //
    // The first draft of this test scrolled to the *last* row on the board, far
    // past any of this, and passed with `scroll-padding-top` deleted: at a big
    // enough offset the destination's top is above the viewport and Next
    // scrolls to the top regardless. A test that cannot fail is worse than no
    // test, because it reads as cover. See `BOARD_SCROLL_PX` for the window
    // and the measurements it was chosen from.
    await page.evaluate((y) => window.scrollTo(0, y), BOARD_SCROLL_PX);
    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message: "the board did not scroll, so this test had nothing to prove",
      })
      .toBe(BOARD_SCROLL_PX);
    // Playwright scrolls an out-of-view target before clicking it, and its
    // scroll — not this one — would be what the navigation then inherited.
    // Asserting the row is already in view is what keeps the offset above the
    // one actually under test.
    await expect(departure).toBeInViewport();

    await departure.click();
    await expect(page).toHaveURL(/\/trips\//);
    // The masthead, which is the page's own name and the thing that was being
    // skipped.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // **Settled first, then read once — never polled.**
    //
    // The departure streams its body, and until the roster lands the document
    // is barely taller than the viewport, so the browser clamps the inherited
    // offset to 0 and then restores it as the page grows. An `expect.poll` on
    // `window.scrollY` retries *until it passes*, so it finds that transient
    // and calls it green on a page about to scroll itself back down: this test
    // passed with `scroll-padding-top` deleted for exactly that reason, and
    // the probe that caught it differed only in waiting for `#roster` first.
    //
    // A poll is the right tool for a value that settles toward the assertion.
    // It is the wrong one for a value that passes through it.
    await expect(page.locator("#roster")).toBeVisible();
    expect(
      await page.evaluate(() => window.scrollY),
      "the departure opened partway down itself",
    ).toBe(0);

    // And the defect in its own language: axe failed this page because the
    // back-link was *half under the bar*, not because a number was wrong.
    // Asserting the clearance rather than only the offset means a future
    // change that lands at zero by some other route still has to keep the
    // masthead readable.
    const clearance = await page.evaluate(() => {
      const bar = document.querySelector("[data-chrome-bar]")?.getBoundingClientRect();
      // The masthead's way back up, named for the section it returns to.
      // Read inside `main`: the sidebar carries a "Schedule" link too.
      const back = [...document.querySelectorAll("main a")]
        .find((anchor) => /^schedule$/i.test(anchor.textContent?.trim() ?? ""))
        ?.getBoundingClientRect();
      return bar && back ? Math.round(back.top - bar.bottom) : null;
    });
    expect(clearance, "the back-link was left under the staff bar").not.toBeNull();
    expect(clearance ?? -1).toBeGreaterThanOrEqual(0);
  });

  test("a page under a section lights that section", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    for (const [suffix, section] of [
      ["/dive-sites", "Settings"],
      ["/settings/team", "Settings"],
      ["/requests", "Inbox"],
      ["/reviews", "Inbox"],
      ["/reports", "Money"],
    ] as const) {
      await page.goto(`/shop/blue-mantis${suffix}`);
      await expect(nav.getByRole("link", { name: section }), suffix).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(nav.locator("[aria-current]"), suffix).toHaveCount(1);
    }
  });

  test("the search is a shortcut to the same places", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await page.locator("header").getByRole("button", { name: "Search" }).click();
    await page.getByRole("combobox").fill("Orders");
    await page
      .getByRole("option", { name: /Orders/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/orders$/);
  });

  test("a diver the search finds opens their record", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await page.locator("header").getByRole("button", { name: "Search" }).click();
    await page.getByRole("combobox").fill("Priya");
    // `exact`, because a person's name is also the text of every seat they
    // hold; the diver row is the one whose whole accessible name is the person.
    await page.getByRole("option", { name: "Priya Sharma", exact: true }).first().click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/divers\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();
  });

  test("the shop's name holds the reader's own things, not a second Settings", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await page.locator("header [data-identity-menu]").click();
    await expect(page.locator("header").getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.locator("header").getByRole("link", { name: "Calendar subscription" }).click();
    await expect(page).toHaveURL(/\/settings\/calendar$/);
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

  test("a section the role cannot open is absent, not shown and refused", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    // Settings is gated, and its one door a captain may open is their own
    // calendar feed, which is in the shop's menu. Money stays: Orders is open
    // to every staff role.
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Money" })).toBeVisible();
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
    // Requests and the Inbox are open to every staff role (issues #1505,
    // #1518, #1679, H-14 amendments).
    for (const open of ["Requests", "Inbox"]) {
      await page.getByRole("combobox").fill(open);
      await expect(page.getByRole("option", { name: open, exact: true }).first()).toBeVisible();
    }
  });
});

test.describe("the phone", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 } });

  test("carries four sections and More in a tab bar at the foot", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    const tabs = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(tabs.getByRole("link")).toHaveText([/^Today/, "Schedule", "Divers", "Inbox"]);
    await expect(tabs.getByRole("button", { name: "More" })).toBeVisible();

    // Fixed to the foot of the screen.
    const box = await tabs.boundingBox();
    if (!box) throw new Error("the tab bar has no box");
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(844 - 1);

    await tabs.getByRole("link", { name: "Schedule" }).click();
    await expect(page).toHaveURL(/\/schedule\/board$/);
    await expect(tabs.getByRole("link", { name: "Schedule" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("keeps the rest one tap behind More, and lights More when you are there", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");
    const tabs = page.getByRole("navigation", { name: "Main", exact: true });
    await tabs.getByRole("button", { name: "More" }).click();
    await expect(tabs.getByRole("link")).toHaveText([
      /^Today/,
      "Schedule",
      "Divers",
      "Inbox",
      "Money",
      "Courses",
      "Gear",
      "Settings",
    ]);
    await tabs.getByRole("link", { name: "Money" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(tabs.getByRole("button", { name: "More" })).toHaveClass(/text-primary/);
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
    await page.goto(ONBOARD_FORM_PATH);
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
    const search = page.locator("header").getByRole("button", { name: "Search" });
    const [triggerBox, searchBox] = await Promise.all([
      trigger.boundingBox(),
      search.boundingBox(),
    ]);
    if (!triggerBox || !searchBox) throw new Error("header controls have no box");

    // And nothing is being held back: whatever the name does not get, the row
    // has already spent. This is the clamp's actual signature — a truncated
    // name with empty header beside it — and it fails on a cap of any size,
    // where a fixed width only fails on the one that was shipped. Measured
    // from the identity control rather than from the name, because the caret
    // that opens it is part of the control and not idle space; what is left
    // between the two is the row's own two gaps (8px each) and nothing else.
    // Only asked of a name that did not fit: one that renders whole leaves the
    // row's spare width where it belongs, beside it.
    if (width.wants > width.shown) {
      const idle = searchBox.x - (triggerBox.x + triggerBox.width);
      expect(idle).toBeLessThan(24);
    }
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
  /**
   * Further still, because the reduced-motion test's claim is that *no* scroll
   * folds anything: 400 is more than three times the range, so a bar still at
   * rest there is at rest because the rule was stilled and not because the
   * clock had not got going.
   */
  const REDUCED_MOTION_SCROLL_PX = 400;
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
   *
   * **The preference is a context option, not a call**, which is the one thing
   * that changed after this failed on CI (shard 4/4, 2026-09-20: the shop's
   * name at opacity 0 where the whole test says it cannot be). Only one rule in
   * the built stylesheet can take that element to 0 — the fold's own keyframe —
   * and the reduced-motion block kills its `animation-name` outright, at higher
   * specificity, with `!important`. So the failing frame was one where the
   * preference was not matching at all, and `page.emulateMedia()` is the only
   * thing in the test that can be late: it is a message to a page that already
   * exists, and the document this test then loads can resolve its style before
   * the navigation's new renderer has been told. `test.use` puts the preference
   * in the browser context before the page is created, so there is no window.
   *
   * It is stated as a premise below rather than inferred, so that if this ever
   * goes red again the message says which half broke.
   */
  test.describe("a reduced-motion reader", () => {
    test.use({ reducedMotion: "reduce" });

    test("gets the bar exactly as it ships", async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto("/shop/blue-mantis/divers");
      await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();

      // **The premise.** Everything below is about what this reader is spared,
      // so a page that was never in reduced motion would be asserting nothing
      // — and, having scrolled past the fold's range, would read exactly like
      // the kill-switch having failed.
      expect(
        await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
        "the page was not in reduced motion, so this test had nothing to prove",
      ).toBe(true);

      // **And the fold's rule has to be live on this page**, or the bar holds
      // still for the ordinary reason rather than this one: the rule is gated
      // on `body:has([data-chrome-title-slot]:not(:empty))`, and the portal
      // fills that slot after mount.
      await expect(page.locator("[data-chrome-title-slot]")).toHaveText("Divers");

      // **A scroll means nothing until the page can scroll.** Same precondition
      // as the at-rest test above, and the same reason: this list streams in
      // behind its own `loading.tsx`, and a skeleton shorter than the viewport
      // makes the scroll below a no-op — which would pass this test for the
      // wrong reason, the fold never having had a clock to run on.
      await expect
        .poll(
          () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
          { message: "the page never grew tall enough for the fold to have a clock" },
        )
        .toBeGreaterThanOrEqual(REDUCED_MOTION_SCROLL_PX);
      await page.evaluate((y) => window.scrollTo(0, y), REDUCED_MOTION_SCROLL_PX);
      await expect
        .poll(() => page.evaluate(() => Math.round(window.scrollY)), {
          message: "the page did not scroll, so the fold had no clock to run on",
        })
        .toBe(REDUCED_MOTION_SCROLL_PX);

      // Well past the 120px range, and nothing has folded.
      expect(await opacityOf(page, "[data-chrome-shop-name]")).toBe(1);
      expect(await opacityOf(page, "[data-chrome-title-slot]")).toBe(0);
      expect(await opacityOf(page, "[data-chrome-fold-title]")).toBe(1);
    });
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
    // is the seed's to choose. By the row's door, since a row's flags come
    // before it and link to the trip's `#details` or `/manifest`.
    const departure = await page
      .locator("[data-week-board] a[data-departure-door]")
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
