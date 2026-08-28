import type { Page } from "@playwright/test";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";
const BOARD = `/shop/${SHOP}/schedule/board`;

/** The builder's controls name a departure by title, day, and time — see ScheduleBuilder. */
function control(page: Page, verb: string, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${verb} ${title},`) });
}

/** Each row's actions sit behind one "⋯" disclosure (design principles #8). */
function rowActions(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^Move, copy, or remove ${title},`) });
}

/** Opens the row's action list, then chooses one of Move / Copy / Remove. */
async function chooseRowAction(page: Page, verb: string, title: string) {
  await rowActions(page, title).first().click();
  await control(page, verb, title).first().click();
}

test.describe("schedule builder", () => {
  test("staff add, move, copy, and remove a departure without leaving the board", async ({
    page,
  }) => {
    // Four whole mutations, each one a form post and a board re-render — and
    // the board is the app's heaviest staff render (KPI tiles, a keyset page of
    // departures, per-trip crew and day counts). Aggregate per-navigation cost
    // across the sequence, not a hang; same reasoning as
    // e2e/role-permissions.spec.ts.
    test.setTimeout(30_000);
    // Unique title so every assertion targets this spec's own departure rather
    // than a seeded one. (Isolation itself comes from the per-test demo reset.)
    const title = `Builder Trip ${e2eNow().getTime()}`;
    // All three days sit well inside the board's first keyset page
    // (SCHEDULE_PAGE_SIZE trips) even with the seeded departures ahead of
    // them — the spec asserts both copies are on screen at once, which a
    // copy landing on page 2 would fail.
    const addDay = daysFromNow(3);
    const moveDay = daysFromNow(5);
    const copyDay = daysFromNow(4);

    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();

    // Add — the whole departure, from the board. The control is a link in the
    // page header's action cluster (?add=1), not a button of its own band.
    await page.getByRole("link", { name: "Add a departure", exact: true }).click();
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(addDay);
    await page.getByLabel("Departs").fill("09:00");
    await page.getByLabel("Returns").fill("13:00");
    await page.getByLabel("Seats").fill("8");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    // Named, so a staffer adding three departures in a row can read which one
    // landed (ADR 20260806-one-trip-create-form).
    await expect(page.getByRole("status")).toContainText(`“${title}” is on the board.`);
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("0/8")).toBeVisible();
    // No price was typed, so the board still says so, as the row's own amber
    // pill: the seeded board is a mixed one — seven of its fourteen departures
    // carry a price — so `allUnpriced` is false and the flag stays per-row
    // rather than collapsing into the group-level notice (design/principles.md
    // #9). Adding the price box did not quietly retire the flag.
    await expect(row.getByText("No price set")).toBeVisible();

    // Move — the departure slides to another day, keeping its length.
    await chooseRowAction(page, "Move", title);
    await page.getByLabel("New date").fill(moveDay);
    await page.getByLabel("New departure time").fill("07:15");
    await page.getByRole("button", { name: "Move it" }).click();
    await expect(page.getByRole("status")).toContainText("Moved.");
    // 07:15 + the same four hours it was created with.
    await expect(
      page.getByRole("listitem").filter({ hasText: title }).getByText("7:15 AM – 11:15 AM"),
    ).toBeVisible();

    // Copy — a second departure, same shape, nobody on it.
    await chooseRowAction(page, "Copy", title);
    await page.getByLabel("Copy to").fill(copyDay);
    await page.getByRole("button", { name: "Copy it" }).click();
    await expect(page.getByRole("status")).toContainText("Copied");
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(2);

    // Remove — a two-step confirm in a panel below the row, the same shape
    // Move and Copy use; both copies come back off the board.
    for (let remaining = 2; remaining > 0; remaining -= 1) {
      const row = page.getByRole("listitem").filter({ hasText: title }).first();
      await chooseRowAction(page, "Remove", title);
      await row.getByRole("button", { name: "Yes, remove the trip" }).click();
      await expect(page.getByRole("status")).toContainText("Taken off the board.");
      await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(
        remaining - 1,
      );
    }
  });

  test("a departure priced on the board is never flagged unpriced", async ({ page }) => {
    // The builder used to have no price box at all, so every departure minted
    // here published to the public schedule unpriced and then got flagged for
    // it (task 150). Price it in the same breath and there is nothing to flag.
    const title = `Priced Trip ${e2eNow().getTime()}`;
    await page.goto(BOARD);
    await page.getByRole("link", { name: "Add a departure", exact: true }).click();
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(4));
    await page.getByLabel("Seats").fill("6");
    await page.getByLabel(/Price per diver/).fill("129");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    // Named, so a staffer adding three departures in a row can read which one
    // landed (ADR 20260806-one-trip-create-form).
    await expect(page.getByRole("status")).toContainText(`“${title}” is on the board.`);

    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("No price set")).toHaveCount(0);
    // And the figure landed on the trip itself, not just off the badge: the
    // Details summary states it at rest, and the form behind the Edit
    // disclosure comes back pre-filled with what the board was told.
    await row.getByRole("link", { name: title }).click();
    await expect(page.getByText("$129.00 per diver")).toBeVisible();
    await page.getByText("Edit details", { exact: true }).click();
    await expect(page.getByLabel(/Price per diver/)).toHaveValue("129");
  });

  test("opening and cancelling the add/move panels manages keyboard focus", async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();

    // Opening the top "Add a departure" panel (the header's ?add=1 link)
    // moves focus straight into its first field, rather than leaving a
    // keyboard user on the control that just revealed a form below it.
    const addToggle = page.getByRole("link", { name: "Add a departure", exact: true });
    await addToggle.click();
    await expect(page.getByLabel("What is it")).toBeFocused();

    // Cancelling hands focus back to the header link that opened the panel,
    // not to <body> — and clears ?add so the link works a second time.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("What is it")).not.toBeVisible();
    await expect(addToggle).toBeFocused();
    await expect(page).not.toHaveURL(/add=/);
    await addToggle.click();
    await expect(page.getByLabel("What is it")).toBeFocused();
    await page.getByRole("button", { name: "Cancel" }).click();

    // Same contract for a row's Move panel — reached through the "⋯" action
    // list, which itself focuses its first action on open and hands focus
    // back to the trigger when the panel is cancelled.
    const trigger = rowActions(page, "Two-Tank Reef — Molasses & French").first();
    await trigger.click();
    const moveItem = control(page, "Move", "Two-Tank Reef — Molasses & French");
    await expect(moveItem).toBeFocused();
    await moveItem.click();
    await expect(page.getByLabel("New date")).toBeFocused();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("New date")).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("a departure divers have booked refuses to be deleted and says why", async ({ page }) => {
    await page.goto(BOARD);

    // The seeded two-tank reef trip carries a real roster.
    const booked = page
      .getByRole("listitem")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .first();
    await expect(booked).toBeVisible();
    await booked.getByRole("button", { name: /^Move, copy, or remove / }).click();
    await booked.getByRole("button", { name: /^Remove / }).click();
    await booked.getByRole("button", { name: "Yes, remove the trip" }).click();

    await expect(page.getByRole("status")).toContainText("Divers have booked this departure");
    // Still on the board, roster intact.
    await expect(
      page.getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" }).first(),
    ).toBeVisible();
  });

  test("a pinned day header sits flush under the chrome bar, on both shells", async ({ page }) => {
    // Sticky day headers so a reader scrolled into the middle of a long list
    // still knows which day the rows under their thumb belong to. They pin
    // directly under the one chrome bar both shells wear (ADR
    // 20260827-clearwater-surface-language, decision 10), which they now read
    // rather than measure: `top-(--chrome-h)` is the same declaration the bar
    // sets its own height from. Before that token the board carried a
    // hand-measured `top-[68px]` and only this test stood between it and the
    // bar's next change, while the public schedule pinned at `top-0` and spent
    // every scroll hidden underneath its own header — which is the failure
    // this covers on the second shell.
    //
    // Flush, not merely "clear of it", because the offset drifts in both
    // directions and both are real. Too small and the day hides behind the
    // bar. Too large and it floats in a band of dead space — which is not
    // hypothetical: the staff bar was 169px on a phone until the dock moved
    // its links out, and a one-sided "clearance >= 0" check passed happily on
    // a day header hanging 100px below it.
    //
    // The band below allows a pixel or two either way. `--chrome-h` is the
    // bar's whole border-box, hairline included, so the header should land
    // exactly flush — but a fractional device pixel or a sub-pixel layout
    // rounding is not a regression, and a header tucking a pixel *under* the
    // bar's bottom border is the safe side of the error to be on.
    const measure = async () =>
      await page.evaluate(async () => {
        const frame = async () =>
          await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        // Everything pinned at an offset of its own: the bar itself sits at 0,
        // a day header clears it.
        const dayHeaders = () =>
          [...document.querySelectorAll<HTMLElement>("*")].filter((el) => {
            const style = getComputedStyle(el);
            return style.position === "sticky" && Number.parseFloat(style.top) > 0;
          });

        // Scroll to a position *inside* a day rather than halfway down the
        // page. A day header only holds its offset while its own day is on
        // screen, so "halfway down" lands between two days as often as not.
        //
        // Which day matters, and picking the second one is a guess that fails:
        // a day whose section is shorter than the scroll delta has already
        // pushed its own header off the top before the next day's arrives, so
        // nothing is pinned and the measurement reads a dead zone rather than a
        // regression. That is what went red on the board at 768px, where the
        // stream renders a short day. So measure every section first and scroll
        // into the *tallest* one — the day with the most room to hold its
        // header pinned. That makes the scroll position a fact about the page
        // instead of a guess about it, at any width and on either shell.
        window.scrollTo(0, 0);
        await frame();
        const headers = dayHeaders();
        const offset = headers[0] ? Number.parseFloat(getComputedStyle(headers[0]).top) : -1;
        const tops = headers.map((el) => el.getBoundingClientRect().top + window.scrollY);
        const documentEnd = document.documentElement.scrollHeight;
        // Each day's section runs from its own header to the next one, and the
        // last runs to the end of the document.
        const sections = tops.map((top, i) => ({
          top,
          height: (tops[i + 1] ?? documentEnd) - top,
        }));
        // "Pinned" is a header holding its sticky offset rather than flowing.
        const pinnedNow = () =>
          dayHeaders()
            .map((el) => el.getBoundingClientRect())
            .filter((rect) => Math.abs(rect.top - offset) < 1.5);

        // Tallest section first, then the next — a section can still be too
        // short to hold its header once the viewport is tall, and the last one
        // can sit past the end of the scroll range. Exhausting every candidate
        // without pinning anything is a real failure, not a dead zone, so this
        // loop can only rescue a bad guess; it can never hide a regression.
        for (const section of [...sections].sort((a, b) => b.height - a.height)) {
          if (section.height <= 0) continue;
          // Far enough past the header to have lifted it off its natural
          // position, but still well inside its own section.
          window.scrollTo(0, section.top + Math.min(150, section.height / 2));
          await frame();
          if (pinnedNow().length > 0) break;
        }

        const bar = document.querySelector("header.sticky");
        const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
        const pinned = pinnedNow();
        return {
          dayCount: tops.length,
          barHeight: bar ? bar.getBoundingClientRect().height : 0,
          pinnedCount: pinned.length,
          // How far the worst-placed pinned header clears the bar. Negative
          // means it is hiding underneath it.
          clearance: Math.min(...pinned.map((rect) => rect.top - barBottom)),
        };
      });

    // The staff board and the shopfront — the two shells, and the two surfaces
    // decision 10 names by hand.
    // Each shell carries its own top width, and the difference is the week
    // board's doing: a sticky day header belongs to the *stream*, and the
    // stream's ceiling is the board's `xl` floor (H-63). At 1280 the board is
    // seven columns with no day header to pin, so 1279 is the widest the board
    // can be asked this question. The shopfront keeps its stream at every
    // width and is still asked at 1280.
    for (const [surface, url, ready, widths] of [
      ["the schedule board", BOARD, "Board", [390, 768, 1279]],
      // The shopfront's h1 is the shop's own name now, not the word
      // "Schedule" over a DiveDay-branded bar (slice 7a's hero).
      ["the public schedule", `/s/${SHOP}`, "Blue Mantis Divers", [390, 768, 1280]],
    ] as const) {
      await page.goto(url);
      // The destination's own h1 — what makes the measurement below wait on
      // the page rather than on the clock.
      await expect(page.getByRole("heading", { name: ready, level: 1 })).toBeVisible();
      // Phone, tablet, desktop — the widths at which the bar has historically
      // changed shape, so a future re-wrap is caught wherever it happens.
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        const measured = await measure();

        // One height, both shells. Preflight makes the bar `border-box`, so
        // the 3.5rem `--chrome-h` names is its whole outside edge with the
        // hairline inside it — 56px measured, not 56 plus a border.
        expect(
          measured.barHeight,
          `the chrome bar on ${surface} is ${measured.barHeight}px tall at ${width}px, not the 56px --chrome-h names`,
        ).toBeCloseTo(56, 0);
        expect(
          measured.dayCount,
          `${surface} rendered no day headers at ${width}px`,
        ).toBeGreaterThan(1);
        expect(
          measured.pinnedCount,
          `no day header pinned on ${surface} at ${width}px`,
        ).toBeGreaterThan(0);
        // A couple of pixels of slack either way, and no more: the gap this is
        // policing is measured in tens of pixels when it goes wrong.
        expect(
          measured.clearance,
          `a pinned day header is behind the chrome bar on ${surface} at ${width}px (overlapping by ${-measured.clearance}px)`,
        ).toBeGreaterThanOrEqual(-2);
        expect(
          measured.clearance,
          `a pinned day header floats below the chrome bar on ${surface} at ${width}px (${measured.clearance}px of dead space)`,
        ).toBeLessThanOrEqual(4);
      }
    }
  });

  test("the shopfront bar holds the shop's own name whole on a phone", async ({ page }) => {
    // The shopfront's `<h1>` reads "Schedule": this bar is the only place the
    // page says *whose* shop it is above the fold, which is the whole reason
    // the header exists (`PublicShopChrome`'s doc comment). One fixed-height
    // row means the name, two destinations and the language control share
    // 358 points at 390px, and the name is the slot that gives — so when it
    // gave, it gave silently: "Blue Mantis Div…", green, on the standard
    // photographed phone.
    //
    // 390 and 430 are the two phones the shop name has to survive whole.
    // Below them it may ellipse, and this deliberately does not assert that it
    // does not — that is what `truncate` is for, and a shop can always pick a
    // longer name than any width can hold.
    await page.goto(`/s/${SHOP}`);
    await expect(page.getByRole("heading", { name: "Blue Mantis Divers", level: 1 })).toBeVisible();

    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      const name = page.locator("header a span.truncate").first();
      const clipped = await name.evaluate((el) => ({
        text: el.textContent ?? "",
        needs: el.scrollWidth,
        has: Math.round(el.getBoundingClientRect().width),
      }));
      expect(
        clipped.needs,
        `the shop's name is cut in the bar at ${width}px ("${clipped.text}" needs ${clipped.needs}px, has ${clipped.has}px)`,
      ).toBeLessThanOrEqual(clipped.has + 1);
    }
  });

  /**
   * **The width floor** (H-63, decided 2026-08-27; ADR
   * 20260827-clearwater-surface-language, decision 5). Seven columns have no
   * honest form on a portrait tablet, so the board is the vertical day stream
   * below `xl` and the week from `xl` up — never both, and never neither.
   * This spec sets its own viewports because the fleet's default is 1279, one
   * pixel under the floor (playwright.config.ts).
   *
   * This is the **only** place the floor is really pinned: jsdom evaluates no
   * media query, so a unit test can read the class and not the breakpoint.
   */
  test("the board is the day stream below 1280px and the week from 1280 up", async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();

    // Raw CSS locators, not `getByRole`: the fixture patches the role queries
    // to visible-only matches, which would make "is it hidden" unanswerable.
    //
    // **Scoped to the stream's own wrapper**, not to the builder section. The
    // grid is a *child* of that section and renders first, so a
    // `section[…] ul li` crawl resolved to a week-grid cell and asserted the
    // exact opposite of this test at every width.
    const grid = page.locator('section[aria-label="The week"]');
    const stream = page.locator("[data-day-stream] li").first();

    // The portrait tablet a shop keeps the board open on all day, and the
    // phone under it.
    for (const width of [390, 820, 1279]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(stream, `the day stream is missing at ${width}px`).toBeVisible();
      await expect(grid, `the week grid renders at ${width}px, below its floor`).toBeHidden();
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(grid).toBeVisible();
    await expect(stream, "the stream renders alongside the week at 1280px").toBeHidden();
    // The stream's cursor pager goes with it: the grid pages by week.
    await expect(page.locator('a[href*="after="]').first()).toBeHidden();
  });

  /**
   * **J5 — repricing the week.** Dana, at desktop, sees the departure with no
   * price on the week and fixes it through the departure's own editor, which
   * is the panel that already existed.
   */
  test("an unpriced departure carries its warning on the week, and opens the existing editor", async ({
    page,
  }) => {
    const title = `Unpriced Trip ${e2eNow().getTime()}`;
    const addDay = daysFromNow(3);

    await page.goto(BOARD);
    await page.getByRole("link", { name: "Add a departure", exact: true }).click();
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(addDay);
    await page.getByLabel("Departs").fill("11:30");
    await page.getByLabel("Returns").fill("15:00");
    await page.getByLabel("Seats").fill("12");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toContainText(`“${title}” is on the board.`);

    // `?week=` takes any date inside the week and normalises it to that
    // week's Monday (src/lib/week-board.ts), so the departure's own day is a
    // valid address for the week it sails in — no paging, no guessing.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BOARD}?week=${addDay}`);
    const week = page.getByRole("region", { name: "The week" });
    // `exact`, because the cell also carries a "Set a price for {title}, …"
    // link and a substring match on the title resolves to both.
    await expect(week.getByRole("link", { name: title, exact: true })).toBeVisible();

    await week.getByRole("link", { name: new RegExp(`^Set a price for ${title},`) }).click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+#details$/);
    await page.getByText("Edit details", { exact: true }).click();
    await page.getByLabel(/Price per diver/).fill("110");
    await page.getByRole("button", { name: "Save changes" }).click();

    // Back on the week, the warning is gone and the figure is on the entry.
    await page.goto(`${BOARD}?week=${addDay}`);
    const entry = week.getByRole("listitem").filter({ hasText: title });
    await expect(entry).toHaveCount(1);
    await expect(entry.getByText("No price set")).toHaveCount(0);
  });

  /**
   * **The mutations survive the floor.** Move and remove are the two that
   * change what sails, and at desktop the only door to them is a week cell's
   * "⋯" — the stream's is `display:none` and out of the accessibility tree.
   * Covered here because the functional fleet drives 1279, so no other spec
   * in this suite ever exercises the `w:`-keyed panels.
   */
  test("staff move and remove a departure from the week, not only from the stream", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const title = `Week Trip ${e2eNow().getTime()}`;
    const addDay = daysFromNow(2);
    const moveDay = daysFromNow(4);

    await page.goto(BOARD);
    await page.getByRole("link", { name: "Add a departure", exact: true }).click();
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(addDay);
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("12:00");
    await page.getByLabel("Seats").fill("10");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toContainText(`“${title}” is on the board.`);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BOARD}?week=${addDay}`);
    const week = page.getByRole("region", { name: "The week" });
    await expect(week.getByRole("link", { name: title, exact: true })).toBeVisible();

    // The role queries are visible-only (e2e/fixtures.ts), so these resolve to
    // the grid's own controls rather than to the stream's hidden twins — which
    // is exactly the confusion the `w:` key prefix exists to prevent.
    await chooseRowAction(page, "Move", title);
    await page.getByLabel("New date").fill(moveDay);
    await page.getByLabel("New departure time").fill("06:45");
    await page.getByRole("button", { name: "Move it" }).click();
    await expect(page.getByRole("status")).toContainText("Moved.");

    await page.goto(`${BOARD}?week=${moveDay}`);
    await expect(week.getByRole("link", { name: title, exact: true })).toBeVisible();

    await chooseRowAction(page, "Remove", title);
    await page.getByRole("button", { name: "Yes, remove the trip" }).click();
    await expect(page.getByRole("status")).toContainText("Taken off the board.");
    await expect(week.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  });

  test("the week and the stream page by different parameters, and never mix them", async ({
    page,
  }) => {
    // The grid is a second *reading* of the same departures, not a second
    // stream: a `?week=` in the URL leaves the cursor-paged stream exactly as
    // it was, and the pager it hands back names a cursor and no week.
    await page.goto(`${BOARD}?week=2026-01-05`);
    await expect(page.getByRole("region", { name: "Schedule builder" })).toBeVisible();

    const later = page.getByRole("link", { name: "Show later departures" });
    await expect(later).toBeVisible();
    const href = await later.getAttribute("href");
    expect(href).toContain("after=");
    expect(href).not.toContain("week=");

    await later.click();
    if (href) await page.waitForURL(`**${href}`);
    await expect(
      page.getByRole("link", { name: "Back to the next departure" }).first(),
    ).toBeVisible();
  });

  test("staff add a private charter, and verify its private charter badge in schedule and details", async ({
    page,
  }) => {
    const title = `Private Charter ${e2eNow().getTime()}`;
    const addDay = daysFromNow(2);

    await page.goto(BOARD);
    await page.getByRole("link", { name: "Add a departure", exact: true }).click();
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(addDay);
    await page.getByLabel("Departs").fill("10:00");
    await page.getByLabel("Returns").fill("14:00");
    await page.getByLabel("Seats").fill("12");

    // Expand the form to access "More options" and check "Private charter"
    await page.getByRole("button", { name: /More options/i }).click();
    await page.locator("input[name='isPrivate']").check();

    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toContainText(`“${title}” is on the board.`);

    // Private charters are intentionally hidden from the public schedule.
    await page.goto(`/s/${SHOP}`);
    const tripCard = page.getByRole("listitem").filter({ hasText: title });
    await expect(tripCard).toHaveCount(0);
  });
});

test.describe("schedule builder, as the daily crew", () => {
  signedInAs("captain");

  test("a captain sees the board but none of its controls", async ({ page }) => {
    // Trip definition is owner/manager/instructor work (H-14); the crew runs the
    // day from each trip's own page.
    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a departure", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Add a departure/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move, copy, or remove / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });
});
