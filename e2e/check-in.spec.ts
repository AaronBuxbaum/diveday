import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, openTripFromBoard } from "./helpers";

signedInAsOwner();

test("counter check-in searches by diver, confirms live readiness, and keeps blocked rows out of the line", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/check-in");
  await expect(page.getByRole("heading", { name: "Counter check-in" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Check-in queue" })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Scan or search diver" });
  await search.fill("Priya Sharma");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/check-in\?q=Priya\+Sharma/);

  const card = page
    .locator("article")
    .filter({ hasText: "Priya Sharma" })
    .filter({ visible: true });
  await expect(card).toHaveCount(1);
  // One readiness vocabulary and one tone per state
  // (src/i18n/readiness-labels.ts): the counter used to call this diver "Needs
  // attention" in warning while the manifest called the same person "Blocked"
  // in danger. The danger-tone Badge prepends a decorative aria-hidden glyph
  // (Badge.tsx toneGlyph), so the element's own text is "✕ Blocked".
  await expect(card.getByText("✕ Blocked")).toBeVisible();
  await expect(card.getByText("Waiver has not been sent.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Check in Priya Sharma" })).toHaveCount(0);

  await search.fill("not-a-real-diver");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "No one matches that scan" })).toBeVisible();
});

test("a counter walk-in books straight onto a boat with no email required", async ({ page }) => {
  await page.goto("/shop/blue-mantis/check-in");
  await page.getByRole("link", { name: "Walk-in" }).click();
  await expect(page.getByRole("heading", { name: "Walk-in", level: 1 })).toBeVisible();

  const tripSection = page.locator("section").filter({ hasText: "Which boat?" });
  const firstTrip = tripSection.locator("ul li a").filter({ visible: true }).first();
  await expect(firstTrip).toBeVisible();
  const tripText = await firstTrip.innerText();
  const tripTitle = tripText.split(" · ")[0];
  if (!tripTitle) throw new Error("could not read a trip title from the walk-in picker");
  await firstTrip.click();
  await expect(page).toHaveURL(/tripId=/);
  // The chosen boat is echoed back so the crew can confirm before adding anyone.
  await expect(page.getByText(tripTitle, { exact: false }).first()).toBeVisible();

  // A search for someone who isn't on file falls through to hand-entry.
  const search = page.getByRole("searchbox", { name: "Search by name, email, or phone" });
  await search.fill("Zzyzx No Such Diver");
  await search.press("Enter");
  await expect(page.getByText(/No matches for/)).toBeVisible();

  await page.locator('input[name="fullName"]').filter({ visible: true }).fill("Walk-in Test Diver");
  // Email and phone are left blank on purpose — the whole point of this flow.
  await page.getByRole("button", { name: "Add to boat" }).click();

  // No email was collected, so no waiver could be mailed — and the notice says
  // so rather than implying one is on its way. This is the *ordinary* counter
  // outcome, not an edge case: the diver is seated and the link is still owed.
  await expect(page).toHaveURL(/\/check-in\?notice=walkin_added_waiver_undelivered/);
  await expect(
    page.getByText("Added to this boat’s list — but their waiver wasn’t emailed."),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Walk-in Test Diver" }).filter({ visible: true }),
  ).toHaveCount(1);
});

test("a full boat refuses a counter walk-in with the wait-list nudge", async ({ page }) => {
  // A same-day, one-seat trip so it's both offered by the walk-in picker
  // (today's/tomorrow's departures) and trivially fillable in one step.
  const title = `Walk-in Full Trip ${e2eNow().getTime()}`;
  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(0));
  await page.getByLabel("Departs").fill("20:00");
  await page.getByLabel("Returns").fill("22:00");
  await page.getByLabel("Capacity").fill("1");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  const tripId = page.url().match(/\/trips\/([^/?]+)/)?.[1];
  if (!tripId) throw new Error("could not read the trip id from the URL");

  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) });
  await addDiver.getByLabel("Name").fill("Fills The Boat");
  await addDiver.getByLabel("Email").fill(`fills-${e2eNow().getTime()}@example.com`);
  await addDiver.getByRole("button", { name: "Add to trip" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip — but their waiver wasn’t emailed.",
  );

  // The boat is now full — a counter walk-in onto it is refused, not silently
  // dropped, and points the crew at the wait list instead.
  await page.goto(`/shop/blue-mantis/check-in/walk-in?tripId=${tripId}`);
  await page.locator('input[name="fullName"]').filter({ visible: true }).fill("Turned Away Tara");
  await page.getByRole("button", { name: "Add to boat" }).click();

  await expect(page).toHaveURL(/\/check-in\?notice=walkin_full/);
  await expect(
    page.getByText("That boat is full — try the wait list from its trip page instead."),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Turned Away Tara" }).filter({ visible: true }),
  ).toHaveCount(0);
});
