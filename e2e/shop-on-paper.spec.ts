import { expect, test } from "./fixtures";

/**
 * Every test here mints a shop of its own and signs in live, and that setup
 * runs inside the test's own timeout — so the budget has to be set on the
 * describe rather than in a body that has not started yet (the `privateShop`
 * docblock in `e2e/fixtures.ts`). The same 45s `check-in.spec.ts` gives its
 * counter walks.
 */
test.describe.configure({ timeout: 60_000 });

/**
 * **The shop on paper** — ADR 20260908-one-hand, decision 6, lever X.
 *
 * Settings gains a Print register, and every row in it opens a sheet drawn from
 * the same rows the app already reads. What is worth driving in a browser is
 * the part no unit test can reach: that a door records the print run and the
 * register comes back saying so, that a sheet carries the day it was printed,
 * and that the boat card reaches the shop's own numbers.
 *
 * **A private shop, not blue-mantis.** Printing writes a `shop_print_runs`
 * row, that table is shop *configuration* rather than schedule, and the
 * per-test reset restores the schedule alone (`RESET_KEEPS`). Doing this to the
 * shared fixture would hand a dated register to whichever spec ran next in this
 * worker (ADR 20260815-per-test-private-shops).
 */
test.describe("the shop on paper", () => {
  test("the register prints the dock sign, and remembers that it did", async ({
    page,
    privateShop,
  }) => {
    // Settings' own door, rather than a typed URL: the row has to be findable
    // from the hub, which is the half a route test cannot see.
    await page.goto(`/shop/${privateShop.slug}/settings`);
    // The hub's own door, not the rail's — both name the same page, and the
    // rail is a desktop convenience rendered beside it.
    await page.getByRole("main").getByRole("link", { name: "Print", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}/settings/print$`));
    await expect(page.getByRole("heading", { level: 1, name: "Print" })).toBeVisible();

    // Nothing has been printed yet, and the register says so rather than
    // showing a date it does not have.
    await expect(page.getByText("Never printed").first()).toBeVisible();

    // The door is a form: it records the run and hands over the sheet.
    await page
      .locator('form:has(input[value="dock_sign"])')
      .getByRole("button", { name: "Print" })
      .click();
    await page.waitForURL(new RegExp(`/shop/${privateShop.slug}/print/dock-sign$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Our boats leave from here." }),
    ).toBeVisible();
    // The seeded fleet, on the sign.
    await expect(page.getByText("Mantis II")).toBeVisible();
    // The fold line carries the day the sheet was printed. The fleet's clock is
    // frozen, so this is the same date the register will show.
    const printedOn = page.getByText(/^Printed /).first();
    await expect(printedOn).toBeVisible();
    const printedText = (await printedOn.innerText()).replace(/^Printed /, "").replace(/\.$/, "");

    // Back to the register: the row is dated now. The row states the date
    // inside its own sentence, so the match is not anchored the way the fold
    // line's own text node is.
    await page.goto(`/shop/${privateShop.slug}/settings/print`);
    await expect(page.getByText(/Printed /).first()).toBeVisible();
    expect(printedText.length).toBeGreaterThan(0);
  });

  test("the boat card prints both sides, the shop's numbers and the rule about the app", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/settings/print`);

    // One row per hull. The seeded fleet is two boats, so the register lists
    // two cards and each door carries its own subject.
    const boatDoors = page.locator('form:has(input[value="boat_card"])');
    await expect(boatDoors).toHaveCount(2);
    await boatDoors.first().getByRole("button", { name: "Print" }).click();
    await page.waitForURL(new RegExp(`/shop/${privateShop.slug}/print/boat-card/`));

    // Two sides of one card, so every heading appears twice.
    await expect(page.getByRole("heading", { name: "Before the boat moves" })).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "If someone is missing" })).toHaveCount(2);
    // The roll the glossary insists on: by name, crew included, before
    // departure *and* after every dive.
    await expect(page.getByText(/Call the roll by name/).first()).toBeVisible();
    await expect(page.getByText(/after every dive/).first()).toBeVisible();
    // A missing diver is worked in the order search and rescue needs: the time
    // and the position first, and nobody leaves the site.
    await expect(page.getByText(/Note the time and mark the position/).first()).toBeVisible();
    await expect(page.getByText(/Do not leave the site/).first()).toBeVisible();
    // The one rule the card exists to state.
    await expect(page.getByText(/the app is the record/i).first()).toBeVisible();
    // The numbers block names every slot whether or not the shop has filled it
    // in — the vessel first, which is what a rescue coordinator asks the crew
    // reading this card for.
    await expect(page.getByText("Vessel").first()).toBeVisible();
    await expect(page.getByText("Shop").first()).toBeVisible();
    // Both kits get a rule of their own to fill in by hand.
    await expect(page.getByText("Oxygen and first aid").first()).toBeVisible();
    await expect(page.getByText("First aid kit, where").first()).toBeVisible();

    // **A minted shop has recorded none of it, and the card says nothing it
    // does not know.** Every slot is a ruled blank rather than a plausible
    // number, and the plan block is absent rather than a heading over nothing —
    // which on a boat would read as a plan somebody forgot to follow. The
    // seeded shop's filled-in card is asserted where it is photographed
    // (`e2e/visual.spec.ts`).
    await expect(page.locator(".paper-sheet-blank").first()).toBeVisible();
    await expect(page.getByText("If something goes wrong")).toHaveCount(0);
  });

  test("the counter prints a pass for the diver it just checked in", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/check-in`);

    // Check one diver in, so the settled group has a row with a pass door.
    const checkIn = page.getByRole("button", { name: /^Check in / }).first();
    await expect(checkIn).toBeVisible();
    const diverName = (await checkIn.innerText()).split("\n")[0]?.trim() ?? "";
    await checkIn.click();
    // The settled group's own count is the destination's answer that the write
    // landed — never a timeout. It is a folded `<details>`, so open it by its
    // summary rather than by a click on the text inside.
    const settled = page
      .locator("details")
      .filter({ hasText: /Checked in/ })
      .first();
    await expect(settled).toBeVisible();
    await settled.locator("> summary").click();

    await page.getByRole("button", { name: "Print a pass" }).first().click();
    await page.waitForURL(new RegExp(`/shop/${privateShop.slug}/print/pass/`));
    // Scoped to the sheet, not the page: the staff chrome around it carries a
    // nav badge, and what this asserts is what comes out of the printer.
    const sheet = page.locator(".paper-sheet");
    await expect(sheet.getByText("Show this at the counter, or say your name.")).toBeVisible();
    // The diver's name, and nothing about their readiness or their waiver.
    if (diverName) await expect(sheet.getByText(diverName).first()).toBeVisible();
    await expect(sheet.getByText("Blocked")).toHaveCount(0);
  });
});
