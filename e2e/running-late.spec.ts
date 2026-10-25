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

  // Asked first, naming the call (third UX review, item 26): "Never mind"
  // leaves nothing said.
  await page.getByRole("button", { name: "Running late" }).click();
  await expect(
    page.getByText(/^Tell the shop you’re running late for the \d.* call\?/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Never mind" }).click();
  await page.getByRole("button", { name: "Running late" }).click();
  await page.getByRole("button", { name: "Yes, tell them" }).click();
  // The block's own line is the confirmation, in the shop's zone.
  await expect(page.getByText(/^At \d.* you told the shop you’re running late\./)).toBeVisible();
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

test("a diver who said Running late by mistake takes it back from the same link", async ({
  page,
}) => {
  const stamp = e2eNow().getTime();
  const name = `Tara Ontime ${stamp}`;
  await bookOnTodaysBoat(page, name, `tara-ontime-${stamp}@example.com`);

  await page.getByRole("button", { name: "Running late" }).click();
  await page.getByRole("button", { name: "Yes, tell them" }).click();
  await page.getByRole("button", { name: "I’m on time after all" }).click();
  await expect(page.getByRole("button", { name: "Running late" })).toBeVisible();
  await expect(page.getByText(/you told the shop you’re running late/)).toHaveCount(0);

  await signInAsOwner(page);
  await page.goto(`/shop/blue-mantis?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText(/^Running late, said \d/)).toHaveCount(0);
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
  await expect(page.getByText(/^At \d.* you told the shop you’re running late\./)).toBeVisible();

  await signInAsOwner(page);
  await page.goto(`/shop/blue-mantis?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(/^Running late, said \d/)).toBeVisible();
  await page.goto("/shop/blue-mantis/inbox");
  const message = page.getByRole("listitem").filter({ hasText: name }).first();
  // The word, read as the seat it marked (UX review 2026-10-13, item 19).
  await expect(message.getByText(/On the manifest: running late, said \d/)).toBeVisible();
});

test("a diver says it in their own words, and the desk marks it from the inbox row", async ({
  page,
  request,
}) => {
  const stamp = e2eNow().getTime();
  const name = `Ines Late ${stamp}`;
  const email = `ines-late-${stamp}@example.com`;
  await bookOnTodaysBoat(page, name, email);

  // A sentence is never read as a command (ADR 20260909-reply-keywords).
  const wrote = await request.post("/api/test/inbound-message", {
    data: {
      shopSlug: "blue-mantis",
      from: email,
      channel: "email",
      body: "Running about 15 min late, traffic on the causeway",
    },
  });
  expect(wrote.ok()).toBe(true);
  expect(await wrote.json()).not.toMatchObject({ outcome: "running_late" });

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/inbox");
  const message = page.getByRole("listitem").filter({ hasText: name }).first();
  // The row names the boat the message is about…
  await expect(message.getByText(new RegExp(`Booked on ${OPEN_BOAT}`))).toBeVisible();
  // …and its open view puts the mark on that seat.
  await message.getByRole("button", { name: `More for the message from ${name}` }).click();
  await page.getByRole("button", { name: `Mark ${name} running late for ${OPEN_BOAT}` }).click();
  await expect(
    page.getByText("Marked running late. The roster and the manifest show it."),
  ).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: name })
      .first()
      .getByText(/On the manifest: running late, said \d/),
  ).toBeVisible();

  // The boat hears it: the Divers tab's row carries the same mark.
  await openCounterFor(page, "blue-mantis", name);
  const row = page
    .locator('#roster li[id^="booking-"]')
    .filter({ visible: true })
    .filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(row.getByText(/^Running late, said \d/)).toBeVisible();
});
