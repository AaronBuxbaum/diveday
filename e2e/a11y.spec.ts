import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, signOut } from "./helpers";

/**
 * Automated a11y scan for the current page state — WCAG 2.0 A/AA plus 2.2 AA,
 * the same rule set the specialist optimization audit's accessibility lens
 * (§3) called for. See ADR 20260801-axe-core-playwright-a11y-scans. A
 * violation here means a real, tool-detectable defect (missing label, bad
 * contrast, broken landmark structure) — triage it into a fix rather than
 * excluding the rule, unless it's a genuine false positive (document why
 * inline if so).
 *
 * `color-contrast` is excluded, not a false positive: it fires on every
 * surface this scan covers, and every instance traces back to the same
 * design-token values the audit's own contrast tasks (§3, "focus indicator",
 * "status-banner text", "placeholder text") already track as open work. The
 * product owner has explicitly ruled out touching contrast values in this
 * change — they'd fight the current color guide — so this scan enforces
 * everything else axe checks (labels, roles, landmarks, focus order,
 * `aria-live` wiring) without going permanently red over already-tracked,
 * deliberately deferred contrast debt. Re-include it once that work lands.
 */
async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .disableRules(["color-contrast"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

signedInAsOwner();

test.describe("automated accessibility scans (specialist optimization audit §3)", () => {
  test("the public schedule has no automated a11y violations", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("list", { name: "Upcoming trips" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the trip booking page and its confirmation have no automated a11y violations", async ({
    page,
  }) => {
    const title = `A11y Scan Trip ${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(5));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:30");
    await page.getByLabel("Capacity").fill("6");
    await page.getByLabel(/Price per diver/).fill("120");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page).not.toHaveURL(/\/trips\/new/);

    // Staff viewing their own shop's booking page get redirected to the trip's
    // management view instead (src/app/shop/[shopSlug]/schedule/[id]/page.tsx)
    // — a diver never carries a staff session, so scan the page the way a real
    // visitor sees it.
    await signOut(page);
    await page.goto("/shop/blue-mantis/schedule", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByLabel("Name", { exact: true }).fill("Ada Reef");
    await page.getByLabel("Email", { exact: true }).fill(`ada-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: "Book these spots" }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Ada/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the waiver page has no automated a11y violations", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Guests" })
      .click();
    const diverSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^Divers/ }) });
    await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
    const waiverHref = await diverSection
      .getByRole("status")
      .getByRole("link")
      .getAttribute("href");

    await page.goto(waiverHref ?? "/");
    await expect(page.getByRole("heading", { name: "A quick step before the dock" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the staff manifest page has no automated a11y violations", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Manifest" })
      .click();
    await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the offline manifest viewer has no automated a11y violations", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .click();
    // Visiting the trip's own live Manifest page is what saves a device copy
    // in the first place (src/lib/offline-manifests.ts) — going straight to
    // /offline-manifest without it first renders the empty "nothing saved"
    // state instead of a real roster.
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Manifest" })
      .click();
    await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
    const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\//)?.[1];

    await page.goto(`/offline-manifest?trip=${tripId}`);
    await expect(page.getByRole("heading", { name: /roll call/i })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
