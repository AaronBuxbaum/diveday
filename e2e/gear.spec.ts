import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow, seededTripId } from "./helpers";

/**
 * The gear register (ADR 20260815-minimal-gear-register): the fleet on the
 * wall, the per-departure assignments, and the check-out/return loop. Every
 * write here lands on blue-mantis on purpose — the gear tables are
 * reset-owned (deleted and re-seeded by `/api/test/reset`, src/db/seed.ts),
 * so nothing a test adds, retires, or reserves leaks into the next spec.
 */

test.describe("staff", () => {
  signedInAsOwner();

  test("adds a unit to the register and finds it in the fleet", async ({ page }) => {
    const tag = `BCD E2E-${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/gear");
    await page.getByLabel("Tag").fill(tag);
    await page.getByLabel("Size").first().fill("M");
    await page.getByRole("button", { name: "Add to the register" }).click();

    await expect(page.getByRole("status").filter({ hasText: "On the register." })).toBeVisible();
    await expect(page.getByRole("link", { name: tag })).toBeVisible();
  });

  test("refuses a duplicate tag beside the field, not in a page banner", async ({ page }) => {
    const tag = `Reg E2E-${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/gear");
    await page.getByLabel("Tag").fill(tag);
    await page.getByRole("button", { name: "Add to the register" }).click();
    await expect(page.getByRole("status").filter({ hasText: "On the register." })).toBeVisible();

    await page.getByLabel("Tag").fill(tag);
    await page.getByRole("button", { name: "Add to the register" }).click();
    // The refusal lands on the Tag field itself (role="alert" via Field's
    // error prop), and the offending input is marked invalid. Filtered by
    // text because Next's route announcer is a second, empty role="alert".
    await expect(
      page.getByRole("alert").filter({ hasText: "Another unit already wears that tag." }),
    ).toBeVisible();
    await expect(page.getByLabel("Tag")).toHaveAttribute("aria-invalid", "true");
  });

  test("walks a seeded reservation through check-out and return from the unit's record", async ({
    page,
  }) => {
    // BCD #2 ships reserved against the wreck trip (src/db/seed-gear.ts).
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: "BCD #2", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "BCD #2" })).toBeVisible();
    await expect(page.getByText("Wreck Trip — Spiegel Grove")).toBeVisible();

    await page.getByRole("button", { name: "Check out" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Checked out." })).toBeVisible();

    await page.getByRole("button", { name: "Mark returned" }).click();
    await expect(page.getByRole("status").filter({ hasText: "the unit is home" })).toBeVisible();
    await expect(page.getByText("In the shop — nothing reserved.")).toBeVisible();
  });

  test("assigns a free unit on the wreck trip's prep page and releases it again", async ({
    page,
  }) => {
    const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
    await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
    await expect(
      page.getByRole("heading", { name: "Rental assignments", exact: true }),
    ).toBeVisible();

    // The first open picker on the page, whatever kind it offers: choose its
    // first real unit (a picker with no exact size match opens on a disabled
    // "Pick a unit…" placeholder, so the choice is explicit) and hold the
    // page to its word. Anchoring on the form first keeps the select and its
    // Assign button provably the same row.
    const firstForm = page
      .locator("form")
      .filter({ has: page.locator('select[name="gearItemId"]') })
      .first();
    const firstSelect = firstForm.locator('select[name="gearItemId"]');
    await firstSelect.waitFor();
    const firstUnit = firstSelect.locator("option:not([disabled])").first();
    const suggested = (await firstUnit.textContent()) ?? "";
    const suggestedTag = suggested.split(" · ")[0]?.trim() ?? "";
    expect(suggestedTag.length).toBeGreaterThan(0);
    await firstSelect.selectOption({ label: suggested });
    await firstForm.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Assigned." })).toBeVisible();
    const assignments = page.locator('section[aria-labelledby="assignments-heading"]');
    await expect(assignments.getByText(suggestedTag, { exact: true })).toBeVisible();

    // Undo over confirm: releasing is one tap on the same row. `.last()`
    // picks the innermost matching `<li>` — the assignment chip itself, not
    // the whole diver row it sits in (which also holds seeded assignments).
    const assignedChip = assignments.locator("li").filter({ hasText: suggestedTag }).last();
    await assignedChip.getByRole("button", { name: "Release" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Assignment released." }),
    ).toBeVisible();
  });

  test("logs a service on a unit and the clock appears in its history", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: "Reg #1", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reg #1" })).toBeVisible();

    // Substring on purpose: the accessible name is "Note (optional)" — the
    // Field hint rides inside the label element.
    await page.getByLabel("Note").fill("Second stage rebuilt on the bench");
    await page.getByRole("button", { name: "Log it" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Logged." })).toBeVisible();
    // The paper trail folds under the Service card at rest — open it.
    await page.locator("summary").filter({ hasText: "History" }).click();
    await expect(
      page.getByText("Second stage rebuilt on the bench", { exact: true }),
    ).toBeVisible();
  });

  test("pulls a unit for service and the register says so out loud", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: "BCD #6", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "BCD #6" })).toBeVisible();

    await page.getByLabel("Why it's coming off the wall").fill("Dump valve leaks");
    await page.getByRole("button", { name: "Pull for service" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await expect(page.getByText("Needs service").first()).toBeVisible();

    // Back on the register, the row wears the pulled state — and only the
    // exceptional rows wear anything at all.
    await page.goto("/shop/blue-mantis/gear?kind=bcd");
    const pulledRow = page.locator("tr", { hasText: "BCD #6" });
    await expect(pulledRow.getByText("Needs service")).toBeVisible();
  });
});
