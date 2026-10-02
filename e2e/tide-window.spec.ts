import { expect, test } from "./fixtures";
import { openTripAbout } from "./helpers";

/**
 * **The tide window** (ADR 20260907-noaa-tide-predictions): a site that names
 * a NOAA station carries one line — the nearest slack and which way the water
 * is moving when the boat arrives — on the staff site briefing and the
 * departure page. Divers never read it: the public tide window was cut (ADR
 * 20261001-logbook).
 *
 * The fleet has no route to NOAA (`DIVEDAY_DISABLE_EXTERNAL_HTTP`), so the
 * seam serves a deterministic fixture table; the assertions match the shape
 * of the sentence rather than a phase, since which phase the fixture lands on
 * is the arithmetic's business, not this spec's.
 *
 * **The test takes a shop of its own** (`privateShop`): it edits a seeded
 * site's station, and a minted shop carries the same seeded Molasses Reef.
 */

/** `\s` before the meridiem: a formatted time keeps "7:05 AM" whole with
 *  U+00A0, and `getByText` matches a regex against the raw text. */
const TURN = /(Next|Last) (high|low) water at \d{1,2}:\d{2}\s[AP]M/;
const STAFF_LINE = new RegExp(`${TURN.source}; this departure reaches the site`);
const REEF_TRIP = "Two-Tank Reef — Molasses & French";
/** Whose water the turn came from (issue #1732); the fleet's fixture station. */
const STATION = "Tide at Carysfort Reef, FL";

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
    // inside About's Conditions row rather than in the one line that
    // summarises it.
    await page.getByRole("link", { name: REEF_TRIP }).first().click();
    await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
    await openTripAbout(page);
    await page.getByText(/Write a crew prediction|Edit crew prediction/).click();
    await expect(page.getByText(STAFF_LINE).first()).toBeVisible();
    // And whose water it is (issue #1732). The fleet's fixture station is
    // Carysfort Reef, FL, whatever id is asked for — which is the station the
    // demo's Key Largo sites genuinely read.
    await expect(page.getByText(STATION).first()).toBeVisible();

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
    await expect(page.getByText(STATION)).toHaveCount(0);
  });
});
