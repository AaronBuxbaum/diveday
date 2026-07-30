import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";
import { capture } from "./visual-capture";

test.describe("staff-prepared trip", () => {
  signedInAsOwner();

  test("a booked diver's readiness page lets them act, and saves an emergency contact", async ({
    page,
  }) => {
    // Unique title for this spec's own trip; the e2eNow() suffix keeps every
    // test-side timestamp anchored to the frozen clock (helpers.ts).
    // Isolation from other specs — including the visual suite — comes from
    // the per-test demo reset in fixtures.ts.
    const title = `Readiness Run ${e2eNow().getTime()}`;

    // Staff puts a trip on the board.
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(4));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:00");
    await page.getByLabel("Capacity").fill("6");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);

    // A visitor books it.
    await page.goto("/shop/blue-mantis/schedule", { waitUntil: "domcontentloaded" });
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Nemo Quinn");
    // Same frozen-clock suffix convention as the trip title above.
    await page.getByLabel("Email", { exact: true }).fill(`nemo-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();

    // The confirmation hands the diver their readiness link — follow it.
    await page.getByRole("link", { name: /readiness page/ }).click();
    await expect(page).toHaveURL(/\/ready\//);
    await expect(page.getByRole("heading", { name: "Your pre-trip checklist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Emergency contact" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rental fit" })).toBeVisible();

    // The emergency contact is transactional now — the diver fills it in place.
    await page.getByLabel("Contact name").fill("Coral Quinn");
    await page.getByLabel("Contact phone").fill("+1 305 555 0180");
    await page.getByRole("button", { name: "Save contact" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Emergency contact saved" }),
    ).toBeVisible();
    // The row now reads as on file rather than asking again.
    await expect(page.getByText(/On file — Coral Quinn/)).toBeVisible();
  });
});

test("a tampered readiness token reveals nothing", async ({ page }) => {
  await page.goto("/ready/not-a-real-token");
  await expect(page.getByRole("heading", { name: /readiness link isn.t available/ })).toBeVisible();
});

// Visual regression capture for this file's surface (see e2e-and-visual
// skill / e2e/visual-capture.ts). Moved here from the old e2e/visual.spec.ts
// "site tour".
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, { tag: "@visual" }, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test(`the readiness page renders true to the design (${scheme})`, async ({ page }) => {
      // A fresh visitor booking the seeded reef trip hands back a readiness
      // link — the pre-trip checklist a diver actually uses on the way to
      // the dock. Signed out throughout, exactly as a real diver reaches it.
      await page.goto("/shop/blue-mantis/schedule");
      await page
        .locator("li")
        .filter({ hasText: "Two-Tank Reef — Molasses & French" })
        .getByRole("link")
        .click();
      await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
      await page.getByLabel("Name", { exact: true }).fill("Visual Regression Diver");
      await page
        .getByLabel("Email", { exact: true })
        .fill(`visual-regression-${scheme}@example.com`);
      await page.getByRole("button", { name: /^Book/ }).click();
      await page.getByRole("heading", { name: /You’re on the boat/ }).waitFor();
      const readinessHref = await page
        .getByRole("link", { name: /readiness page/ })
        .getAttribute("href");
      await page.goto(readinessHref ?? "/");
      await page.getByRole("heading", { name: "Your pre-trip checklist" }).waitFor();
      // This is a fresh unpaid booking, so the "Need to change your plans?"
      // reschedule/cancel section (docs ADR 20260727-diver-self-service-cancel)
      // renders too — no separate capture needed, it's part of this same
      // full-page screenshot.
      await capture(page, "readiness", scheme);
    });
  });
}
