import { DEMO_TODAY_TRIP_ID } from "../src/db/seed/identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { manifestRow, openManifestPerson } from "./helpers";
import { capture, installVisualBuildGuard, SURFACE_TIMEOUT_MS } from "./visual-harness";

installVisualBuildGuard();
signedInAsOwner();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
const staff = staffTranslator("en-US");
const DIVER = "Priya Sharma";

/**
 * Issue #4307: after a dive, the crew notes on a diver's person sheet that
 * they sat that dive out, and takes it back to unknown with the same tap. The
 * head count beside it never moves.
 */
test("the crew notes a diver sat out dive one, and takes it back (light)", async ({ page }) => {
  const manifest = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}/manifest?checkpoint=after_dive_1`;
  const openSheet = async () => {
    await openManifestPerson(await manifestRow(page, DIVER));
    const sheet = page.locator('[role="dialog"]:not([inert])');
    await expect(sheet.getByRole("heading", { name: DIVER, exact: true })).toBeVisible();
    return sheet.getByRole("group", { name: staff("manifest.participation.label", { number: 1 }) });
  };
  await page.goto(manifest);
  let dive = await openSheet();
  const satOut = () =>
    dive.getByRole("button", { name: staff("manifest.participation.satOut"), exact: true });
  const dived = () =>
    dive.getByRole("button", { name: staff("manifest.participation.dived"), exact: true });
  // Unknown is where every seat starts: neither answer is pressed.
  await expect(satOut()).toHaveAttribute("aria-pressed", "false");
  await expect(dived()).toHaveAttribute("aria-pressed", "false");

  await satOut().click();
  await expect(satOut()).toHaveAttribute("aria-pressed", "true");
  await expect(satOut()).not.toHaveAttribute("aria-busy", "true");

  // The note was written, not just drawn: it comes back from the server.
  await page.goto(manifest);
  dive = await openSheet();
  await expect(satOut()).toHaveAttribute("aria-pressed", "true");
  await expect(dived()).toHaveAttribute("aria-pressed", "false");
  await capture(page, "manifest-person-sheet-sat-out", "light", {
    beforeShot: async () => {
      dive = await openSheet();
      await expect(satOut()).toHaveAttribute("aria-pressed", "true");
    },
  });

  // Tapping the pressed answer takes it back to unknown.
  await satOut().click();
  await expect(satOut()).toHaveAttribute("aria-pressed", "false");
  await expect(satOut()).not.toHaveAttribute("aria-busy", "true");
  await page.goto(manifest);
  dive = await openSheet();
  await expect(satOut()).toHaveAttribute("aria-pressed", "false");
  await expect(dived()).toHaveAttribute("aria-pressed", "false");
});
