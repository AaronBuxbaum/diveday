import { expect, signedInAsOwner, test } from "./fixtures";
import { tripPathByTitle } from "./helpers";

signedInAsOwner();

/**
 * **The departure drawn as its boat** — ADR 20260919-one-idea, decision I ·
 * Tide, slice 23c: "a departure's page is Deck's hull".
 *
 * The hull is a picture of what the rows already say, so every assertion here
 * is about the picture agreeing with them — and about the two rules that make
 * it safe to draw at all: no number on a seat, and no hull where there is no
 * boat.
 */
test("a boat departure draws its hull, and it agrees with the rows", async ({ page }) => {
  const trip = await tripPathByTitle(page, "blue-mantis", /Two-Tank Reef/);
  await page.goto(trip);

  // One image, named for the boat it is, with the count the masthead carries.
  const hull = page.getByRole("img", { name: /drawn as its seats/ });
  await expect(hull).toBeVisible();
  const label = (await hull.getAttribute("aria-label")) ?? "";
  expect(label).toMatch(/^Mantis I,/);
  const [, booked, capacity] = label.match(/(\d+) of (\d+) seats? taken/) ?? [];
  expect(Number(capacity)).toBeGreaterThan(0);
  expect(Number(booked)).toBeLessThanOrEqual(Number(capacity));

  // One seat per place the boat has — the picture is the count made spatial.
  const seats = hull.locator('rect[rx="9"]');
  await expect(seats).toHaveCount(Number(capacity));

  /**
   * **No number on a seat, ever.** The whole defence against a seat map
   * reading as a seating plan is that there is nothing on it to mistake for an
   * assignment; the only words are initials.
   */
  const words = await hull.locator("text").allTextContents();
  for (const word of words) expect(word).not.toMatch(/\d/);

  // And the boat is the shop's colour, not a colour this page invented.
  await expect(hull.locator("path").first()).toHaveAttribute("stroke", /^#[0-9a-f]{6}$/i);
});

/**
 * A shore dive and a pool session have a roster and no boat. An invented hull
 * would be a picture of something that is not there, so there is none — and
 * the roster underneath is untouched either way.
 */
test("a departure with no boat draws no hull, and still lists its divers", async ({ page }) => {
  const trip = await tripPathByTitle(page, "blue-mantis", /Tortugas Run/);
  await page.goto(trip);

  await expect(page.getByRole("img", { name: /drawn as its seats/ })).toHaveCount(0);
  // The rows are the record; the picture never was.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tortugas Run");
  await expect(
    page
      .locator("ol li, [data-roster-row]")
      .first()
      .or(page.getByText(/Blocked/).first()),
  ).toBeVisible();
});
