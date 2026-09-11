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
    // The purpose radio has no default, by design: a board link and a check-in
    // link grant different things, so a manager says which before one is minted
    // (N-24). That makes picking it part of every mint, this spec's included.
    await page.getByRole("radio", { name: "Departures board" }).check();
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

  /**
   * The names-on half, which the test above cannot see: it mints with names off
   * and asserts the negative, so the crew line never renders in it at all.
   *
   * What is pinned here is that the line says *what* the names are. A row
   * reading "With Ana Ruiz, Luis Perez" across a lobby, under a heading that is
   * the shop's own name and beside a seat count, does not tell a stranger
   * whether those are the crew, the divers already aboard, or who booked
   * (issue #1464) — and the setting that turns it on promises "only the crew who
   * agreed to be named appear, and divers never do". The role word is what makes
   * the promise legible on the wall rather than only in the settings copy.
   *
   * Minted through the seed route rather than the settings form because the
   * token is hashed at rest and shown once, the same way `e2e/visual.spec.ts`
   * photographs this surface.
   */
  test("with names on, the board says the names are the crew — and still names no diver", async ({
    page,
    request,
  }) => {
    const seeded = await request.post("/api/test/seed-display-token", {
      data: { label: "Lobby TV", showNames: true },
    });
    expect(seeded.ok()).toBe(true);
    const { path } = (await seeded.json()) as { path: string };

    const visitor = await page.context().browser()?.newContext();
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const board = makeActivitySafe(await visitor.newPage());
      await board.goto(path);
      await expect(board.getByText(REEF_TRIP)).toBeVisible();

      // By shape, not by a literal name: which cast member consents is seed
      // data, and `departures-board.test.ts` already pins that the reef trip
      // resolves to exactly one consented public name.
      await expect(board.getByText(/^Crew: \S/).first()).toBeVisible();

      // Consent is the only gate, and it is a crew gate: turning names on must
      // never turn on a diver's.
      const text = await board.locator("main").innerText();
      expect(text).not.toContain("Priya Sharma");
      expect(text).not.toContain("Tom Okafor");
    } finally {
      await visitor.close();
    }
  });
});

/**
 * **A wall has no reader** (#1462). Every test above opens its signed-out
 * screen in a context that reports the runner's own language; these two hand
 * the television a language the shop does not speak, which is the whole of the
 * defect — factory-default US hardware in a Spanish-speaking lobby, and no
 * cookie a staffer could ever set on it.
 *
 * The locale goes on `newContext()` rather than `test.use()`: the board is
 * always opened in a context this spec mints by hand, and a fixture-level
 * locale would never reach it.
 */
test.describe("a screen speaks the shop's language, not the television's", () => {
  signedInAsOwner();

  test("a Spanish-speaking television still renders an English shop's board in English", async ({
    page,
    request,
  }) => {
    const seeded = await request.post("/api/test/seed-display-token", {
      data: { label: "Lobby TV" },
    });
    expect(seeded.ok()).toBe(true);
    const { path } = (await seeded.json()) as { path: string };

    // blue-mantis takes the column default, `en-US`; nothing in the seed
    // writes `defaultLocale`. So the shop is English and the screen is not.
    const visitor = await page.context().browser()?.newContext({ locale: "es-ES" });
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const board = makeActivitySafe(await visitor.newPage());
      await board.goto(path);
      await expect(board.getByText("Blue Mantis Divers")).toBeVisible();
      // The footer renders on every board, empty day or not. Before this the
      // reader's `Accept-Language` won and it read "Actualizado a las …".
      await expect(board.getByText(/^Updated /)).toBeVisible();
      // And the subtree says which language it is in, since `<html lang>` is
      // corrected client-side from the television's own `navigator.languages`.
      await expect(board.locator("main")).toHaveAttribute("lang", "en-US");
    } finally {
      await visitor.close();
    }
  });

  test("a refused screen link still answers in the reader's own language", async ({ page }) => {
    // The other half of the answer, and the half that must not change: no
    // token resolves to no shop, so there is no default to prefer and the
    // person holding a dead link reads it in their own words.
    const visitor = await page.context().browser()?.newContext({ locale: "es-ES" });
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const forged = makeActivitySafe(await visitor.newPage());
      await forged.goto("/board/not-a-real-token");
      await expect(
        forged.getByRole("heading", { name: "Este enlace de pantalla no está disponible" }),
      ).toBeVisible();
    } finally {
      await visitor.close();
    }
  });
});
