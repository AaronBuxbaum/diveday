import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  e2eNow,
  openCounterFor,
  publicTripUrl,
  signInAsOwner,
  signOut,
  tripPathByTitle,
} from "./helpers";

/**
 * **"Running late"** (J3): a diver tells the shop from their own link, or by
 * replying LATE, and the arrivals list says so instead of a blank.
 *
 * Both tests book onto the seeded reef boat, which sails today a few hours
 * after the frozen clock: inside the twelve-hour window, before departure.
 */
const OPEN_BOAT = "Two-Tank Reef — Molasses & French";

test.describe.configure({ timeout: 60_000 });

signedInAsOwner();

/** Book a fresh diver on today's reef boat from the public page; lands on `/ready`. */
async function bookOnTodaysBoat(page: Page, name: string, email: string) {
  const staffTrip = await tripPathByTitle(page, "blue-mantis", OPEN_BOAT);
  await signOut(page);
  await page.goto(publicTripUrl(staffTrip), { waitUntil: "domcontentloaded" });
  await bookASeatAndOpenThread(page, name, email);
  await expect(page).toHaveURL(/\/ready\//);
}

test("a diver taps Running late on their link, and the desk sees when they said it", async ({
  page,
}) => {
  const stamp = e2eNow().getTime();
  const name = `Lena Late ${stamp}`;
  await bookOnTodaysBoat(page, name, `lena-late-${stamp}@example.com`);

  await page.getByRole("button", { name: "Running late" }).click();
  // The block's own line is the confirmation, in the shop's zone.
  await expect(page.getByText(/^You told the shop you’re running late at \d/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Running late" })).toHaveCount(0);

  await signInAsOwner(page);
  // Today's arrival lookup carries it under the name…
  await page.goto(`/shop/blue-mantis?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(/^Running late, said \d/)).toBeVisible();
  // …and so does the boat's own Divers tab.
  await openCounterFor(page, "blue-mantis", name);
  const row = page
    .locator('#roster li[id^="booking-"]')
    .filter({ visible: true })
    .filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(row.getByText(/^Running late, said \d/)).toBeVisible();
});

test("a LATE reply marks the seat, and the inbox says what the word meant", async ({
  page,
  request,
}) => {
  const stamp = e2eNow().getTime();
  const name = `Omar Late ${stamp}`;
  const email = `omar-late-${stamp}@example.com`;
  await bookOnTodaysBoat(page, name, email);

  const replied = await request.post("/api/test/inbound-message", {
    data: { shopSlug: "blue-mantis", from: email, channel: "email", body: "LATE" },
  });
  expect(replied.ok()).toBe(true);
  expect(await replied.json()).toMatchObject({ outcome: "running_late" });

  // The diver's own link now says it was said, rather than offering it again.
  await page.reload();
  await expect(page.getByText(/^You told the shop you’re running late at \d/)).toBeVisible();

  await signInAsOwner(page);
  await page.goto(`/shop/blue-mantis?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(/^Running late, said \d/)).toBeVisible();
  await page.goto("/shop/blue-mantis/inbox");
  const message = page.getByRole("listitem").filter({ hasText: name }).first();
  await expect(message.getByText("Running late", { exact: true })).toBeVisible();
});
