import { expect, signedInAsOwner, test } from "./fixtures";
import { capture } from "./visual-capture";

signedInAsOwner();

test("staff opens a diver from their avatar and can reach them from the header", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  // The extended roster is well past one default page, sorted alphabetically —
  // search for her rather than assume she's on the unfiltered first page.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

  // The whole person cell is one link, so the initials avatar opens the diver
  // just like the name does.
  const row = page.getByRole("row").filter({ hasText: "Priya Sharma" });
  await row.getByText("PS", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // Contact details are one tap from the front desk: mail the diver or call them.
  const header = page.locator("header").last();
  await expect(header.locator('a[href^="mailto:"]')).toBeVisible();
  await expect(header.locator('a[href^="tel:"]')).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // The table hides sideways columns behind a scroll on a 390px screen, so
  // the list swaps to stacked cards there — everything readable, no scroll.
  test("the divers list stacks into cards and still opens the diver", async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

    const card = page.getByRole("link", { name: /Priya Sharma/ });
    await expect(card).toBeVisible();
    await expect(card.getByText(/card/)).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();

    await card.click();
    await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();
  });
});

// Visual regression captures for this file's surfaces (see e2e-and-visual
// skill / e2e/visual-capture.ts). Moved here from the old e2e/visual.spec.ts
// "site tour".
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, { tag: "@visual" }, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test(`the roster and a diver's profile render true to the design (${scheme})`, async ({
      page,
    }) => {
      test.setTimeout(20_000);
      // The roster, then one diver's full profile (certs, specialty cards,
      // contact) — the front desk's densest everyday surfaces. Wait for the
      // roster itself, not the skeleton.
      await page.goto("/shop/blue-mantis/divers");
      await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
      await page.getByRole("searchbox", { name: "Search divers" }).waitFor();
      await capture(page, "divers", scheme);

      // Found by search, not by scrolling: the demo shop now has enough
      // divers to page the roster, so nobody is reliably on the first page.
      await page.goto("/shop/blue-mantis/divers?q=Priya");
      await page
        .getByRole("row")
        .filter({ hasText: "Priya Sharma" })
        .getByText("PS", { exact: true })
        .click();
      await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor();
      await capture(page, "diver-profile", scheme);

      // A diver holding a card past its shop refresher-due date: the
      // "refresher due" badge renders red and the card no longer counts as
      // valid — the safety-relevant state (H-08: cards don't expire).
      await page.goto("/shop/blue-mantis/divers?q=Yusuf");
      await page
        .getByRole("row")
        .filter({ hasText: "Yusuf Demir" })
        .getByText("YD", { exact: true })
        .click();
      await page.getByRole("heading", { level: 1, name: "Yusuf Demir" }).waitFor();
      await capture(page, "diver-profile-expired", scheme);
    });
  });
}
