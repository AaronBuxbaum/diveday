import { expect, test } from "./fixtures";
import { openSettingsRow, openTripAbout } from "./helpers";

/**
 * **The tide window** (ADR 20260907-noaa-tide-predictions): a site that names
 * a NOAA station carries one line — the nearest slack and which way the water
 * is moving when the boat arrives — on the staff site briefing and the
 * departure page, and on the diver's page only once the shop switches it on.
 *
 * The fleet has no route to NOAA (`DIVEDAY_DISABLE_EXTERNAL_HTTP`), so the
 * seam serves a deterministic fixture table; the assertions match the shape
 * of the sentence rather than a phase, since which phase the fixture lands on
 * is the arithmetic's business, not this spec's.
 *
 * **Each test takes a shop of its own** (`privateShop`): the second one writes
 * a shop-wide setting, which `/api/test/reset` never restores, and the first
 * edits a seeded site's station — schedule-scoped, but a minted shop carries
 * the same seeded Molasses Reef and keeps both tests on one fixture.
 */

const STAFF_LINE = /Slack at \d{1,2}:\d{2} [AP]M; this departure reaches the site/;
const DIVER_LINE = /Slack at \d{1,2}:\d{2} [AP]M; the boat reaches the site/;
const REEF_TRIP = "Two-Tank Reef — Molasses & French";

test.describe("the tide window", () => {
  test("a stationed site's briefing and departure say where the water is when the boat arrives", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    await page.goto(`/shop/${privateShop.slug}/dive-sites`);
    await page.getByRole("link", { name: "Molasses Reef" }).first().click();
    await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
    const siteUrl = page.url();
    // The demo's Key Largo reef reads Carysfort Reef's table (seed-tides.ts).
    await expect(page.getByLabel("NOAA tide station")).toHaveValue("8723583");
    await expect(page.getByLabel("Dives best")).toHaveValue("any");
    // Upcoming departures that dive here each carry the line.
    await expect(page.getByText(STAFF_LINE).first()).toBeVisible();

    // The departure page carries it beside the crew's own read of the water,
    // in About's conditions block rather than in the strip that summarises it.
    await page.getByRole("link", { name: REEF_TRIP }).first().click();
    await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
    await openTripAbout(page);
    await expect(page.getByText(STAFF_LINE).first()).toBeVisible();

    // An id of the wrong shape is refused by name, and nothing typed is lost.
    await page.goto(siteUrl);
    await page.getByLabel("NOAA tide station").fill("87235");
    await page.getByRole("button", { name: "Save dive site" }).click();
    await expect(page.getByText(/A NOAA tide station id is seven digits/)).toBeVisible();
    await expect(page.getByLabel("NOAA tide station")).toHaveValue("87235");

    // Clearing it takes the line off every surface — a blank says nothing.
    await page.goto(siteUrl);
    await page.getByLabel("NOAA tide station").fill("");
    await page.getByRole("button", { name: "Save dive site" }).click();
    await page.getByText("Dive site saved.").waitFor();
    await expect(page.getByText(STAFF_LINE)).toHaveCount(0);
  });

  test("divers read the line only once the shop switches it on", async ({ page, privateShop }) => {
    test.setTimeout(60_000);
    // Off by default: the public departure page says nothing about the tide.
    await page.goto(`/s/${privateShop.slug}`);
    await page.getByRole("link", { name: REEF_TRIP }).first().click();
    await page.getByRole("heading", { name: "The day" }).waitFor();
    const tripUrl = page.url();
    await expect(page.getByText(DIVER_LINE)).toHaveCount(0);

    await page.goto(`/shop/${privateShop.slug}/settings`);
    // Settings rows are disclosures; the checkbox is inside a closed one.
    await openSettingsRow(page, "Tide window");
    const toggle = page.getByLabel("Show the tide window on public departure pages");
    await toggle.check();
    await page
      .locator("form")
      .filter({ has: toggle })
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByText("Divers now see the tide window on departure pages."),
    ).toBeVisible();

    await page.goto(tripUrl);
    await page.getByRole("heading", { name: "The day" }).waitFor();
    await expect(page.getByText(DIVER_LINE).first()).toBeVisible();
  });
});
