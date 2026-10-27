/** The departure log separates captured boarding evidence from today's cards. */
import { staffTranslator } from "../src/i18n/staff-messages";
import { formatEvidenceDateTimeTz } from "../src/lib/format";
import { expect, test } from "./fixtures";
import { e2eNow } from "./helpers";
import {
  capture,
  capturePrint,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.use(VISUAL_STEP_BOUNDS);
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — boarding certification evidence`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "boarding-certification-divers",
    });
    test(`boarding evidence and current cards read separately (${scheme})`, async ({
      page,
      request,
      privateShop,
    }) => {
      test.setTimeout(FLOW_TIMEOUT_MS);
      const response = await request.post(
        `/api/test/seed-trouble-states?operationalTrust=capacity&certificationInterval=1&shop=${privateShop.slug}`,
      );
      expect(response.ok()).toBe(true);
      const { operationalTrust } = await response.json();
      await page.goto(`/shop/${privateShop.slug}/trips/${operationalTrust.tripId}/log`);
      const t = staffTranslator("en-US");
      const evidence = page.getByRole("listitem").filter({ hasText: "Ari Vale" });
      const at = e2eNow().getTime();
      const stamp = (offset: number) =>
        formatEvidenceDateTimeTz(new Date(at + offset), "en-US", "America/New_York");
      await expect(
        evidence.getByText(
          t("incidentExport.certCapturedAt", { start: stamp(45_125), end: stamp(45_175) }),
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: "Ari Vale" }).getByText(stamp(1), { exact: false }),
      ).toBeVisible();
      await expect(evidence.getByText(t("incidentExport.certCurrent"))).toBeVisible();
      await expect(evidence.getByText("OPERATIONAL-capacity-0", { exact: true })).toHaveCount(2);
      const rider = page.getByRole("listitem").filter({ hasText: "Dax Reed" });
      await expect(rider.getByText(t("incidentExport.certNone"))).toHaveCount(2);
      await capture(page, "departure-log-boarding-certification", scheme);
      if (scheme === "light") await capturePrint(page, "departure-log-boarding-certification");
    });
  });
}
