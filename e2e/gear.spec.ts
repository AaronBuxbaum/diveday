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
    await expect(page.getByText("In the shop, nothing reserved.")).toBeVisible();
  });

  /**
   * The register's own loop, after slice 9d (ADR 20260827-the-shops-shelves):
   * the acts that used to live in a Returns panel above the fleet now ride the
   * rows of the groups they were always about, and closing the last one out
   * earns the register its one coral line.
   *
   * The two states come from `/api/test/seed-trouble-states?gearOut=1`, never
   * from the demo seed: blue-mantis reserves against a departure five days
   * out, so nothing on it is ever out or overdue.
   */
  test("closes an overdue unit and the last one out, from the register's own rows", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-trouble-states?gearOut=1");
    await page.goto("/shop/blue-mantis/gear");
    await expect(page.getByRole("heading", { level: 2, name: /^Overdue/ })).toBeVisible();

    // The chase: BCD #2 is with a diver and its window lapsed two days ago.
    await page.getByRole("button", { name: "Mark returned — BCD #2" }).click();
    await expect(page.getByRole("status").filter({ hasText: "the unit is home" })).toBeVisible();
    // A group with nothing in it is not a group — never "Overdue — 0".
    await expect(page.getByRole("heading", { level: 2, name: /^Overdue/ })).toHaveCount(0);

    // The last one out, and the earned moment behind it (Clearwater ADR
    // 20260827-clearwater-surface-language, decision 11's table).
    await page.getByRole("button", { name: "Mark returned — Reg #1" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "every unit is back on the wall" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^Out/ })).toHaveCount(0);
  });

  /**
   * **The register's one fleet-wide reading** (ADR 20260827-the-shops-shelves,
   * slice 9d as amended after review). The three groups say where a unit is;
   * none of them says what the bench owes, so the service-due tile the slice
   * retired came back as the band's own view rather than folding into a group
   * — otherwise a 120-unit shop could only answer the question for the fifty
   * units on the wall page in front of it.
   *
   * The demo fleet already holds both shapes: Reg #4 was pulled off the wall,
   * and AL80-03's visual inspection is three weeks out — inside the month the
   * register plans over and outside the six days Today raises, which is
   * exactly the heads-up that would otherwise have gone missing.
   */
  test("answers what the bench owes across the whole fleet, not just the wall page", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/gear");
    const chip = page.getByRole("link", { name: "Service due (2)" });
    await expect(chip).toBeVisible();
    await chip.click();

    // Stopped now leads; the clock still running follows it.
    const rows = page.getByRole("listitem");
    await expect(rows.filter({ hasText: "Reg #4" }).getByText("Needs service")).toBeVisible();
    await expect(
      rows.filter({ hasText: "AL80-03" }).getByText(/^Visual inspection due /),
    ).toBeVisible();
    // Its own view, not a narrowed register: no group headings over it — the
    // active chip names it — and the units whose clocks are in date are out.
    await expect(page.getByRole("heading", { level: 2, name: /^On the wall/ })).toHaveCount(0);
    await expect(rows.filter({ hasText: "BCD #1" })).toHaveCount(0);

    // A chip is a view of a real URL — it bookmarks and survives a reload.
    await page.reload();
    await expect(page.getByRole("link", { name: "Service due (2)" })).toHaveAttribute(
      "aria-current",
      "true",
    );
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

  /**
   * **The gear comes home in one act** (issue #1186, delight report D26).
   *
   * The demo shop never has a unit out — it reserves against a departure five
   * days away — so the state comes from `?gearOut=1`, the same route the
   * register's own Out and Overdue captures use.
   *
   * What this proves that a unit test cannot: the pane is only on the diver
   * whose set is actually out, one tap closes the whole set, and the service
   * concern refuses without words *at the form* rather than only in the
   * writer.
   */
  test("returns a whole rental set from the prep page, and refuses a wordless concern", async ({
    page,
    request,
  }) => {
    // The trip id first: `seed-trouble-states` reshapes the board, and paging
    // it afterwards is a race this test has no reason to run.
    const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
    await request.post("/api/test/seed-trouble-states?gearOut=1");
    await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
    const assignments = page.locator('section[aria-labelledby="assignments-heading"]');

    // Exactly one diver has a set out, so exactly one pane exists. A pane on a
    // diver whose units are still on the wall would be the paperwork this
    // replaces rather than the removal of it.
    const allGood = assignments.getByRole("button", { name: "All good" });
    await expect(allGood).toHaveCount(1);

    // The concern arms a field instead of submitting — a flag a technician
    // cannot act on is worse than no flag.
    await assignments.getByRole("button", { name: "Service concern" }).first().click();
    const note = assignments.getByLabel("What to tell the technician");
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute("required", "");

    // And the ordinary evening still works *with the concern armed*, which is
    // the whole reason the fast answers carry `formNoValidate`: the empty
    // required note sits in the same form, and without it the browser refuses
    // to submit "All good" until somebody fills in a field they opened by
    // mistake. This assertion is the bug it was written after.
    await allGood.click();
    await expect(page.getByRole("status").filter({ hasText: "Back on the wall." })).toBeVisible();
    // Gone, because nothing is out any more.
    await expect(assignments.getByRole("button", { name: "All good" })).toHaveCount(0);
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

    // Scoped to the Service region: the register also has a "Notes" section
    // (an unrelated field whose own label happens to contain "note" too), so
    // an unscoped getByLabel("Note") is ambiguous between the two.
    const service = page.getByRole("region", { name: "Service" });
    // Substring on purpose: the accessible name is "Note (optional)" — the
    // Field hint rides inside the label element.
    await service.getByLabel("Note").fill("Second stage rebuilt on the bench");
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
    // Scoped to the page's own header — the badge is the only thing that says
    // "Deleted" there, and `exact` would miss the tone mark Badge renders
    // beside it.
    await expect(page.locator("main header").getByText("Deleted")).toBeVisible();

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

    // "Pull for service" opens a dialog rather than submitting inline —
    // scoped there for the fill and the submit, since the trigger behind it
    // shares the same accessible name.
    await page.getByRole("button", { name: "Pull for service" }).click();
    const dialog = page.getByRole("dialog", { name: "Pull for service" });
    await dialog.getByLabel("Why it's coming off the wall").fill("Dump valve leaks");
    await dialog.getByRole("button", { name: "Pull for service" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await expect(page.getByText("Needs service").first()).toBeVisible();

    // Back on the register, the row wears the pulled state — and only the
    // exceptional rows wear anything at all. A ledger row rather than a table
    // row: the register is one story in three groups now (ADR
    // 20260827-the-shops-shelves), and a benched unit is still on the wall.
    await page.goto("/shop/blue-mantis/gear?kind=bcd");
    const pulledRow = page.getByRole("listitem").filter({ hasText: "BCD #6" });
    await expect(pulledRow.getByText("Needs service")).toBeVisible();
  });

  test("adds a note to a unit's record without touching the service log", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: "Reg #1", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reg #1" })).toBeVisible();

    const notes = page.getByRole("region", { name: "Notes" });
    await notes.getByLabel("Add a note").fill("Diver mentioned the mouthpiece tastes off");
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Logged." })).toBeVisible();
    await expect(page.getByText("Diver mentioned the mouthpiece tastes off")).toBeVisible();
  });

  test("moved: gear history import lives under Settings, gated to owners and managers", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/gear");
    await expect(page.getByRole("heading", { name: "Import gear history" })).toHaveCount(0);

    await page.goto("/shop/blue-mantis/settings/gear-import");
    await expect(
      page.getByRole("heading", { level: 1, name: "Import gear history" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Download gear CSV template" })).toBeVisible();
  });
});
