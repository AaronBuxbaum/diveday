import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";
const BOARD = `/shop/${SHOP}/schedule/board`;

/** The builder's controls name a departure by title, day, and time — see ScheduleBuilder. */
function control(page: import("@playwright/test").Page, verb: string, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${verb} ${title},`) });
}

test.describe("schedule builder", () => {
  test("staff add, move, copy, and remove a departure without leaving the board", async ({
    page,
  }) => {
    // Unique title so every assertion targets this spec's own departure rather
    // than a seeded one. (Isolation itself comes from the per-test demo reset.)
    const title = `Builder Trip ${e2eNow().getTime()}`;
    const addDay = daysFromNow(3);
    const moveDay = daysFromNow(5);
    const copyDay = daysFromNow(9);

    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "The board" })).toBeVisible();

    // Add — the whole departure, from the board.
    await page.getByRole("button", { name: "Add a departure", exact: true }).click();
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(addDay);
    await page.getByLabel("Departs").fill("09:00");
    await page.getByLabel("Returns").fill("13:00");
    await page.getByLabel("Seats").fill("8");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toContainText("It’s on the board.");
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("0/8")).toBeVisible();

    // Move — the departure slides to another day, keeping its length.
    await control(page, "Move", title).click();
    await page.getByLabel("New date").fill(moveDay);
    await page.getByLabel("New departure time").fill("07:15");
    await page.getByRole("button", { name: "Move it" }).click();
    await expect(page.getByRole("status")).toContainText("Moved.");
    // 07:15 + the same four hours it was created with.
    await expect(
      page.getByRole("listitem").filter({ hasText: title }).getByText("7:15 AM – 11:15 AM"),
    ).toBeVisible();

    // Copy — a second departure, same shape, nobody on it.
    await control(page, "Copy", title).click();
    await page.getByLabel("Copy to").fill(copyDay);
    await page.getByRole("button", { name: "Copy it" }).click();
    await expect(page.getByRole("status")).toContainText("Copied");
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(2);

    // Remove — a two-step in-page confirm (InlineConfirm), both copies come
    // back off the board.
    for (let remaining = 2; remaining > 0; remaining -= 1) {
      const row = page.getByRole("listitem").filter({ hasText: title }).first();
      await control(page, "Remove", title).first().click();
      await row.getByRole("button", { name: "Yes, remove the trip" }).click();
      await expect(page.getByRole("status")).toContainText("Taken off the board.");
      await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(
        remaining - 1,
      );
    }
  });

  test("opening and cancelling the add/move panels manages keyboard focus", async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.getByRole("heading", { name: "The board" })).toBeVisible();

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

    // Same contract for a row's Move panel.
    const moveToggle = control(page, "Move", "Two-Tank Reef — Molasses & French");
    await moveToggle.click();
    await expect(page.getByLabel("New date")).toBeFocused();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("New date")).not.toBeVisible();
    await expect(moveToggle).toBeFocused();
  });

  test("a departure divers have booked refuses to be deleted and says why", async ({ page }) => {
    await page.goto(BOARD);

    // The seeded two-tank reef trip carries a real roster.
    const booked = page
      .getByRole("listitem")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .first();
    await expect(booked).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "The board" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a departure", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });
});
