import { expect, test } from "./fixtures";
import { openCounterFor } from "./helpers";

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
 * The paper pass, printed at the counter for a diver without a phone. What is
 * worth driving in a browser is the part no unit test can reach: that the
 * counter's door reaches the sheet, and that the sheet carries the diver's
 * name and nothing about their readiness.
 */
test.describe("the shop on paper", () => {
  test("the counter prints a pass for the diver it just checked in", async ({
    page,
    privateShop,
  }) => {
    // A boat inside the counter's window, found the way the desk finds one.
    await openCounterFor(page, privateShop.slug, "Diego Alvarez");
    // The counter's own hydration signal: a tap that lands before the row's
    // handler is attached is lost, and on a loaded CI shard that left the
    // settled group never appearing.
    await expect(page.locator("[data-check-in-queue]")).toHaveAttribute("data-hydrated", "true");

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

    await page.getByRole("link", { name: "Print a pass" }).first().click();
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
