import { expect, test } from "./fixtures";

/**
 * **The crew schedule is a shop setting** (ADR
 * 20261005-crew-schedule-is-a-setting). Off, the Crew view of Schedule is
 * gone — no tab beside Week, and an old `/staffing` link lands on the week —
 * and on brings it back exactly as it was.
 *
 * A shop of its own (`privateShop`): this writes a shop setting, which the
 * per-test reset leaves standing (`.claude/rules/e2e.md`).
 */
test("an owner turns the crew schedule off and on again", async ({ page, privateShop }) => {
  test.setTimeout(60_000);
  const settings = `/shop/${privateShop.slug}/settings#crew-schedule`;
  const board = `/shop/${privateShop.slug}/schedule/board`;
  const crewTab = page.getByRole("link", { name: "Crew", exact: true });

  // A minted demo shop plans its crew, like the canonical one.
  await page.goto(board);
  await expect(crewTab).toBeVisible();

  await page.goto(settings);
  await page.getByLabel("Plan crew in DiveDay").uncheck();
  await page.getByRole("button", { name: "Save crew schedule" }).click();
  await expect(page.getByText("Crew schedule saved.")).toBeVisible();

  await page.goto(board);
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await expect(crewTab).toHaveCount(0);

  // An old link to the Crew view lands on the week it was one tab away from.
  await page.goto(`/shop/${privateShop.slug}/staffing`);
  await expect(page).toHaveURL(new RegExp(`${board}$`));

  await page.goto(settings);
  await page.getByLabel("Plan crew in DiveDay").check();
  await page.getByRole("button", { name: "Save crew schedule" }).click();
  await expect(page.getByText("Crew schedule saved.")).toBeVisible();

  await page.goto(board);
  await crewTab.click();
  await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}/staffing`));
  await expect(page.getByRole("region", { name: "Who’s working" })).toBeVisible();
});
