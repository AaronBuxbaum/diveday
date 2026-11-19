import type { Page } from "@playwright/test";
import { DEMO_TODAY_TRIP_ID } from "../src/db/seed-identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  manifestRow,
  offlineCopySaved,
  openDeckDetails,
  openDeckPerson,
  openManifestPerson,
} from "./helpers";

const staff = staffTranslator("en-US");
signedInAsOwner();
test.skip(
  process.env.DIVEDAY_OFFLINE_ROLL_CALL_WITNESS !== "1",
  "Runs in the isolated witness-enabled browser job.",
);

async function markAboard(page: Page, name: string) {
  await openDeckPerson(page, name);
  await page
    .getByRole("button", { name: staff("manifest.deck.record", { name }), exact: true })
    .click();
  await expect(page.locator('[data-deck-screen="receipt"]')).toContainText(
    staff("manifest.deck.savedAboard"),
  );
}

test("a conflict stays for review while an independent observation syncs", async ({
  page,
  context,
  browser,
  staffStorageState,
}) => {
  const url = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}/manifest?checkpoint=after_dive_1`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await offlineCopySaved(page);
  const other = await browser.newContext({ storageState: await staffStorageState("owner") });
  const live = makeActivitySafe(await other.newPage());
  try {
    await Promise.all([
      live.goto(url, { waitUntil: "domcontentloaded" }),
      page.goto(`/offline-manifest?trip=${DEMO_TODAY_TRIP_ID}&checkpoint=after_dive_1`, {
        waitUntil: "domcontentloaded",
      }),
    ]);
    await openDeckDetails(page);
    await context.setOffline(true);
    await markAboard(page, "Diego Alvarez");
    await markAboard(page, "Tom Okafor");
    const liveRow = await manifestRow(live, "Diego Alvarez");
    await openManifestPerson(liveRow);
    await live
      .getByRole("dialog")
      .getByRole("button", { name: "Mark not back aboard", exact: true })
      .click();
    await expect(live.locator('[data-deck-screen="receipt"]')).toContainText(
      staff("manifest.deck.savedMissing"),
    );
    const sync = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/offline-manifests/sync" &&
        ((response.request().postDataJSON() as { events?: unknown[] }).events?.length ?? 0) >= 2,
    );
    await context.setOffline(false);
    const response = await sync;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { results: { status: string; reason?: string }[] };
    expect(body.results.some((result) => result.status === "applied")).toBe(true);
    expect(body.results.some((result) => result.reason === "review_required")).toBe(true);
    await page.getByRole("button", { name: staff("manifest.deck.attention"), exact: true }).click();
    const attention = page.locator('[data-deck-screen="attention"]');
    await expect(attention.getByText(/remains on this device/)).toBeVisible();
    await attention.getByRole("button", { name: "Review current roster" }).click();
    await expect(
      attention.getByText(
        staff("shared.offlineManifest.single.reviewOriginalNameOnline", { name: "Diego Alvarez" }),
      ),
    ).toBeVisible();
    await expect(attention.getByText(/current seat names Diego Alvarez/)).toBeVisible();
    await expect(attention.getByText(/Tom Okafor.*Boarded/)).toBeVisible();
    await attention.getByLabel("Boarded", { exact: true }).check();
    await attention.getByRole("button", { name: "Confirm new live mark" }).click();
    await expect(attention.getByText(/remains on this device/)).toHaveCount(0);
    const current = await page.evaluate(async (tripId) => {
      const response = await fetch(`/api/offline-manifests/review?tripId=${tripId}`);
      return (await response.json()).current;
    }, DEMO_TODAY_TRIP_ID);
    const divers = current.manifests.find(
      (manifest: { checkpoint: string }) => manifest.checkpoint === "after_dive_1",
    ).divers;
    expect(
      divers.find((diver: { fullName: string }) => diver.fullName === "Diego Alvarez").rollCall
        .state,
    ).toBe("boarded");
    expect(
      divers.find((diver: { fullName: string }) => diver.fullName === "Tom Okafor").rollCall.state,
    ).toBe("boarded");
  } finally {
    await live.close();
    await other.close();
  }
});
