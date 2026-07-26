import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow } from "./helpers";

async function openWreckTrip(page: Page) {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link")
    .click();
}

test.describe("staff", () => {
  signedInAsOwner();

  test("a verified nitrox card turns a diver's tanks to enriched air on the prep list", async ({
    page,
  }) => {
    // A unique card number keeps the flow self-contained and re-run safe.
    const cardNo = `EANX-T${e2eNow().getTime()}`;

    // Nitrox evidence is handled with the diver's other cards, then verified there.
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("link", { name: /June Park/ }).click();
    await page.getByText("Add specialty", { exact: true }).click();
    // The diver page has two capture forms (level card, specialty card), both
    // with name="identifier"/name="specialty" inputs; scope to the specialty
    // form so the selectors resolve unambiguously under strict mode.
    const specialtyForm = page.locator("form", {
      has: page.getByRole("button", { name: "Capture specialty for review" }),
    });
    await specialtyForm.locator('select[name="specialty"]').selectOption("nitrox");
    await specialtyForm.locator('input[name="identifier"]').fill(cardNo);
    await page.getByRole("button", { name: "Capture specialty for review" }).click();
    await expect(page.getByRole("status")).toContainText("captured");

    const card = page.locator("li").filter({ hasText: cardNo });
    await card.getByRole("button", { name: "Mark certified" }).click();
    await expect(page.getByRole("status")).toContainText("certified");

    await openWreckTrip(page);
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Prep" })
      .click();
    await expect(page.getByRole("heading", { name: /Wreck Trip/ })).toBeVisible();

    // The prep list is derived from rental fit, so it always lists tanks and
    // rental kit even when nobody on the boat rents a single piece of kit.
    await expect(page.getByRole("heading", { name: "Rental kit" })).toBeVisible();
    // One tank per diver per dive, and the seeded nitrox request is on the split.
    await expect(page.getByText("one tank per diver per dive")).toBeVisible();
    const tanks = page.getByRole("heading", { name: "Tanks" }).locator("xpath=..");
    await expect(tanks).toContainText("Nitrox");
    // Nothing on this page claims to know what is in a cylinder.
    await expect(page.getByText("DiveDay logs no gas analysis")).toBeVisible();
  });

  test("resaving the rental-fit form after the shop disables nitrox doesn't clear an existing request", async ({
    page,
    browser,
    workerBaseURL,
  }) => {
    // Two actors (diver + staff), a settings round trip each way, and a prep-
    // list read — comfortably past the suite's 15s default in exchange for
    // covering a real data-loss regression end to end; the try/finally below
    // must reach its cleanup so a slow run never leaves the shared demo
    // shop's nitrox catalog off for whatever test runs next in this worker.
    test.setTimeout(30_000);
    // The diver's half of this test runs signed out — a fresh context so the
    // owner session on `page` (used to toggle settings below) never bleeds
    // into it, the same reason the settings-toggle test above uses its own
    // onboarded shop rather than this one.
    const anonContext = await browser.newContext({
      baseURL: workerBaseURL,
      storageState: { cookies: [], origins: [] },
    });
    const anon = await anonContext.newPage();
    await anon.goto("/shop/blue-mantis/schedule");
    await anon
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
      .getByRole("link")
      .click();
    await anon.getByLabel("Name").fill("Priya Sharma");
    await anon.getByLabel("Email").fill(`priya+${e2eNow().getTime()}@example.com`);
    await anon.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(anon.getByRole("heading", { name: /You're on the boat, Priya/ })).toBeVisible();

    await anon.locator('input[name="nitrox"]').check();
    await anon.getByRole("button", { name: "Save rental fit" }).click();
    await expect(anon.locator('input[name="nitrox"]')).toBeChecked();
    const bookingUrl = anon.url();
    // The trip id rides along in the confirmation URL — reuse it below
    // instead of clicking back through the schedule as staff.
    const tripId = bookingUrl.match(/\/schedule\/([^/?]+)/)?.[1];
    if (!tripId) throw new Error("booking confirmation URL missing a trip id");

    try {
      await page.goto("/shop/blue-mantis/settings");
      await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
      await page.getByRole("button", { name: "Save rental catalog" }).click();
      await expect(page.getByText("Rental catalog saved.")).toBeVisible();

      // The diver comes back to add an unrelated note. The nitrox fieldset is
      // gone (the shop doesn't fill it any more), but saving must not
      // silently erase the request already on file for this trip.
      await anon.goto(bookingUrl);
      await expect(anon.locator('input[name="nitrox"]')).toHaveCount(0);
      await anon.getByLabel("Anything else the crew should know?").fill("Bringing my own mask.");
      await anon.getByRole("button", { name: "Save rental fit" }).click();
      await expect(anon.getByText("Saved.")).toBeVisible();

      // The request survives even with nitrox off — read it back from the
      // prep list (visible with the catalog disabled per the live-data check
      // above) rather than re-enabling nitrox just to look at the checkbox.
      await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
      const tanks = page.getByRole("heading", { name: "Tanks" }).locator("xpath=..");
      await expect(tanks).toContainText("Nitrox");
    } finally {
      // Restore the shared demo shop's catalog — resetDemoSchedule only
      // clears bookings/trips, never shop settings (src/db/seed.ts), so a
      // test that disables nitrox here must turn it back on or every later
      // test in this worker sees it missing.
      await page.goto("/shop/blue-mantis/settings");
      await page.getByRole("checkbox", { name: "Nitrox fills" }).check();
      await page.getByRole("button", { name: "Save rental catalog" }).click();
      await expect(page.getByText("Rental catalog saved.")).toBeVisible();
    }
    await anonContext.close();
  });

  test("the prep page collapses Total and Air into one tile when nitrox is off with no live request", async ({
    page,
  }) => {
    try {
      await page.goto("/shop/blue-mantis/settings");
      await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
      await page.getByRole("button", { name: "Save rental catalog" }).click();
      await expect(page.getByText("Rental catalog saved.")).toBeVisible();

      // Two-Tank Reef never had a nitrox request seeded onto it (unlike the
      // wreck charter above), so with the catalog off there is no live data
      // to keep the tile alive: Total and Air are the same number with
      // nothing left to distinguish, and the tile grid collapses to one.
      await page.goto("/shop/blue-mantis/schedule");
      await page
        .locator("li")
        .filter({ hasText: "Two-Tank Reef — Molasses & French" })
        .getByRole("link")
        .click();
      await page
        .getByRole("navigation", { name: "Trip" })
        .getByRole("link", { name: "Prep" })
        .click();
      const tanks = page.getByRole("heading", { name: "Tanks" }).locator("xpath=..");
      await expect(tanks.getByText("Total", { exact: true })).toHaveCount(1);
      await expect(tanks.getByText("Air", { exact: true })).toHaveCount(0);
      await expect(tanks.getByText("Nitrox", { exact: true })).toHaveCount(0);
    } finally {
      await page.goto("/shop/blue-mantis/settings");
      await page.getByRole("checkbox", { name: "Nitrox fills" }).check();
      await page.getByRole("button", { name: "Save rental catalog" }).click();
      await expect(page.getByText("Rental catalog saved.")).toBeVisible();
    }
  });
});

// blue-mantis is the shared demo fixture every other spec in the suite reads
// from, and its rental catalog survives the per-test reset (resetDemoSchedule
// only clears bookings/trips, not shop settings — src/db/seed.ts). Toggling
// its "what we rent" catalog here would leak into whatever test runs next in
// this worker, so this exercises a freshly onboarded trial shop instead: a
// real (non-demo) shop, its own unique slug, never touched by demo reset, and
// nobody else's fixture to pollute.
test("a freshly onboarded shop starts without nitrox, and turning it on unlocks the price field", async ({
  page,
}) => {
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').fill("Nitrox Off Divers");
  await page.locator('input[name="shopSlug"]').fill("nitrox-off-e2e");
  await page.locator('input[name="ownerName"]').fill("Nadia Cole");
  await page.locator('input[name="ownerEmail"]').fill("nadia-nitrox-e2e@example.com");
  await page.locator('input[name="ownerPassword"]').fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();
  await expect(page).toHaveURL(/\/shop\/nitrox-off-e2e/);

  await page.goto("/shop/nitrox-off-e2e/settings");
  const nitroxCheckbox = page.getByRole("checkbox", { name: "Nitrox fills" });
  await expect(nitroxCheckbox).not.toBeChecked();
  // Most shops don't fill nitrox: no price field to fill in until it's ticked.
  await expect(page.locator('input[name="nitroxPrice"]')).toHaveCount(0);

  await nitroxCheckbox.check();
  await page.getByRole("button", { name: "Save rental catalog" }).click();
  await expect(page.getByText("Rental catalog saved.")).toBeVisible();
  await expect(page.locator('input[name="nitroxPrice"]')).toHaveCount(1);
});

test("a diver without a verified card can request nitrox but is flagged, not blocked", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
    .getByRole("link")
    .click();
  await page.getByLabel("Name").fill("Nora Quinn");
  // Unique email for this spec's own diver; the e2eNow() suffix keeps every
  // test-side timestamp anchored to the frozen clock (helpers.ts). Isolation
  // from other specs — including the visual suite — comes from the per-test
  // demo reset in fixtures.ts.
  await page.getByLabel("Email").fill(`nora+${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();

  // No card on file, but the request is offered with a flag — the diver can ask
  // now and is told to send their card before the crew can reserve a compatible tank.
  await expect(
    page.getByText(
      "A verified nitrox card is needed before the crew can reserve nitrox-compatible tanks.",
    ),
  ).toBeVisible();
  const nitrox = page.locator('input[name="nitrox"]');
  await expect(nitrox).toHaveCount(1);
  await nitrox.check();
  await page.getByRole("button", { name: "Save rental fit" }).click();

  // The request stuck (checkbox stays on) and the flag still explains what's needed.
  await expect(page.locator('input[name="nitrox"]')).toBeChecked();
  await expect(page.getByText("Your enriched-air request is on file")).toBeVisible();
});
