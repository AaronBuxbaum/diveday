import { expect, makeActivitySafe, READ_ONLY, signedInAsOwner, test } from "./fixtures";
import { bookASeatAndOpenThread, seededTripId } from "./helpers";

/**
 * **Follow the boat** — ADR 20260908-one-hand, decision 6, lever U.
 *
 * A diver hands their boat's link to whoever is waiting on the dock; that
 * person opens it with no account, no capability and no session, and reads a
 * stage word, a time and the departure's own line — and nothing about who is
 * aboard. The pair is the feature, so the first test runs it as a pair.
 *
 * The last test takes **a shop of its own**: it writes the shop-wide switch,
 * which `/api/test/reset` never restores.
 */
const REEF_TRIP = "Two-Tank Reef — Molasses & French";

test.describe("the shop's own boats", () => {
  signedInAsOwner();
  // Every test here opens one or two browser contexts of its own — a diver's,
  // a stranger's — because "holds no session" is half of what each asserts,
  // and a context launch is most of the clock. The budget sits on the
  // describe rather than in each body: it has to cover *fixture* setup, which
  // is where the signed-in context is built and which `test.setTimeout`
  // inside a test cannot reach.
  test.describe.configure({ timeout: 60_000 });

  test("a diver shares the boat's link and a stranger reads its day", async ({ page }) => {
    const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);

    // The share row is on the diver's own thread, and what it hands over is
    // the boat's page rather than the capability URL the diver is standing on.
    const diver = await page.context().browser()?.newContext();
    if (!diver) throw new Error("no browser to open a diver’s context with");
    let followUrl: string;
    try {
      const diverPage = makeActivitySafe(await diver.newPage());
      await diverPage.goto(`/s/blue-mantis/trips/${tripId}`);
      await bookASeatAndOpenThread(diverPage, "Shore Party Diver");
      await expect(
        diverPage.getByText("Share with whoever is waiting for you", { exact: true }),
      ).toBeVisible();
      // Chromium here has no Web Share API, so the row falls back to a copy —
      // and the copy is the assertion: what lands on the clipboard is the
      // boat's public page, never `/ready/<token>`.
      await diver.grantPermissions(["clipboard-read", "clipboard-write"]);
      await diverPage.getByRole("button", { name: "Share", exact: true }).click();
      await expect(
        diverPage.getByRole("button", { name: "Link copied", exact: true }),
      ).toBeVisible();
      followUrl = await diverPage.evaluate(() => navigator.clipboard.readText());
      // **Absolute, on the canonical host** — this link exists to be pasted
      // into a group chat, so `publicAppUrl()` is what it wears rather than
      // the worker's own 127.0.0.1 port. Which is why the stranger below
      // opens its *path*: the fleet has no route to `APP_HOST`.
      expect(new URL(followUrl).origin).toBe("https://e2e.diveday.example");
      expect(followUrl).toContain(`/s/blue-mantis/boats/${tripId}`);
      expect(followUrl).not.toContain("/ready/");
    } finally {
      await diver.close();
    }

    // The shore party: no account, no capability, no session.
    const stranger = await page.context().browser()?.newContext();
    if (!stranger) throw new Error("no browser to open a signed-out context with");
    try {
      const strangerPage = makeActivitySafe(await stranger.newPage());
      await strangerPage.goto(new URL(followUrl).pathname);
      // Scoped to the page's own `<main>` throughout: the shop's chrome and
      // the DiveDay footer credit ("Bookings by DiveDay") sit outside it, and
      // a negative assertion that reaches them proves nothing about the page.
      const boat = strangerPage.getByRole("main");
      await expect(boat.getByRole("heading", { level: 1 })).toBeVisible();
      // The departure's own line, with the plan's sites on it.
      await expect(boat.getByText("Check-in", { exact: true })).toBeVisible();
      await expect(boat.getByText("Back", { exact: true })).toBeVisible();
      await expect(boat.getByText("Molasses Reef", { exact: true })).toBeVisible();
      // ...and nobody on it, by name or by count. The word "aboard" itself is
      // on the page — it is in the one sentence saying this page does not name
      // who is aboard — so what this refuses is a *number* beside it.
      await expect(boat.getByText("Shore Party Diver")).toHaveCount(0);
      await expect(boat.getByText(/\d+\s*(aboard|on board|divers?)/)).toHaveCount(0);
      await expect(boat.getByText(/seats? left/)).toHaveCount(0);
      // Two doors, and no door that sells a seat.
      await expect(boat.getByRole("link", { name: "Directions" })).toBeVisible();
      await expect(boat.getByRole("link", { name: /^Book/ })).toHaveCount(0);
    } finally {
      await stranger.close();
    }
  });

  test("the storefront points at the boat that is out", { tag: READ_ONLY }, async ({ page }) => {
    const stranger = await page.context().browser()?.newContext();
    if (!stranger) throw new Error("no browser to open a signed-out context with");
    try {
      const strangerPage = makeActivitySafe(await stranger.newPage());
      await strangerPage.goto("/s/blue-mantis");
      const follow = strangerPage.getByRole("link", { name: "Follow", exact: true });
      await expect(follow).toBeVisible();
      await follow.click();
      await expect(strangerPage).toHaveURL(/\/s\/blue-mantis\/boats\//);
      await expect(strangerPage.getByText("Check-in", { exact: true })).toBeVisible();
    } finally {
      await stranger.close();
    }
  });
});

/**
 * **Off is a 404, not an empty state.** A shop that has not said yes has said
 * nothing at all: a page reading "this shop does not share that" would still
 * confirm the departure exists, which is the fact the shop declined to
 * publish. New shops start off (`shops.public_boat_line` defaults false); the
 * seeded demo shops start on, because a demo with the feature dark is a worse
 * demo, so this test turns the switch off and watches everything go with it.
 */
test.describe("the switch on Settings", () => {
  // As above, plus the `privateShop` fixture's own mint and sign-in.
  test.describe.configure({ timeout: 90_000 });

  test("takes the boats off the world when a shop turns it off", async ({ page, privateShop }) => {
    const tripId = await seededTripId(page, privateShop.slug, REEF_TRIP);

    const before = await page.context().browser()?.newContext();
    if (!before) throw new Error("no browser to open a signed-out context with");
    try {
      const strangerPage = makeActivitySafe(await before.newPage());
      await strangerPage.goto(`/s/${privateShop.slug}/boats/${tripId}`);
      await expect(strangerPage.getByText("Check-in", { exact: true })).toBeVisible();
    } finally {
      await before.close();
    }

    await page.goto(`/shop/${privateShop.slug}/settings/display`);
    await expect(
      page.getByRole("heading", { name: "Where each boat is in its day", exact: true }),
    ).toBeVisible();
    // The sentence beside the switch says exactly what leaves the shop.
    await expect(page.getByText(/A stage word and a time, never who is aboard\./)).toBeVisible();
    const toggle = page.getByLabel("Say where each boat is in its day");
    await toggle.uncheck();
    await page
      .locator("form")
      .filter({ has: toggle })
      .getByRole("button", { name: "Save" })
      .click();
    // The row's own **server-rendered** value word, not the checkbox: the
    // checkbox is uncontrolled, so it reads unchecked from the moment of the
    // click whether or not the write ever landed, and the next line opens a
    // second browser against a page this one has not finished saving
    // (check:e2e-hygiene's `action-race`, which this test tripped for real).
    await expect(page.getByText("Off", { exact: true })).toBeVisible();

    const after = await page.context().browser()?.newContext();
    if (!after) throw new Error("no browser to open a signed-out context with");
    try {
      const strangerPage = makeActivitySafe(await after.newPage());
      await strangerPage.goto(`/s/${privateShop.slug}/boats/${tripId}`);
      // The shop's own dead-link page, asserted by what a reader sees rather
      // than by the HTTP status: this route has a static shell (`◐` in the
      // build output), so the 200 leaves before the `notFound()` inside it is
      // reached. What matters is that the boat's day is gone and the page says
      // the same thing a link to a deleted departure says.
      await expect(
        strangerPage.getByRole("heading", { name: "That page isn’t here any more" }),
      ).toBeVisible();
      await expect(strangerPage.getByText("Check-in", { exact: true })).toHaveCount(0);
      // The storefront's own line goes with it — one switch, every surface.
      await strangerPage.goto(`/s/${privateShop.slug}`);
      await strangerPage.getByRole("heading", { level: 1 }).first().waitFor();
      await expect(strangerPage.getByRole("link", { name: "Follow", exact: true })).toHaveCount(0);
    } finally {
      await after.close();
    }
  });
});
