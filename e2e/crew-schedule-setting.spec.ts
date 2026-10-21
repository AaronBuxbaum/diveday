import { expect, test } from "./fixtures";

/**
 * **The crew schedule is a shop setting** (ADR
 * 20261005-crew-schedule-is-a-setting), a switch on the Features page. Off, the Crew view of Schedule is
 * gone — no tab beside Week, and an old `/staffing` link lands on the week —
 * and on brings it back exactly as it was.
 *
 * A shop of its own (`privateShop`): this writes a shop setting, which the
 * per-test reset leaves standing (`.claude/rules/e2e.md`).
 */
test("an owner turns the crew schedule off and on again", async ({ page, privateShop }) => {
  test.setTimeout(60_000);
  const features = `/shop/${privateShop.slug}/settings/features`;
  const crewRow = page.locator("li#crewSchedule");
  const board = `/shop/${privateShop.slug}/schedule/board`;
  const crewTab = page.getByRole("link", { name: "Crew", exact: true });

  // A minted demo shop plans its crew, like the canonical one.
  await page.goto(board);
  await expect(crewTab).toBeVisible();

  await page.goto(features);
  await crewRow.getByLabel("Plan crew in DiveDay").uncheck();
  await crewRow.getByRole("button", { name: "Save" }).click();
  await expect(crewRow.getByText("Saved")).toBeVisible();

  await page.goto(board);
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await expect(crewTab).toHaveCount(0);

  // An old link to the Crew view lands on the week it was one tab away from.
  await page.goto(`/shop/${privateShop.slug}/staffing`);
  await expect(page).toHaveURL(new RegExp(`${board}$`));

  await page.goto(features);
  await crewRow.getByLabel("Plan crew in DiveDay").check();
  await crewRow.getByRole("button", { name: "Save" }).click();
  await expect(crewRow.getByText("Saved")).toBeVisible();

  await page.goto(board);
  await crewTab.click();
  await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}/staffing`));
  await expect(page.getByRole("region", { name: "Who’s working" })).toBeVisible();
});
