import { expect, READ_ONLY, signedInAs, test } from "./fixtures";

/**
 * READ_ONLY holds here: all three tests land on Today and read what the lens leads with.
 */

// The role lens (20260721-role-aware-landing): the same Today, led by the
// signed-in person's work. Each role gets its own cached session
// (`signedInAs`, e2e/fixtures.ts) — the lens on the page content is the
// point, not the act of signing in.

test.describe("as captain", () => {
  signedInAs("captain");

  test("a captain's Today leads with the boat they crew and filters to boat work", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // The cached session (signedInAs) carries cookies but never navigates —
    // land on Today ourselves, same as the live sign-in flow used to.
    await page.goto("/shop/blue-mantis");
    // The seed assigns the captain to today's charter, so their station wears
    // the one badge a station may wear. It is **not** moved up the spine for
    // them: clock order wins for every reader (ADR
    // 20260827-clearwater-surface-language, decision 4).
    await expect(page.getByText("You’re crewing", { exact: false }).first()).toBeVisible();
    // The stations themselves read in clock order, ascending, whoever is
    // looking — the badge marks the boat, it never moves it up the spine.
    const stamps = await page
      .locator("ol > li time")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime") ?? ""));
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps).toEqual([...stamps].sort());

    // A captain's station rows withhold clerical and commercial work, and the
    // withheld line keeps its place under the summary sentence.
    await expect(page.getByText(/jobs? for the front desk/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send waiver" })).toHaveCount(0);
  });
});

test.describe("as divemaster", () => {
  signedInAs("divemaster");

  test("a divemaster's Today leads with the boat they crew and filters clerical rows", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await expect(page.getByText("You’re crewing", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/jobs? for the front desk/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send waiver" })).toHaveCount(0);
  });
});

test.describe("as instructor", () => {
  signedInAs("instructor");

  test("an instructor's Today leads with their sessions and student readiness", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    // Its own labeled group, between the summary sentence and the first
    // station — not a stack of sunken cards.
    await expect(page.getByRole("heading", { name: "Your sessions" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open roster" }).first()).toBeVisible();
  });
});

test.describe("as owner", () => {
  signedInAs("owner");

  test("an owner keeps the whole-shop Today with no lens and no withheld notice", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Good (morning|afternoon|evening|night), Dana/,
    );
    await expect(page.getByRole("heading", { name: "Your sessions" })).toHaveCount(0);
    await expect(page.getByText("You’re crewing")).toHaveCount(0);
    await expect(page.getByText(/jobs? for the front desk/)).toHaveCount(0);
    // And no view control, on any lens: the two views the switch chose between
    // are gone, and the clock decides the order.
    await expect(page.getByRole("navigation", { name: "How to read the queue" })).toHaveCount(0);
  });
});
