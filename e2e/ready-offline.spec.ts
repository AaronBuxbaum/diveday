import type { BrowserContext, Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { bookASeatAndOpenThread, e2eNow, publicTripUrl, signOut, tripPathByTitle } from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";

/**
 * **The diver's saved `/ready` page, offline** (issue #2478).
 *
 * The page is kept on the phone for the marina with no signal
 * (`src/worker/ready-page-cache.ts`). This pins the two ends of that promise:
 * with no signal the saved copy shows, and cancelling with the page's own
 * button forgets it, so a seat the diver cancelled does not keep telling them
 * to come to the dock.
 *
 * What is *not* pinned, on purpose (decided 2026-10-16): a staff cancel or a
 * blow-out does not reach a phone that never opens the link online again.
 * Divers have no push subscription, and a diver offline at the marina is the
 * case a push cannot reach anyway, so the copy is bounded by its date alone.
 */
const OPEN_BOAT = "Two-Tank Reef — Molasses & French";
const COPY_CACHE = "diveday-ready-page-v1";
const diver = diverTranslator("en-US");

test.describe.configure({ timeout: 90_000 });

signedInAsOwner();

/** How many entries the phone's saved-copy cache holds right now. */
function keptCopies(page: Page): Promise<number> {
  return page.evaluate(async (name) => (await (await caches.open(name)).keys()).length, COPY_CACHE);
}

/**
 * Books a seat as a new diver and opens their readiness link with a full load,
 * then waits for the phone to hold the page. Returns the link's path.
 */
async function openKeptReadyPage(
  page: Page,
  context: BrowserContext,
  who: string,
  phoneClockOffsetMs = 0,
) {
  // The server's page-generation clock is frozen by the harness. Give the
  // service worker an independently controlled device clock so this spec can
  // prove the banner does not use the phone's clock as freshness provenance.
  await context.route("**/manifest-sw.js", async (route) => {
    const response = await route.fetch();
    const frozen = `globalThis.__diveDayTestClock = new Date(${JSON.stringify(E2E_FROZEN_CLOCK)}).getTime() + ${phoneClockOffsetMs};
const __RealDate = Date;
globalThis.Date = new Proxy(__RealDate, {
  construct: (target, args) => Reflect.construct(target, args.length === 0 ? [globalThis.__diveDayTestClock] : args),
  get: (target, prop, receiver) => (prop === "now" ? () => globalThis.__diveDayTestClock : Reflect.get(target, prop, receiver)),
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "e2e-set-clock") return;
  globalThis.__diveDayTestClock = event.data.now;
  event.ports[0]?.postMessage({ ok: true });
});
`;
    await route.fulfill({ response, body: frozen + (await response.text()) });
  });
  const stamp = e2eNow().getTime();
  const staffTrip = await tripPathByTitle(page, "blue-mantis", OPEN_BOAT);
  await signOut(page);
  await page.goto(publicTripUrl(staffTrip), { waitUntil: "domcontentloaded" });
  await bookASeatAndOpenThread(
    page,
    `${who} ${stamp}`,
    `${who.toLowerCase().replace(/ /g, "-")}-${stamp}@example.com`,
  );
  const readyPath = new URL(page.url()).pathname;
  // The booking lands here by a client-side navigation, and a service worker
  // sees a page by the address its document was created at (the trip page), so
  // it would not recognise this one as a readiness link. A diver opening the
  // link is a full load, which is what this does.
  await page.goto(readyPath, { waitUntil: "domcontentloaded" });

  // Online, the page asks its worker to keep a copy; wait for the phone to hold it.
  await expect.poll(() => keptCopies(page), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: diver("ready.offlineRemove") })).toBeVisible();
  return readyPath;
}

async function setWorkerClock(page: Page, now: number) {
  await page.evaluate(async (value) => {
    const registration = await navigator.serviceWorker.getRegistration("/ready/");
    const worker = registration?.active;
    if (!worker) throw new Error("The readiness worker is not active");
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(
        () => reject(new Error("The worker clock did not respond")),
        5_000,
      );
      channel.port1.onmessage = () => {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve();
      };
      worker.postMessage({ type: "e2e-set-clock", now: value }, [channel.port2]);
    });
  }, now);
}

test("the saved /ready copy shows with no signal, and a cancel landing forgets it", async ({
  page,
  context,
}) => {
  const readyPath = await openKeptReadyPage(page, context, "Olive Offline", 40 * 60_000);
  await expect(page.getByRole("button", { name: "Running late" })).toBeVisible();
  // What the phone holds is the server's snapshot, dated by the server's clock
  // (frozen by the harness), not the phone's, which this test sets 40 minutes
  // ahead. It names no token anywhere.
  const stored = await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    const entry = await cache.match(new URL("/ready/kept-copy", location.origin).toString());
    return { text: (await entry?.text()) ?? "", headers: [...(entry?.headers.values() ?? [])] };
  }, COPY_CACHE);
  expect(JSON.parse(stored.text).generatedAt).toBe(new Date(E2E_FROZEN_CLOCK).getTime());
  expect(stored.text + stored.headers.join(" ")).not.toContain(readyPath.split("/").pop() ?? "");

  // No signal: the reload is answered from the saved snapshot, and says so.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: OPEN_BOAT })).toBeVisible();
  // The server-built snapshot (not the live page): its banner dates the
  // summary by the server's clock and says what it carries.
  await expect(
    page.getByText(/No signal: this is a saved summary generated .+: where and when/),
  ).toBeVisible();
  // Read-only: the snapshot is inert, so nothing on it posts, and nothing
  // deletes the diver's only copy.
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: diver("ready.offlineRemove") })).toHaveCount(0);

  // Back online, the diver cancels with the page's own button. Its redirect
  // reaches the hydrated page without a navigation the worker sees, so the
  // cancelled card is what forgets the copy (issue #2979).
  await context.setOffline(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: diver("ready.cancelSpot") }).click();
  await page.getByRole("button", { name: diver("ready.cancelConfirmButton") }).click();
  await page.waitForURL((url) => url.searchParams.has("cancelled"));
  await expect(page.getByRole("heading", { name: diver("ready.cancelledHeading") })).toBeVisible();
  await expect.poll(() => keptCopies(page), { timeout: 30_000 }).toBe(0);

  // The cache is empty. A no-signal navigation can fail or remain pending
  // while the worker waits for a slow network; either way it must not render
  // the forgotten page during this bounded navigation.
  await context.setOffline(true);
  await expect(
    page.goto(readyPath, { waitUntil: "domcontentloaded", timeout: 10_000 }),
  ).rejects.toThrow();
  // This test's context is disposed after the test. Restoring its network here
  // can wait indefinitely on the timed-out navigation still in Chromium.
});

test("a detected clock rollback replaces the offline copy with a warning", async ({
  page,
  context,
}) => {
  await openKeptReadyPage(page, context, "Casey Clock Rollback", 40 * 60_000);
  const initialWatermark = await page.evaluate(async () => {
    const marker = await (await caches.open("diveday-ready-clock-v1")).match(
      "/ready/clock-observation",
    );
    return Number(marker?.headers.get("x-diveday-clock-watermark"));
  });
  expect(initialWatermark).toBe(new Date(E2E_FROZEN_CLOCK).getTime() + 40 * 60_000);
  const keepUntil = await page.evaluate(async (name) => {
    const entry = await (await caches.open(name)).match(
      new URL("/ready/kept-copy", location.origin).toString(),
    );
    return Number(entry?.headers.get("x-diveday-keep-until"));
  }, COPY_CACHE);
  // A prior online clock reading is setup state for this rollback journey.
  // Seed the durable watermark directly; observeReadyPageClock's persistence
  // and monotonic behavior is covered by its focused worker unit test.
  const watermark = keepUntil + 1;
  const seededWatermark = await page.evaluate(async (observedAt) => {
    const cache = await caches.open("diveday-ready-clock-v1");
    await cache.put(
      "/ready/clock-observation",
      new Response(null, { headers: { "x-diveday-clock-watermark": String(observedAt) } }),
    );
    const marker = await cache.match("/ready/clock-observation");
    return Number(marker?.headers.get("x-diveday-clock-watermark"));
  }, watermark);
  expect(seededWatermark).toBe(watermark);
  await context.setOffline(true);
  await setWorkerClock(page, new Date(E2E_FROZEN_CLOCK).getTime() + 40 * 60_000);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: diver("ready.offlineClockRollbackHeading") }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Running late" })).toHaveCount(0);
  await expect.poll(() => keptCopies(page)).toBe(1);
});

/**
 * **A diver takes the copy off a device that is not theirs** (issue #2693):
 * the page is kept on any browser that opens the link, a hotel PC among them.
 */
test("Remove saved copy takes the page off this device", async ({ page, context }) => {
  const readyPath = await openKeptReadyPage(page, context, "Remy Remove");
  await page.getByRole("button", { name: diver("ready.offlineRemove") }).click();
  await expect(
    page.getByRole("status").filter({ hasText: diver("ready.offlineRemoved") }),
  ).toBeVisible();
  await expect.poll(() => keptCopies(page), { timeout: 30_000 }).toBe(0);
  expect(
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
    ),
  ).not.toContain("/ready/");

  // With no signal there is nothing saved to show, however often it is opened.
  // Use fresh navigations; a reload could repeat a browser error page instead.
  await context.setOffline(true);
  await expect(
    page.goto(readyPath, { waitUntil: "domcontentloaded", timeout: 10_000 }),
  ).rejects.toThrow();
  await expect(
    page.goto(readyPath, { waitUntil: "domcontentloaded", timeout: 10_000 }),
  ).rejects.toThrow();

  // "Until you next open this link": opening it again with signal keeps it
  // again, and the page says so rather than still saying "Removed".
  await context.setOffline(false);
  await page.goto(readyPath, { waitUntil: "domcontentloaded" });
  await expect.poll(() => keptCopies(page), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: diver("ready.offlineRemove") })).toBeVisible();
  await expect(page.getByText(diver("ready.offlineRemoved"))).toHaveCount(0);
});
