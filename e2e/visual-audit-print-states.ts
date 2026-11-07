import { signedInAsOwner, test } from "./fixtures";
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
}
