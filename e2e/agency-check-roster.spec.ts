import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { findTripOnBoard, openDiverFileGroup, openTripTab, rosterRow } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";
/** A seeded diver on this departure whose SSI card is still pending (`seed-divers.ts`, index 34). */
const SEEDED_DIVER = "Tyler Brooks";
const DEPARTURE = /Two-Tank Reef — French Reef/;

/**
 * **Automatic GUE checks from a departure and Today, with SSI excluded from Check all** (H-105).
 *
 * As in `agency-check.spec.ts` (the installed extension is
 * `agency-check-extension.spec.ts`'s), the agencies' pages are not ours to hit, so this stands in for the extension at
 * the one seam the app sees: the marker on `<html>` and the `postMessage`
 * request and reply. It counts the lookups it was asked for, so the spec can
 * say how many the page sent. The verdict, the write and each card's Undo are
 * the real ones.
 */
async function installFakeExtension(page: Page, answer: "match" | "captcha") {
  await page.addInitScript((mode) => {
    const announce = () => {
      document.documentElement.setAttribute("data-diveday-cert-check", "1.6.0");
      window.dispatchEvent(new Event("diveday-cert-check-ready"));
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", announce);
    } else {
      announce();
    }
    const counted = window as unknown as { __agencyLookups: number };
    counted.__agencyLookups = 0;
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (data?.source !== "diveday-page" || data.type !== "agency-check") return;
      counted.__agencyLookups += 1;
      const name = `${data.query.firstName} ${data.query.lastName}`;
      window.postMessage(
        {
          source: "diveday-cert-check",
          type: "agency-check-result",
          requestId: data.requestId,
          ok: true,
          pageText:
            mode === "match"
              ? `Verify card\n${name}\nCard ${data.query.cardNumber}\nRecreational Diver 1`
              : "Please confirm you are human",
        },
        window.location.origin,
      );
    });
  }, answer);
}

function lookups(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __agencyLookups: number }).__agencyLookups);
}

/**
 * A new diver seated on a departure from its Divers tab, with a pending GUE
 * card captured on their record; the page is back on the departure after.
 */
async function seatNewcomerWithPendingCard(page: Page, departure: RegExp, prefix = "Rory") {
  const trip = await findTripOnBoard(page, SHOP, departure);
  await trip.click();
  await openTripTab(page, "Trip");
  const tripUrl = page.url();

  const stamp = Date.now();
  const newcomer = `${prefix} ${prefix === "Rory" ? "Quill" : "Bracken"}${stamp}`;
  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.getByRole("link", { name: "Add diver", exact: true }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill(newcomer);
  await page.getByLabel("Email").fill(`${prefix.toLowerCase()}-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

  await rosterRow(page, newcomer).getByRole("link", { name: newcomer }).click();
  await page.waitForURL(new RegExp(`/shop/${SHOP}/divers/[0-9a-f-]{36}`));
  const group = await openDiverFileGroup(page, "Certification records");
  await group.getByText("Add certification", { exact: true }).click();
  const form = page
    .locator("form", { has: page.getByRole("button", { name: "Capture for review", exact: true }) })
    .filter({ visible: true });
  await form.locator('select[name="agency"]').selectOption("gue");
  await form.locator('select[name="card"]').selectOption("level:open_water");
  await form.getByLabel("Certification number").fill(`GUE-${prefix}-${stamp}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  const cards = await openDiverFileGroup(page, "Certification records");
  await expect(cards.getByRole("button", { name: "Check with GUE" })).toBeVisible();

  await page.goto(tripUrl);
  await expect(
    rosterRow(page, newcomer).getByRole("button", { name: "Check with GUE" }),
  ).toBeVisible();
  return { newcomer };
}

/** Two automatic GUE checks, alongside Tyler's manually checked SSI card. */
async function departureWithTwoPendingCards(page: Page) {
  const first = await seatNewcomerWithPendingCard(page, DEPARTURE);
  const second = await seatNewcomerWithPendingCard(page, DEPARTURE, "Robin");
  await expect(rosterRow(page, SEEDED_DIVER)).toBeVisible();
  return { newcomer: first.newcomer, other: second.newcomer };
}

test("Check all certifies the departure one card at a time, and each card keeps its own Undo", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installFakeExtension(page, "match");
  const { newcomer, other } = await departureWithTwoPendingCards(page);

  await page.getByRole("button", { name: "Check all 2 cards with their agencies" }).click();

  await expect(page.getByText("Checked 2. Certified: 2.")).toBeVisible({ timeout: 20_000 });
  expect(await lookups(page)).toBe(2);
  // SSI is a separate manual handoff and is not part of the batch.
  await expect(
    rosterRow(page, SEEDED_DIVER).getByRole("button", { name: "Check with SSI" }),
  ).toBeVisible();
  for (const diver of [other, newcomer]) {
    const row = rosterRow(page, diver);
    await expect(row.getByText("GUE shows this certification. Marked certified.")).toBeVisible();
    await expect(row.getByRole("button", { name: "Check with GUE" })).toHaveCount(0);
  }
  // Undo is the card's, never the departure's.
  await expect(page.getByRole("button", { name: /Undo all|Undo every/ })).toHaveCount(0);

  await rosterRow(page, newcomer).getByRole("button", { name: "Undo" }).click();
  await expect(
    rosterRow(page, newcomer).getByRole("button", { name: "Check with GUE" }),
  ).toBeVisible();
  // The other card stays certified.
  await expect(
    rosterRow(page, other).getByText("GUE shows this certification. Marked certified."),
  ).toBeVisible();
});

test("Check all skips one page it cannot read, stops on two in a row, and leaves them for the staffer", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installFakeExtension(page, "captcha");
  const { newcomer, other } = await departureWithTwoPendingCards(page);

  await page.getByRole("button", { name: "Check all 2 cards with their agencies" }).click();

  await expect(page.getByText(/^Stopped at .+: couldn’t read GUE’s page\./)).toBeVisible({
    timeout: 20_000,
  });
  expect(await lookups(page)).toBe(2);
  // Nothing was written: each card waits, named, with the agency's page to open.
  for (const diver of [other, newcomer]) {
    const row = rosterRow(page, diver);
    await expect(
      row.getByText(/^Couldn’t find .+ on GUE’s page\. Open it and look\.$/),
    ).toBeVisible();
    await expect(row.getByRole("link", { name: "Check with GUE" })).toBeVisible();
  }
  await expect(page.getByText("GUE shows this certification. Marked certified.")).toHaveCount(0);
});

test("one row's own check certifies that card with the diver record's toast", async ({ page }) => {
  test.setTimeout(60_000);
  await installFakeExtension(page, "match");
  const { newcomer } = await seatNewcomerWithPendingCard(page, DEPARTURE);
  const row = rosterRow(page, newcomer);

  await row.getByRole("button", { name: "Check with GUE" }).click();

  const toast = page
    .getByRole("status")
    .filter({ hasText: "GUE shows this certification. Marked certified." });
  await expect(toast).toBeVisible();
  await expect(row.getByRole("button", { name: "Check with GUE" })).toHaveCount(0);

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(row.getByRole("button", { name: "Check with GUE" })).toBeVisible();
});

test("without the extension the Divers tab offers no check at all", async ({ page }) => {
  const trip = await findTripOnBoard(page, SHOP, DEPARTURE);
  await trip.click();
  await openTripTab(page, "Trip");
  await expect(rosterRow(page, SEEDED_DIVER)).toBeVisible();
  await expect(page.getByRole("button", { name: "Check with SSI" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Check all/ })).toHaveCount(0);
});

/** A new diver with a pending GUE card, made on the diver pages; the page is on their record after. */
async function newDiverWithPendingCard(page: Page) {
  const stamp = Date.now();
  const name = `Wren Talbot${stamp}`;
  await page.goto(`/shop/${SHOP}/divers/new`);
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(`wren-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add diver" }).click();
  await page.waitForURL(new RegExp(`/shop/${SHOP}/divers/[0-9a-f-]{36}`));
  const group = await openDiverFileGroup(page, "Certification records");
  await group.getByText("Add certification", { exact: true }).click();
  const form = page
    .locator("form", { has: page.getByRole("button", { name: "Capture for review", exact: true }) })
    .filter({ visible: true });
  await form.locator('select[name="agency"]').selectOption("gue");
  await form.locator('select[name="card"]').selectOption("level:open_water");
  await form.getByLabel("Certification number").fill(`GUE-${stamp}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  const cards = await openDiverFileGroup(page, "Certification records");
  await expect(cards.getByRole("button", { name: "Check with GUE" })).toBeVisible();
  return name;
}

test("a certification-pending row on Today checks the card in place, with Undo", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installFakeExtension(page, "match");
  const name = await newDiverWithPendingCard(page);
  // Seated on today's afternoon boat, which asks for a card: a lone
  // "certification pending" row on Today.
  const trip = await findTripOnBoard(page, SHOP, /Two-Tank Reef — Molasses & French/);
  await trip.click();
  await openTripTab(page, "Trip");
  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).fill(name);
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).press("Enter");
  await addDiver.getByRole("button", { name: `Add ${name} to the trip` }).click();
  await expect(rosterRow(page, name)).toBeVisible();

  await page.goto(`/shop/${SHOP}`);
  const cardRow = () =>
    page
      .getByRole("listitem")
      .filter({ hasText: name })
      .filter({ hasText: "Certification not verified yet" });
  const row = cardRow();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Check with GUE" }).click();

  const toast = page
    .getByRole("status")
    .filter({ hasText: "GUE shows this certification. Marked certified." });
  await expect(toast).toBeVisible();
  await expect(cardRow()).toHaveCount(0);

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(cardRow().getByRole("button", { name: "Check with GUE" })).toBeVisible();
});
