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
    request,
  }) => {
    // A second screen, so the list holds two rows. Without it the revoke button
    // is unambiguous by accident, and the defect this spec now pins -- two rows
    // announcing as "Revoke, button" twice -- cannot appear at all.
    const seeded = await request.post("/api/test/seed-display-token", {
      data: { label: "Dock B tablet" },
    });
    expect(seeded.ok()).toBe(true);

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
      // Seats until a departure roll call has begun, divers once it has. The
      // seeded boat has no roll call yet, so it reads booked-of-capacity --
      // the pairing the glossary calls the fill rate.
      await expect(board.getByText(/\b\d+ of 12 seats booked\b/).first()).toBeVisible();
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

      // The settings page lists both screens, and revoking one is what turns
      // that board off on its next refresh.
      await page.goto(DISPLAY_SETTINGS);
      await expect(page.getByText("Lobby TV")).toBeVisible();
      await expect(page.getByText("Dock B tablet")).toBeVisible();
      // Two DISTINCT accessible names, which is the whole point: a count of two
      // buttons passes just as happily when both are called "Revoke", and that
      // is the bug. The screen's own name sits in a sibling paragraph outside
      // the button, so only an explicit label puts it in the accessible name.
      await expect(page.getByRole("button", { name: "Revoke Dock B tablet" })).toBeVisible();
      await page.getByRole("button", { name: "Revoke Lobby TV" }).click();
      // Only one row is armed at a time, so the confirm stays unambiguous.
      await page.getByRole("button", { name: "Yes, revoke it" }).click();
      await expect(page.getByText("Link revoked.")).toBeVisible();
      // The named trigger hit the row it named, not merely some row.
      await expect(page.getByText("Dock B tablet")).toBeVisible();
      await expect(page.getByRole("button", { name: "Revoke Lobby TV" })).toHaveCount(0);

      // The screen goes dark in place: a capability route refuses in its own
      // words rather than through DiveDay's 404, whose one button goes to a
      // software sales page (`src/app/capability-refusals.test.ts`). What
      // matters on a wall is that the day is gone from it.
      await board.goto(url);
      await expect(
        board.getByRole("heading", { name: "This screen link isn’t available" }),
      ).toBeVisible();
      await expect(board.getByText(REEF_TRIP)).toHaveCount(0);
      await expect(board.getByText("Blue Mantis Divers")).toHaveCount(0);
    } finally {
      await visitor.close();
    }
  });

  test("a made-up token names nobody, and the hub carries the door to the screens", async ({
    page,
  }) => {
    // A token that was never ours resolves to no shop, so it names none.
    const visitor = await page.context().browser()?.newContext();
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const forged = makeActivitySafe(await visitor.newPage());
      await forged.goto("/board/not-a-real-token");
      await expect(
        forged.getByRole("heading", { name: "This screen link isn’t available" }),
      ).toBeVisible();
      await expect(forged.getByText("Blue Mantis")).toHaveCount(0);
    } finally {
      await visitor.close();
    }

    // The hub's row is a door, and the rail knows it.
    await page.goto("/shop/blue-mantis/settings");
    await page.locator("main").getByRole("link", { name: "Lobby display" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lobby display" })).toBeVisible();
    await expect(page.getByText("No screens yet.")).toBeVisible();
  });
});
