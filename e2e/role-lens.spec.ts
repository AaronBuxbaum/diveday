import { expect, signedInAs, test } from "./fixtures";

// The role lens (20260721-role-aware-landing): the same Today, led by the
// signed-in person's work. Each role gets its own cached session
// (`signedInAs`, e2e/fixtures.ts) — the lens on the page content is the
// point, not the act of signing in.

test.describe("as captain", () => {
  signedInAs("captain");

  test("a captain's Today leads with the boat they crew", async ({ page }) => {
    // The cached session (signedInAs) carries cookies but never navigates —
    // land on Today ourselves, same as the live sign-in flow used to.
    await page.goto("/shop/blue-mantis");
    // The seed assigns the captain to today's charter, so their boat is badged
    // and the greeting names it.
    await expect(page.getByText("You’re crewing", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Boarding" }).first()).toBeVisible();
  });
});

test.describe("as instructor", () => {
  signedInAs("instructor");

  test("an instructor's Today leads with their sessions and student readiness", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { name: "Your sessions" })).toBeVisible();
    const firstSession = page
      .locator("section", { has: page.getByRole("heading", { name: "Your sessions" }) })
      .getByRole("link", { name: "Open roster" })
      .first();
    await expect(firstSession).toBeVisible();
  });
});

test.describe("as owner", () => {
  signedInAs("owner");

  test("an owner keeps the whole-shop Today, no lens", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Good (morning|afternoon|evening|night), Dana/,
    );
    await expect(page.getByRole("heading", { name: "Your sessions" })).toHaveCount(0);
    await expect(page.getByText("You’re crewing")).toHaveCount(0);
  });
});
