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

  test("a pinned day header sits flush under the shop nav", async ({ page }) => {
    // The board's day headers are sticky so a staffer scrolled into the middle
    // of a two-week window still knows which day the rows under their thumb
    // belong to. They pin directly under the staff shell's own sticky header,
    // at a `top-[68px]` that is a *measured* constant: the nav's height is
    // content-driven, so it cannot be derived in CSS, and nothing until this
    // test checked that the number still matched the nav.
    //
    // Flush, not merely "clear of it", because the constant drifts in both
    // directions and both are real. Too small and the day hides behind the nav.
    // Too large and it floats in a band of dead space — which is not
    // hypothetical: the nav was 169px on a phone until the dock moved its links
    // out and left one 69px row, and a one-sided "clearance >= 0" check passed
    // happily on a day header hanging 100px below the nav.
    //
    // The band below is deliberately asymmetric. 68px against a 69px nav is a
    // 1px overlap on purpose (see ScheduleBuilder: it tucks under the nav's
    // bottom border so no slit of scrolling content shows between the two), so
    // -2 is the floor rather than 0.
    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();

    // Phone, tablet, desktop — the widths at which the nav has historically
    // changed shape, so a future re-wrap is caught wherever it happens.
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const measured = await page.evaluate(async () => {
        window.scrollTo(0, document.body.scrollHeight / 2);
        // A frame boundary, not a timing guess: sticky offsets are resolved
        // during layout, so the next animation frame is the first moment the
        // pinned positions are readable at all.
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const nav = document.querySelector("header.sticky");
        const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
        const headers = [...document.querySelectorAll("h3")]
          .map((heading) => heading.parentElement)
          .filter(
            (el): el is HTMLElement => el !== null && getComputedStyle(el).position === "sticky",
          );
        const offset = headers[0] ? Number.parseFloat(getComputedStyle(headers[0]).top) : -1;
        // "Pinned" is a header holding its sticky offset rather than flowing.
        const pinned = headers
          .map((el) => el.getBoundingClientRect())
          .filter((rect) => Math.abs(rect.top - offset) < 1.5);
        return {
          pinnedCount: pinned.length,
          // How far the worst-placed pinned header clears the nav. Negative
          // means it is hiding underneath it.
          clearance: Math.min(...pinned.map((rect) => rect.top - navBottom)),
        };
      });

      expect(measured.pinnedCount, `no day header pinned at ${width}px`).toBeGreaterThan(0);
      // A couple of pixels of slack either way, and no more: the gap this is
      // policing is measured in tens of pixels when it goes wrong.
      expect(
        measured.clearance,
        `a pinned day header is behind the shop nav at ${width}px (overlapping by ${-measured.clearance}px) — the sticky offset in ScheduleBuilder is smaller than the nav`,
      ).toBeGreaterThanOrEqual(-2);
      expect(
        measured.clearance,
        `a pinned day header floats below the shop nav at ${width}px (${measured.clearance}px of dead space) — the sticky offset in ScheduleBuilder is larger than the nav`,
      ).toBeLessThanOrEqual(4);
    }
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
