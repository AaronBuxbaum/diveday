/** One physical person keeps passenger and crew evidence on screen and paper. */
import { staffSoulsOnBoardLine } from "../src/i18n/participant-labels";
import { staffTranslator } from "../src/i18n/staff-messages";
import { crewRowId } from "../src/lib/element-id";
import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";
import {
  capture,
  capturePrint,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.use(VISUAL_STEP_BOUNDS);
test.describe("light mode", () => {
  test.use({
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    privateShopSlug: "dual-role-manifest-visual",
  });
  test("dual-role physical totals retain a missing passenger's separate crew evidence", async ({
    page,
    request,
    privateShop,
  }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const { dualRoleManifest } = await seedFacts(request, ["dualRoleManifest"], {
      slug: privateShop.slug,
    });
    const fact = dualRoleManifest as {
      tripId: string;
      personId: string;
      fullName: string;
      passengers: number;
      crew: number;
      physicalTotal: number;
    };
    const t = staffTranslator("en-US");
    const href = `/shop/${privateShop.slug}/trips/${fact.tripId}/manifest`;
    await page.goto(href);
    await expect(
      page.getByRole("progressbar", { name: t("manifest.progressAriaLabel") }),
    ).toHaveAttribute("aria-valuenow", "4");
    // Seven role records describe six people: this must not raise a false hull alarm.
    await expect(
      page.getByText(t("manifest.headCountOverTotalPersons", { limit: fact.physicalTotal }), {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: t("manifest.rollCallComplete"), exact: true }),
    ).toBeVisible();
    await capture(page, "manifest-dual-role-departure", "light");

    await page.goto(`${href}?checkpoint=after_dive_1`);
    await expect(
      page
        .getByRole("list", { name: t("manifest.notBackAboardListLabel") })
        .getByText(fact.fullName, { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(`#${crewRowId(fact.personId)} [data-mark-state="aboard"]`),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: t("manifest.progressAriaLabel") }),
    ).toHaveAttribute("aria-valuenow", "3");
    await capture(page, "manifest-dual-role-missing", "light");

    await page.emulateMedia({ media: "print" });
    const sheet = page.locator(".paper-sheet");
    const physicalLine = staffSoulsOnBoardLine(
      t,
      { totalDivers: fact.passengers, byType: { diver: 2, snorkeler: 1, rider: 1 } },
      fact.crew,
      fact.physicalTotal,
    );
    // The sheet paragraph prefixes these exact totals with the boat name.
    await expect(sheet.getByText(physicalLine, { exact: false })).toBeVisible();
    await expect(sheet.getByText(fact.fullName, { exact: true })).toHaveCount(2);
    await expect(sheet).toContainText(t("shared.rollCallState.notBackAboard"));
    await capturePrint(page, "manifest-dual-role-missing-print");
  });
});
