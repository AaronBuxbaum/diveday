import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, signOut } from "./helpers";

/**
 * Diver self-service cancel/reschedule from their own readiness page
 * (docs ADR 20260727-diver-self-service-cancel). The safety property that
 * matters most — a diver is never left with neither seat when rescheduling —
 * is already exhaustively unit-tested at the `rescheduleBooking` level
 * (src/db/bookings.test.ts); this spec covers the two flows a diver actually
 * runs through the browser.
 */
test.describe("staff-prepared trips", () => {
  signedInAsOwner();

  test("a diver reschedules their own unpaid booking to a different trip they pick", async ({
    page,
  }) => {
    const suffix = e2eNow().getTime();
    const originalTitle = `Move-From Run ${suffix}`;

    // Staff puts a trip on the board for the diver to book.
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(originalTitle);
    await page.getByLabel("Date").fill(daysFromNow(4));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:00");
    await page.getByLabel("Capacity").fill("6");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await signOut(page);

    // A visitor books it.
    await page.goto("/shop/blue-mantis/schedule", { waitUntil: "domcontentloaded" });
    await page.locator("li").filter({ hasText: originalTitle }).getByRole("link").click();
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Nemo Quinn");
    await page.getByLabel("Email", { exact: true }).fill(`nemo-${suffix}@example.com`);
    await page.getByRole("button", { name: /^Book/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();
    await page.getByRole("link", { name: /readiness page/ }).click();
    await expect(page).toHaveURL(/\/ready\//);

    // The reschedule section offers other upcoming trips (the seeded demo
    // schedule already has several — MAX_RESCHEDULE_CANDIDATES=8 draws from
    // the whole board, not just what this test created). Each option names
    // its trip so two same-time departures can't be confused (a real gap a
    // date/time-only label would have). Picking one and confirming must move
    // the booking without ever leaving the diver seatless; verify by matching
    // the destination page's own title and date/time back to what was
    // selected, rather than assuming which trip sorts first.
    await expect(page.getByRole("heading", { name: "Need to change your plans?" })).toBeVisible();
    const select = page.locator("#newTripId");
    const options = select.locator("option");
    await expect(options).not.toHaveCount(1); // more than just the placeholder
    await select.selectOption({ index: 1 });
    const selectedLabel = (await options.nth(1).innerText()).trim();
    // Split on the LAST " — " before the date, not the first: several seeded
    // trip titles contain their own " — " (e.g. "Two-Tank Reef — Christ of
    // the Abyss"), so a naive first-split misparses the title. The date
    // always starts with a three-letter weekday abbreviation, which greedy
    // backtracking uses to find the real title/date boundary.
    const match = selectedLabel.match(/^(.+) — ([A-Za-z]{3}, .+) · \d+ left$/);
    if (!match) throw new Error(`unexpected option label format: ${selectedLabel}`);
    const [, expectedTitle, expectedWhen] = match;

    // The trigger arms an inline confirm panel (task 50 — replaces
    // window.confirm, which can't show a translated message) rather than
    // submitting straight away; the real submit is the second click.
    await page.getByRole("button", { name: "Move my booking" }).click();
    await page.getByRole("button", { name: "Yes, move my booking" }).click();

    await expect(page).toHaveURL(/\/ready\//);
    await expect(page.getByRole("status").filter({ hasText: "You’re moved!" })).toBeVisible();
    await expect(page.getByRole("heading", { name: expectedTitle, exact: true })).toBeVisible();
    await expect(page.getByText(expectedWhen)).toBeVisible();
  });

  test("a diver cancels their own unpaid booking and it's gone for good", async ({ page }) => {
    const suffix = e2eNow().getTime();
    const title = `Cancel-Me Run ${suffix}`;

    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(4));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:00");
    await page.getByLabel("Capacity").fill("6");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await signOut(page);

    await page.goto("/shop/blue-mantis/schedule", { waitUntil: "domcontentloaded" });
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Coral Reyes");
    await page.getByLabel("Email", { exact: true }).fill(`coral-${suffix}@example.com`);
    await page.getByRole("button", { name: /^Book/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();
    await page.getByRole("link", { name: /readiness page/ }).click();
    await expect(page).toHaveURL(/\/ready\//);
    const readyUrl = page.url();

    await expect(page.getByRole("button", { name: "Cancel my spot" })).toBeVisible();
    // Same two-step inline confirm as the reschedule flow above.
    await page.getByRole("button", { name: "Cancel my spot" }).click();
    await page.getByRole("button", { name: "Yes, cancel my spot" }).click();

    await expect(page.getByRole("heading", { name: "This booking was cancelled" })).toBeVisible();

    // The bare link (no ?cancelled= — the cancel action's own one-time
    // redirect param) never comes back to a "live" checklist for a seat that
    // no longer exists. Cancelling revokes the token itself, so a plain
    // revisit reads the same as any other dead link — no oracle for "this
    // specific booking was cancelled" beyond the one redirect that already
    // told the diver so.
    await page.goto(readyUrl);
    await expect(
      page.getByRole("heading", { name: /readiness link isn.t available/ }),
    ).toBeVisible();
  });
});

test("a tampered readiness token can't be used to cancel or reschedule anything", async ({
  page,
}) => {
  await page.goto("/ready/not-a-real-token");
  await expect(page.getByRole("heading", { name: /readiness link isn.t available/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel my spot" })).toHaveCount(0);
});
