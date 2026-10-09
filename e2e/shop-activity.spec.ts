import { expect, READ_ONLY, signedInAs, signedInAsOwner, test } from "./fixtures";

/**
 * **The shop's activity log** (D5): who did what, to what, when, across the
 * whole team — the owner's answer to "who refunded this?", "who moved that
 * departure?". Reached from Settings' Data group, filtered by person, kind and
 * date, and refused to anyone who is not an owner or a manager.
 *
 * READ_ONLY: the log is a read of the trails the seed already wrote (the desk
 * trail Marcus Webb keeps on today's departure), and the refusal writes
 * nothing.
 */
test.describe("the shop's activity log", () => {
  signedInAsOwner();

  test("an owner reads who did what, and narrows it by person and kind", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings");
    await page.getByRole("link", { name: "Activity" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();

    await expect(page.getByText(/^\d+ entries$/)).toBeVisible();

    // By person: the desk trail Marcus Webb keeps on today's departure. A
    // line is its sentence (who, did what), its object as a link, and when.
    await page.getByLabel("Who").selectOption({ label: "Marcus Webb" });
    await expect(page).toHaveURL(/personId=/);
    const charter = page
      .getByTestId("shop-activity")
      .getByRole("listitem")
      .filter({ hasText: "Marcus Webb confirmed the charter with the captain" });
    await expect(charter).toBeVisible();
    await expect(charter.getByRole("link")).toHaveAttribute(
      "href",
      /\/shop\/blue-mantis\/trips\/[0-9a-f-]{36}$/,
    );

    // By kind: the charter is departure work, not money.
    await page.getByLabel("What").selectOption({ label: "Money" });
    await expect(page).toHaveURL(/kind=money/);
    await expect(page.getByText("Marcus Webb confirmed the charter with the captain")).toHaveCount(
      0,
    );
    await page.getByLabel("What").selectOption({ label: "Departures" });
    await expect(page).toHaveURL(/kind=departures/);
    await expect(charter).toBeVisible();

    // And back to the whole log.
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page).not.toHaveURL(/personId=|kind=/);
    await expect(page.getByRole("link", { name: "Clear" })).toHaveCount(0);
  });
});

test.describe("the activity log's gate", () => {
  signedInAs("captain");

  test("a captain is turned back to Today with the reason", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/activity");
    await expect(page).toHaveURL(/notice=activity-not-authorized/);
    await expect(
      page.getByText("The activity log is limited to owners and managers."),
    ).toBeVisible();
    await expect(page.getByText("Marcus Webb confirmed the charter with the captain")).toHaveCount(
      0,
    );
  });
});
