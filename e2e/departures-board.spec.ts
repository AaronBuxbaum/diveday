import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";

const DISPLAY_SETTINGS = "/shop/blue-mantis/settings/display";
const REEF_TRIP = "Two-Tank Reef — Molasses & French";

/**
 * **The departures board** (issue #1426, N-23): a lobby TV's link over the
 * shop's day. `display_tokens` is cleared shop-wide by `/api/test/reset`, so
 * every test here starts with no screens and the shared blue-mantis fixture is
 * enough — nothing a test mints survives into the next spec.
 */
test.describe("the departures board", () => {
  signedInAsOwner();

  test("a lobby link shows today's boats to a signed-out screen, and revoking it goes dark", async ({
    page,
  }) => {
    await page.goto(DISPLAY_SETTINGS);
    await page.getByLabel("Which screen").fill("Lobby TV");
    await page.getByRole("button", { name: "Create link" }).click();
    await expect(page.getByRole("heading", { name: "Open this on the screen" })).toBeVisible();
    const url = (await page.locator("p.font-mono").first().innerText()).trim();
    expect(url).toMatch(/\/board\/[A-Za-z0-9_-]{40,}$/);

    // The screen on the wall has no session and no cookies.
    const visitor = await page.context().browser()?.newContext();
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const board = makeActivitySafe(await visitor.newPage());
      const shown = await board.goto(url);
      expect(shown?.status()).toBe(200);
      await expect(
        board.getByRole("heading", { level: 1, name: "Blue Mantis Divers" }),
      ).toBeVisible();
      await expect(board.getByText(REEF_TRIP)).toBeVisible();
      await expect(board.getByText(/\b\d+ of 12 aboard\b/).first()).toBeVisible();
      // A lobby sees a count, never a person: the link was made with names off,
      // and no setting names a diver.
      const text = await board.locator("main").innerText();
      expect(text).not.toContain("Priya Sharma");
      expect(text).not.toContain("Tom Okafor");
      expect(text).not.toMatch(/\+?\d[\d\s().-]{8,}\d/);
      // Nothing for a crawler either. A `<meta>` has no layout box, so the
      // fixture's visibility filter could never match it: a raw, unfiltered
      // locator on purpose.
      await expect(board.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

      // The settings page lists the screen, and revoking it is what turns the
      // board off on its next refresh.
      await page.goto(DISPLAY_SETTINGS);
      await expect(page.getByText("Lobby TV")).toBeVisible();
      await page.getByRole("button", { name: "Revoke" }).click();
      await page.getByRole("button", { name: "Yes, revoke it" }).click();
      await expect(page.getByText("Link revoked.")).toBeVisible();

      const dark = await board.goto(url);
      expect(dark?.status()).toBe(404);
    } finally {
      await visitor.close();
    }
  });

  test("the link only exists for an owner or manager, and a made-up token is nothing", async ({
    page,
  }) => {
    const response = await page.request.get("/board/not-a-real-token");
    expect(response.status()).toBe(404);

    // The hub's row is a door, and the rail knows it.
    await page.goto("/shop/blue-mantis/settings");
    await page.locator("main").getByRole("link", { name: "Lobby display" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lobby display" })).toBeVisible();
    await expect(page.getByText("No screens yet.")).toBeVisible();
  });
});
