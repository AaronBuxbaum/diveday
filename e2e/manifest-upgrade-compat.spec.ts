import { DEMO_TODAY_TRIP_ID } from "../src/db/seed/identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { OFFLINE_MANIFEST_RECORD_VERSION } from "../src/lib/offline-manifests";
import { ROLL_CALL_CAUSAL_HEADERS } from "../src/lib/roll-call-protocol";
import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openDeckDetails, openDeckPerson } from "./helpers";

signedInAsOwner();

test("legacy snapshot requests preserve a queued receipt and a current page can save", async ({
  page,
  context,
}) => {
  const tripId = DEMO_TODAY_TRIP_ID;
  const manifest = `/shop/blue-mantis/trips/${tripId}/manifest`;
  await page.goto(manifest);
  await offlineCopySaved(page);
  await page.goto(`/offline-manifest?trip=${tripId}&checkpoint=after_dive_1`);
  await openDeckDetails(page);
  await context.setOffline(true);
  await openDeckPerson(page, "Diego Alvarez");
  await page
    .getByRole("button", { name: staffTranslator("en-US")("manifest.deck.exception"), exact: true })
    .click();
  const diver = page
    .locator("li[id^='offline-roll-call-']")
    .filter({ has: page.getByRole("heading", { name: "Diego Alvarez", exact: true }) });
  await diver.getByText("Not back aboard?", { exact: true }).click();
  await diver.getByRole("button", { name: "Mark not back aboard", exact: true }).click();
  await expect(page.locator('[data-deck-screen="receipt"]')).toContainText(
    staffTranslator("en-US")("manifest.deck.savedMissing"),
  );
  await expect(page.getByText("Saved here · Waiting to send", { exact: true })).toBeVisible();
  const savedRecord = async () =>
    page.evaluate(
      async ({ id, version }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("diveday-offline-manifests");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const record = await new Promise<{
            iv: ArrayBuffer;
            ciphertext: ArrayBuffer;
            pendingEvents?: number;
          }>((resolve, reject) => {
            const request = db
              .transaction("manifests", "readonly")
              .objectStore("manifests")
              .get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const digest = await crypto.subtle.digest("SHA-256", record.ciphertext);
          const key = await new Promise<CryptoKey>((resolve, reject) => {
            const request = db
              .transaction("keys", "readonly")
              .objectStore("keys")
              .get("manifest-aes-gcm-v1");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const plaintext = await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: record.iv,
              additionalData: new TextEncoder().encode(`${version}:${id}`),
            },
            key,
            record.ciphertext,
          );
          const envelope = JSON.parse(new TextDecoder().decode(plaintext)) as {
            events: {
              clientEventId: string;
              syncStatus: string;
              status: string;
              checkpoint: string;
            }[];
          };
          return {
            digest: Array.from(new Uint8Array(digest)),
            pending: record.pendingEvents,
            events: envelope.events,
          };
        } finally {
          db.close();
        }
      },
      { id: tripId, version: OFFLINE_MANIFEST_RECORD_VERSION },
    );
  const before = await savedRecord();
  expect(before.pending).toBeGreaterThan(0);
  expect(before.events).toHaveLength(1);
  expect(before.events[0]).toMatchObject({
    status: "not_boarded",
    checkpoint: "after_dive_1",
    syncStatus: "pending",
  });
  // Keep this physical observation queued while the two claims are exercised.
  await context.route("**/api/offline-manifests/sync", (route) => route.abort());
  await context.route("**/api/offline-manifests/upcoming*", (route) => route.abort());
  const currentClaim = "**/api/offline-manifests/*/snapshot/v2";
  await context.route(currentClaim, (route) => route.abort());
  await context.setOffline(false);
  await page.goto(manifest);
  // This is the old client's HTTP request, made by the same browser that owns
  // the encrypted copy. No client fallback or server response is stubbed.
  const status = await page.evaluate(
    async ({ tripId, headers }) => {
      const response = await fetch(`/api/offline-manifests/${tripId}/snapshot`, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ erasureEpoch: 0, snapshotRevision: 0 }),
      });
      return response.status;
    },
    { tripId, headers: ROLL_CALL_CAUSAL_HEADERS },
  );
  expect(status).toBe(426);
  expect(await savedRecord()).toEqual(before);
  await context.unroute(currentClaim);
  const claimed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/offline-manifests/${tripId}/snapshot/v2`) &&
      response.ok(),
  );
  await page.reload();
  await claimed;
  await expect.poll(async () => (await savedRecord()).digest).not.toEqual(before.digest);
  await page.goto(`/offline-manifest?trip=${tripId}&checkpoint=after_dive_1`);
  await openDeckDetails(page);
  const after = await savedRecord();
  expect(after.pending).toBe(before.pending);
  expect(after.events).toEqual(before.events);
});
