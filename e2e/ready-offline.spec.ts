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
async function openKeptReadyPage(page: Page, context: BrowserContext, who: string) {
  // The harness freezes the page's clock and the server's, never a service
  // worker's, which would read the real date and find the seeded trip's copy
  // long out of date. The worker script is served with the same frozen clock
  // in front of it, so the copy's date is read against the harness's "now".
  await context.route("**/manifest-sw.js", async (route) => {
    const response = await route.fetch();
    const frozen = `const __fixed = new Date(${JSON.stringify(E2E_FROZEN_CLOCK)}).getTime();
const __RealDate = Date;
globalThis.Date = new Proxy(__RealDate, {
  construct: (target, args) => Reflect.construct(target, args.length === 0 ? [__fixed] : args),
  get: (target, prop, receiver) => (prop === "now" ? () => __fixed : Reflect.get(target, prop, receiver)),
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
  return readyPath;
}

test("the saved /ready copy shows with no signal, and a cancel landing forgets it", async ({
  page,
  context,
}) => {
  const readyPath = await openKeptReadyPage(page, context, "Olive Offline");
  await expect(page.getByRole("button", { name: "Running late" })).toBeVisible();

  // No signal: the reload is answered from the saved copy, and says so.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Running late" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "No signal" })).toBeVisible();
  // It is the diver's only copy at the dock: nothing on it deletes it (domain review 2).
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

  // And with no signal again there is nothing saved to show.
  await context.setOffline(true);
  await expect(page.goto(readyPath, { waitUntil: "domcontentloaded" })).rejects.toThrow();
  await context.setOffline(false);
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
  // (A reload would only repeat the browser's own error page, which resolves.)
  await context.setOffline(true);
  await expect(page.goto(readyPath, { waitUntil: "domcontentloaded" })).rejects.toThrow();
  await expect(page.goto(readyPath, { waitUntil: "domcontentloaded" })).rejects.toThrow();

  // "Until you next open this link": opening it again with signal keeps it
  // again, and the page says so rather than still saying "Removed".
  await context.setOffline(false);
  await page.goto(readyPath, { waitUntil: "domcontentloaded" });
  await expect.poll(() => keptCopies(page), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: diver("ready.offlineRemove") })).toBeVisible();
  await expect(page.getByText(diver("ready.offlineRemoved"))).toHaveCount(0);
});
