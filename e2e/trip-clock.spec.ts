import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripPhase, seededTripId, type TripPhase } from "./helpers";
import { seedFacts } from "./shop-facts";

signedInAsOwner();

const t = staffTranslator("en-US");
const es = staffTranslator("es-ES");
const PHASES: readonly TripPhase[] = ["filling", "ready", "checkin", "water", "wrapped"];
/** A seeded boat at Check-in on the frozen clock. */
const OPEN_BOAT = "Two-Tank Reef — Molasses & French";

/**
 * **The Trip page is a clock** (ADR 20261117-trip-page-clock): one departure,
 * five phases on a strip, each its own panel. Every phase opens from the strip
 * on any departure, whatever the clock says, and Edit trip sits beside them.
 */
test("every phase of a departure opens from the strip, and Edit trip beside them", async ({
  page,
}) => {
  test.slow(); // Five phase renders and Edit trip on one departure, each a server round trip.
  const tripId = await seededTripId(page, "blue-mantis", OPEN_BOAT);
  await page.goto(`/shop/blue-mantis/trips/${tripId}`);
  // The clock opens on the phase the boat is in.
  await expect(page.locator('[data-trip-phases] a[data-phase="checkin"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator('[data-phase-panel="checkin"]')).toBeVisible();
  // An incident is reported from the header's More, in every phase.
  const more = page.locator("[data-more-menu]").filter({ visible: true }).first();
  await more.getByRole("button", { name: t("trips.clock.more"), exact: true }).click();
  await expect(
    more.getByRole("button", { name: t("trips.clock.reportIncident"), exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  for (const phase of PHASES) {
    await openTripPhase(page, phase);
    await expect(page.locator(`[data-phase-panel="${phase}"]`)).toBeVisible();
  }
  await page
    .getByRole("link", { name: t("trips.clock.editTrip"), exact: true })
    .first()
    .click();
  await expect(page.locator('[data-phase-panel="edit"]')).toBeVisible();
});

/**
 * **Roll call after a dive, from the Trip page, in one tap.** While the boat is
 * out, On the water says who is not recorded back, and its roll call door opens
 * the count for the dive that just ended, not the dock's.
 */
test.describe("isolated on-water fixture", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("On the water opens the roll call for the dive that just ended in one tap", async ({
    page,
    request,
    privateShop,
  }) => {
    const { boatOnTheWater } = (await seedFacts(
      request,
      [{ name: "boatOnTheWater", state: "outstanding" }],
      { slug: privateShop.slug },
    )) as { boatOnTheWater: { tripId: string } };
    await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}`);
    const water = page.locator('[data-phase-panel="water"]');
    await expect(water).toBeVisible();
    await water
      .getByRole("link", { name: t("trips.clock.water.openRollCall"), exact: true })
      .click();
    await page.waitForURL(/\/manifest\?checkpoint=after_dive_1$/);
  });
});

/**
 * **Close out a wrapped trip.** Wrapped up lists what is left (a dive with no
 * log), each with its fix; logging the dive takes it off the list.
 */
test.describe("isolated wrapped fixture", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("Wrapped up lists what is left, and logging the dive closes it", async ({
    page,
    request,
    privateShop,
  }) => {
    const { boatOnTheWater } = (await seedFacts(
      request,
      [{ name: "boatOnTheWater", state: "unfinished" }],
      { slug: privateShop.slug },
    )) as { boatOnTheWater: { tripId: string } };
    await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}?phase=checkin`);
    await page
      .getByRole("link", { name: t("trips.clock.wrapped.lookBackOpen", { count: 2 }) })
      .click();
    await page.waitForURL(/phase=wrapped$/);
    const wrapped = page.locator('[data-phase-panel="wrapped"]');
    const noLog = wrapped.getByText(t("trips.clock.wrapped.noLog", { dive: 2 }), { exact: true });
    await expect(noLog).toBeVisible();
    await wrapped
      .getByRole("link", { name: t("trips.clock.wrapped.logDive", { dive: 2 }), exact: true })
      .click();
    const log = page.locator("form").filter({ hasText: "Dive 2" });
    await log.getByLabel(/Maximum depth/).fill("12");
    await log.getByRole("button", { name: "Save dive record" }).click();
    await expect(log.getByText("Dive record saved")).toBeVisible();
    await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}?phase=wrapped`);
    await expect(wrapped).toBeVisible();
    await expect(noLog).toHaveCount(0);
  });
});

/**
 * **No sideways scroll on a phone, in the longer language.** Spanish runs about
 * a third longer than English; every phase and Edit trip still fit 390px.
 */
test("every phase fits a 390px phone in Spanish", async ({ page }) => {
  test.slow(); // Six full renders of one departure.
  await page.setViewportSize({ width: 390, height: 844 });
  const tripId = await seededTripId(page, "blue-mantis", OPEN_BOAT);
  const path = `/shop/blue-mantis/trips/${tripId}`;
  await page.goto(path);
  await page.context().addCookies([{ name: "diveday_locale", value: "es-ES", url: page.url() }]);
  for (const query of [...PHASES.map((phase) => `phase=${phase}`), "view=edit"]) {
    await page.goto(`${path}?${query}`);
    await expect(page.locator("[data-phase-panel]")).toBeVisible();
    // Edit trip is not a phase, so it draws no strip (design review of the final screens, 12).
    await expect(page.getByRole("navigation", { name: es("trips.clock.label") })).toHaveCount(
      query === "view=edit" ? 0 : 1,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${query} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
