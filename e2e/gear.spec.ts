import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow, seededTripId } from "./helpers";

/**
 * The gear register (ADR 20260815-minimal-gear-register): the fleet on the
 * wall, the per-departure assignments, and the check-out/return loop. Every
 * write here lands on blue-mantis on purpose — the gear tables are
 * reset-owned (deleted and re-seeded by `/api/test/reset`, src/db/seed.ts),
 * so nothing a test adds, deletes, or reserves leaks into the next spec.
 */

test.describe("staff", () => {
  signedInAsOwner();

  test("adds a unit to the register and finds it in the fleet", async ({ page }) => {
    const tag = `BCD E2E-${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/gear");
    // "Add a unit" is a closed disclosure at rest; the header's own door opens it.
    await page.getByRole("button", { name: "Add gear" }).click();
    await page.getByLabel("Tag").fill(tag);
    await page.getByLabel("Size").first().fill("M");
    await page.getByRole("button", { name: "Add to the register" }).click();

    await expect(page.getByRole("status").filter({ hasText: "On the register." })).toBeVisible();
    await expect(page.getByRole("link", { name: tag })).toBeVisible();
  });

  test("refuses a duplicate tag beside the field, not in a page banner", async ({ page }) => {
    const tag = `Reg E2E-${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/gear");
    // "Add a unit" is a closed disclosure at rest; the header's own door opens it.
    await page.getByRole("button", { name: "Add gear" }).click();
    await page.getByLabel("Tag").fill(tag);
    await page.getByRole("button", { name: "Add to the register" }).click();
    await expect(page.getByRole("status").filter({ hasText: "On the register." })).toBeVisible();
    // **The unit's own row, before touching the page again.** The status banner
    // is rendered by the redirect's *destination*, but the register list behind
    // it is what proves the navigation has fully landed — and until it has, the
    // "Add gear" click below can hit the pre-navigation DOM, open that
    // disclosure, and then be thrown away by the remount. The Tag field never
    // appears and `fill` times out fifteen seconds later, which is what shard
    // 2/4 kept reporting under load.
    await expect(page.getByRole("link", { name: tag })).toBeVisible();

    // A successful add redirects with `?notice=added` — a real navigation
    // that remounts the page, so the disclosure is closed again.
    await page.getByRole("button", { name: "Add gear" }).click();
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

    // **The pick is the act.** There is no "Assign" beside the select any more:
    // one boat was 21 dropdowns and 21 confirming taps, at a counter, on the
    // morning of a departure (issue #802). Choosing a unit commits it.
    //
    // The first open picker on the page, whatever kind it offers, and its
    // first real unit — a picker with no exact size match opens on a disabled
    // "Pick a unit…" placeholder, so the choice is explicit.
    const firstSelect = page.locator("select[id^='assign-']").first();
    await firstSelect.waitFor();
    const firstUnit = firstSelect.locator("option:not([disabled])").first();
    const suggested = (await firstUnit.textContent()) ?? "";
    const suggestedTag = suggested.split(" · ")[0]?.trim() ?? "";
    expect(suggestedTag.length).toBeGreaterThan(0);
    await firstSelect.selectOption({ label: suggested });

    // The settled state is the assignment appearing on the diver's row — no
    // page banner, because nothing navigated.
    const assignments = page.locator('section[aria-labelledby="assignments-heading"]');
    await expect(assignments.getByText(suggestedTag, { exact: true })).toBeVisible();
    // Named rather than `getByRole("alert")`: Next's route announcer is a
    // permanently-mounted empty alert, as this file's own note at the tag
    // refusal above says.
    await expect(page.getByText("Somebody got that unit first")).toHaveCount(0);

    // Undo over confirm: releasing is one tap on the same row. `.last()`
    // picks the innermost matching `<li>` — the assignment chip itself, not
    // the whole diver row it sits in (which also holds seeded assignments).
    const assignedChip = assignments.locator("li").filter({ hasText: suggestedTag }).last();
    await assignedChip.getByRole("button", { name: "Release" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Assignment released." }),
    ).toBeVisible();
  });

  test("prints a diver their own rental ticket from the prep page", async ({ page }) => {
    const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
    await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
    const assignments = page.locator('section[aria-labelledby="assignments-heading"]');
    // The door only exists on a row that has units on it, which is the whole
    // rule: a slip listing nothing is a wrong slip, not a short one.
    const withUnits = assignments.locator("li").filter({ hasText: "Rental ticket" }).first();
    const diverName = ((await withUnits.locator("p").first().textContent()) ?? "").trim();
    const firstTag = (
      (await withUnits.locator("span.font-mono").first().textContent()) ?? ""
    ).trim();
    expect(firstTag.length).toBeGreaterThan(0);

    await withUnits.getByRole("link", { name: "Rental ticket" }).click();
    await expect(page.getByRole("heading", { name: diverName, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What you have" })).toBeVisible();
    await expect(page.getByText(firstTag, { exact: true })).toBeVisible();
    // No money and nothing to sign: the two things this slip must never
    // become (ADR 20260815-minimal-gear-register, CR-015). Scoped to the slip
    // itself — the staff shell around it carries its own forms on every route,
    // and they are not what this is about.
    const slip = page.locator("#rental-ticket");
    // The container first: every assertion below is an absence, and an absence
    // inside a selector that matches nothing passes for the wrong reason.
    await expect(slip).toBeVisible();
    await expect(slip.getByText("$")).toHaveCount(0);
    await expect(slip.getByText(/signature|sign here|i agree|total|deposit/i)).toHaveCount(0);
    await expect(slip.locator("form")).toHaveCount(0);
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

  /**
   * Delete is soft (ADR 20260820-every-delete-is-soft): Reg #5 ships with an
   * annual service on its clock and nothing reserved against it, so this walks
   * the whole round trip and proves the history is still there at the end.
   */
  test("deletes a unit off the register and restores it, service clock and all", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: "Reg #5", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reg #5" })).toBeVisible();
    const clock = (
      (await page.getByText("last ", { exact: false }).first().textContent()) ?? ""
    ).trim();
    expect(clock.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Delete unit" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Unit deleted." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reg #5", exact: true })).toHaveCount(0);

    // The way back: the register's own Deleted view, not just the toast.
    await page.goto("/shop/blue-mantis/gear?view=deleted");
    const deleted = page.getByRole("region", { name: "Deleted" });
    await expect(deleted.getByText("Reg #5", { exact: true })).toBeVisible();
    await deleted.getByRole("button", { name: "Restore Reg #5" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Unit restored." })).toBeVisible();

    await page.getByRole("link", { name: "Reg #5", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reg #5" })).toBeVisible();
    await expect(page.getByText(clock, { exact: false })).toBeVisible();
  });

  /**
   * The counter case behind issue #614: a customer asks when a deleted
   * regulator was last serviced. The unit's record still reads, so answering
   * costs no restore-onto-the-live-register-and-delete-it-again round trip —
   * and it is read-only, because every writer in `src/db/gear.ts` refuses a
   * deleted row and a rendered form would be a control that cannot work.
   */
  test("a deleted unit's record still reads its history, with nothing on it that writes", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: "Reg #5", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reg #5" })).toBeVisible();
    const record = page.url();
    // The seeded annual service, worded exactly as the live record words it.
    const clock = (
      (await page.getByText("last ", { exact: false }).first().textContent()) ?? ""
    ).trim();
    expect(clock.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Delete unit" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Unit deleted." })).toBeVisible();

    // Reached the way a staffer would, from the register's Deleted view.
    await page.goto("/shop/blue-mantis/gear?view=deleted");
    await page
      .getByRole("region", { name: "Deleted" })
      .getByRole("link", { name: "Reg #5", exact: true })
      .click();
    await expect(page).toHaveURL(record);
    await expect(page.getByRole("heading", { level: 1, name: "Reg #5" })).toBeVisible();
    await expect(page.getByText("Deleted", { exact: true }).first()).toBeVisible();

    // The service clock is still on the page — it is the whole reason this
    // record is reachable — and the paper trail beneath it is unfolded.
    await expect(page.getByText(clock, { exact: false })).toBeVisible();
    await expect(
      page.locator("details[open] summary").filter({ hasText: "History" }),
    ).toBeVisible();

    // Nothing that writes.
    for (const control of [
      "Log it",
      "Save changes",
      "Delete unit",
      "Pull for service",
      "Return to service",
    ]) {
      await expect(page.getByRole("button", { name: control })).toHaveCount(0);
    }

    // One act, and it lands back on the register with the unit on it.
    await page.getByRole("button", { name: "Restore unit" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Unit restored." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reg #5", exact: true })).toBeVisible();
  });

  test("refuses to delete a unit a diver still has, and says who is holding it", async ({
    page,
  }) => {
    // BCD #2 ships reserved against the upcoming wreck trip (src/db/seed-gear.ts).
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: "BCD #2", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "BCD #2" })).toBeVisible();

    await page.getByRole("button", { name: "Delete unit" }).click();
    // The refusal lands beside the control that asked for it, naming the
    // reservation in the way — never a silent no-op. Filtered by text because
    // Next's route announcer is a second, empty role="alert".
    await expect(
      page.getByRole("alert").filter({ hasText: "release or return it first" }),
    ).toBeVisible();
    // And the unit is still on the register.
    await page.goto("/shop/blue-mantis/gear?kind=bcd");
    await expect(page.getByRole("link", { name: "BCD #2", exact: true })).toBeVisible();
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
