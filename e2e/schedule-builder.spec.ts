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

    // Add — the whole departure, from the board.
    await page.getByRole("button", { name: "Add a departure", exact: true }).click();
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
    // No price was typed, so the board still says so. Every departure on the
    // demo board is unpriced, so the flag is the one group-level notice (the
    // per-row pill collapses when the whole window shares the fact —
    // design/principles.md #9); the unit suite covers the per-row pill for a
    // mixed board. Either way, adding the price box did not quietly retire
    // the flag.
    await expect(page.getByText(/None of these departures has a price yet/)).toBeVisible();

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
    await page.getByRole("button", { name: "Add a departure", exact: true }).click();
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
    // And the figure landed on the trip itself, not just off the badge: its
    // Details form comes back pre-filled with what the board was told.
    await row.getByRole("link", { name: title }).click();
    await expect(page.getByLabel(/Price per diver/)).toHaveValue("129");
  });

  test("opening and cancelling the add/move panels manages keyboard focus", async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();

    // Opening the top "Add a departure" panel moves focus straight into its
    // first field, rather than leaving a keyboard user on the button that
    // just revealed a form below it.
    const addToggle = page.getByRole("button", { name: "Add a departure", exact: true });
    await addToggle.click();
    await expect(page.getByLabel("What is it")).toBeFocused();

    // Cancelling hands focus back to the toggle that opened the panel, not
    // to <body>.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("What is it")).not.toBeVisible();
    await expect(addToggle).toBeFocused();

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
});

test.describe("schedule builder, as the daily crew", () => {
  signedInAs("captain");

  test("a captain sees the board but none of its controls", async ({ page }) => {
    // Trip definition is owner/manager/instructor work (H-14); the crew runs the
    // day from each trip's own page.
    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a departure", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move, copy, or remove / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });
});
