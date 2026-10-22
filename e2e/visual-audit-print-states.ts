import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";
import type { AuditPrintCapture } from "./visual-audit-capture";

export function registerPrintAuditCaptures(capturePrint: AuditPrintCapture) {
  test.describe("print — additional document states", () => {
    signedInAsOwner();
    test.use({ viewport: { width: 816, height: 1056 } });

    test("the work-order claim tag prints its actual paper layout", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear/work-orders");
      await page
        .getByRole("link", { name: /Breathes wet at depth/ })
        .first()
        .click();
      await page.getByRole("link", { name: "Print claim tag" }).click();
      // This printable document deliberately has no main landmark.
      await page.getByRole("heading", { name: "What we have" }).waitFor();
      await capturePrint(page, "work-order-claim-tag");
    });
  });

  test.describe("print — divemaster signed-waiver privacy", () => {
    signedInAs("divemaster");
    test.use({ viewport: { width: 816, height: 1056 } });

    test("the divemaster's signed waiver prints only the allowed medical summary", async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis/schedule/board");
      await openTripFromBoard(page, "Afternoon Two-Tank — French Reef");
      await openTripTab(page, "Trip");
      const diver = page
        .locator("li")
        .filter({ has: page.getByText("Rowan Pike", { exact: true }) })
        .filter({ visible: true });
      await diver.getByRole("link", { name: "View signed record" }).click();
      await page.getByRole("heading", { level: 1, name: "Signed waiver" }).waitFor();
      await expect(page.getByRole("main").getByText(/^Physician:/)).toHaveCount(0);
      await capturePrint(page, "signed-waiver-divemaster");
    });
  });
}
