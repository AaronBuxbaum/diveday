/** Auth/settings action states on a deterministic private shop; no real delivery or token pixels. */
import { expect, test } from "./fixtures";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  staffCopy,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "settings-visual-divers",
    });
    test.describe("staff", () => {
      test(`a newer failed backup keeps the last success visible (${scheme})`, async ({
        page,
        request,
        privateShop,
      }) => {
        const seeded = await request.post(
          `/api/test/seed-trouble-states?settingsState=backup-failed&shop=${privateShop.slug}`,
        );
        expect(seeded.ok()).toBe(true);
        await page.goto(`/shop/${privateShop.slug}/settings/export/backups`);
        await page.getByText(/Latest delivery: Failed/).waitFor();
        await page
          .getByText(staffCopy("backup.deliveryError.network_unreachable"), { exact: true })
          .first()
          .waitFor();
        await capture(page, "settings-backups-latest-failed", scheme);
      });

      test(`a newly issued calendar row keeps its controls beside its scope (${scheme})`, async ({
        page,
        privateShop,
      }) => {
        await page.goto(`/shop/${privateShop.slug}/settings/calendar`);
        const scope = page.locator("section").filter({
          has: page.getByRole("heading", {
            name: staffCopy("calendar.scope.assignments.name"),
            exact: true,
          }),
        });
        await scope
          .getByRole("button", { name: staffCopy("calendar.actions.create"), exact: true })
          .click();
        await scope.getByRole("heading", { name: staffCopy("calendar.newLink.heading") }).waitFor();
        // The real action/state is exercised; a random bearer URL is never photographed.
        // Keep the origin and token length, substituting an inert example not stored by the server.
        await scope.locator("p.font-mono").evaluateAll((nodes) => {
          for (const node of nodes)
            node.textContent = (node.textContent ?? "").replace(
              /(\/calendar\/)[A-Za-z0-9_-]+(\.ics)/g,
              `$1${"x".repeat(43)}$2`,
            );
        });
        await capture(page, "settings-calendar-issued-example", scheme);
      });
    });
  });
}
