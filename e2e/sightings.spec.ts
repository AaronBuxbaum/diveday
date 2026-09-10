import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripTab } from "./helpers";

/**
 * **The living reef, end to end**: a crew taps a species chip at the rail after
 * a dive, and a diver reading that site's departure page sees what the crew has
 * been logging there — as a frequency with a date on it, never as a promise.
 *
 * Not READ_ONLY. The first test writes `trip_sightings` from the manifest, and
 * `/api/test/reset` is what keeps the tally it leaves out of the next spec's
 * fixture.
 */
signedInAsOwner();

/**
 * Open the departure that has actually **sailed**, and its after-dive view.
 *
 * The demo's first-light boat: 5:30–8:30 AM against a 9:30 AM clock, so it is
 * home. Today's headline reef charter is five hours *out*, and the Seen group
 * deliberately does not exist before a boat has left — a sighting on a
 * departure still alongside would publish "seen here" for a dive nobody has
 * done, and `recordTripSighting` refuses one as well.
 */
const SAILED_TRIP = "Dawn Two-Tank — Molasses Reef";

async function openReefManifest(page: import("@playwright/test").Page) {
  // The day's own spine, not the schedule board: the board lists what is still
  // to come, and this boat is back.
  await page.goto("/shop/blue-mantis");
  await page.getByRole("link", { name: SAILED_TRIP, exact: true }).first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
  await openTripTab(page, "Manifest");
  // The after-dive checkpoint is where the crew records the day: the Seen
  // group sits under the dive log there and is deliberately absent at the dock,
  // where there is nothing yet to have seen.
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await page.waitForURL(/checkpoint=after_dive_1/);
}

test("the crew taps what they saw and the tally counts it", async ({ page }) => {
  // Seven full server round trips — the day spine, the trip page, the manifest,
  // a checkpoint switch, two taps and a delete — each re-rendering a nine-diver
  // manifest. That is comfortably past the default 15s ceiling once the
  // config's own parallelism puts two workers and two Next servers on the same
  // cores, and it timed out reproducibly at the very first navigation. Same
  // reasoning as `manifest.spec.ts`'s own long tests: the budget is there to
  // bound a *stuck* test, and this one is simply long.
  test.setTimeout(45_000);
  await openReefManifest(page);

  const seen = page.getByRole("region", { name: "Seen" });
  await expect(seen).toBeVisible();
  // The site the taps attach to is named on the group's one line, so a crew
  // working a two-tank day knows which reef they are logging.
  await expect(seen.getByText(/At Molasses Reef\./)).toBeVisible();

  // The site's own field guide leads the chip row (`seenChipSlugs`), and
  // Molasses names the southern stingray on its own (`seed-dive-sites.ts`).
  const chip = seen.getByRole("button", { name: "Southern stingray", exact: true });
  await chip.click();
  // The list under the chips is the tap's whole answer — wait on what it
  // renders rather than on the click, which resolves when the request leaves.
  const tally = seen.getByRole("listitem").filter({ hasText: "Southern stingray" });
  await expect(tally).toContainText("1");

  // A second tap on the same chip counts a second one rather than adding a row.
  await chip.click();
  await expect(tally).toContainText("2");
  await expect(seen.getByRole("listitem")).toHaveCount(1);

  // A mis-tap is taken back, and the word on the control is Delete.
  await seen.getByRole("button", { name: "Delete Southern stingray" }).click();
  await expect(seen.getByRole("listitem")).toHaveCount(0);

  // **Offline is said before the tap** (issue #1625). The surface interval
  // between two tanks is the only moment a crew taps these chips and it is also
  // when a boat has no bars, so the refusal was arriving at the one moment the
  // group is ever used. Here rather than in its own test because the warning
  // costs no navigation and this manifest is already open — a second test would
  // spend four round trips to reach the same section.
  await page.context().setOffline(true);
  await expect(seen.getByRole("status")).toContainText(
    "Offline — a tap will not save until the boat has bars",
  );
  // The chips stay tappable under it: the browser's flag is not reachability,
  // and a dead chip on a wet deck reads as a broken app rather than a missing
  // bar.
  await expect(chip).toBeEnabled();

  // And the warning goes when the bars come back — no permanently green badge
  // on a surface where connectivity is not the subject.
  await page.context().setOffline(false);
  await expect(seen.getByRole("status")).toHaveCount(0);
});

test("a diver reads the crew's month under the site on the trip page", async ({ page }) => {
  // Two navigations and a cold public render; well inside the default budget on
  // a quiet box and past it on a loaded one.
  test.setTimeout(30_000);
  // The seeded log (`src/db/seed-sightings.ts`) puts a month of the crew's own
  // taps on Molasses and French, which is what this beat reads.
  await page.goto("/s/blue-mantis");
  await page
    .getByRole("link", { name: /Two-Tank Reef — Molasses & French/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\//);

  const day = page.getByRole("heading", { name: "The day" });
  await expect(day).toBeVisible();
  await expect(page.getByText("Seen here this month").first()).toBeVisible();
  // A frequency with a denominator, not a species list: the whole point of the
  // beat is that it says how often, out of how many dives.
  await expect(
    page.getByText(/Southern stingray on \d+ of \d+ logged dives here this month/),
  ).toBeVisible();
  await expect(page.getByText(/Last seen /).first()).toBeVisible();
  // And the sentence that stops a log being read as a guarantee.
  await expect(
    page
      .getByText("What the crew logged, and when. It says what was seen, not what you will see.")
      .first(),
  ).toBeVisible();

  // The sky rides the same beat: a morning charter says when the light arrives
  // and when it goes, computed from the site's own coordinates.
  await expect(page.getByText(/Sunrise .*, sunset .*\./)).toBeVisible();
});
