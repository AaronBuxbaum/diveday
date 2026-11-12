import type { Page } from "@playwright/test";
import { DEMO_TODAY_TRIP_ID } from "../src/db/seed-identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { pinBrowserClock } from "./browser-clock";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { manifestRow, offlineCopySaved, openManifestPerson } from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";

const staff = staffTranslator("en-US");
signedInAsOwner();

/** Change this device's wall clock without freezing real network/UI timers. */
async function setDeviceClock(page: Page, timestamp: number) {
  await page.evaluate((now) => {
    const device = window as Window & { __causalRollCallClock?: number };
    const installed = device.__causalRollCallClock !== undefined;
    device.__causalRollCallClock = now;
    if (!installed) {
      const OriginalDate = Date;
      globalThis.Date = new Proxy(OriginalDate, {
        construct: (target, args) =>
          Reflect.construct(target, args.length === 0 ? [device.__causalRollCallClock] : args),
        get: (target, prop, receiver) =>
          prop === "now" ? () => device.__causalRollCallClock : Reflect.get(target, prop, receiver),
      });
    }
  }, timestamp);
  expect(await page.evaluate(() => Date.now())).toBe(timestamp);
}

// Independent Chromium storage/network contexts model two crew devices. This
// proves browser reconnect behavior; it is not a physical-device field trial.
for (const role of ["diver", "crew"] as const) {
  for (const situation of ["fast aboard", "slow missing"] as const) {
    test(`${role} opposing evidence stays visible through ${situation} device reconnect`, async ({
      page,
      context,
      browser,
      staffStorageState,
    }) => {
      const started = performance.now();
      const mark = (name: string) =>
        console.log("causal reconnect step", name, Math.round(performance.now() - started));
      mark("begin");
      const liveUrl = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}/manifest?checkpoint=after_dive_1`;
      // Start the real device's save immediately. Its request can run while
      // the second isolated device is created and its live panel is opened.
      const savedCopy = page
        .goto(liveUrl, { waitUntil: "domcontentloaded" })
        .then(() => offlineCopySaved(page));
      const second = await browser.newContext({ storageState: await staffStorageState("owner") });
      const live = makeActivitySafe(await second.newPage());
      try {
        await pinBrowserClock(second, E2E_FROZEN_CLOCK);
        // Let the first device finish its real save before starting a second
        // layout's shop-wide autosave. Then overlap the two UI navigations.
        await savedCopy;
        mark("snapshot-saved");
        await Promise.all([
          live.goto(liveUrl, { waitUntil: "domcontentloaded" }),
          page.goto(`/offline-manifest?trip=${DEMO_TODAY_TRIP_ID}&checkpoint=after_dive_1`, {
            waitUntil: "domcontentloaded",
          }),
        ]);
        mark("pages-loaded");
        const liveRow =
          role === "diver"
            ? manifestRow(live, "Diego Alvarez")
            : live.locator("li[id^='crew-row-']").first();
        const personName =
          role === "diver"
            ? "Diego Alvarez"
            : await liveRow.locator("[data-person-row-name] > span > span").first().innerText();
        if (situation === "fast aboard") await openManifestPerson(liveRow);
        await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
        mark("shell-rendered");
        const list = page.locator(
          role === "diver" ? "#offline-roll-call" : "#offline-crew-roll-call",
        );
        const offlineRow =
          role === "diver"
            ? list.getByRole("listitem").filter({ hasText: "Diego Alvarez" }).first()
            : list
                .getByRole("listitem")
                .filter({ has: page.getByRole("heading", { name: personName, exact: true }) })
                .first();
        // The rendered shell is already loaded; this case cuts transport
        // without a reload. Worker-cache reload has its own existing journey.
        await context.setOffline(true);
        mark("network-cut");
        // Device time changes affect capture only; the displayed meeting day
        // and rendered causal basis remain the ones the crew actually saw.
        await setDeviceClock(
          page,
          new Date(E2E_FROZEN_CLOCK).getTime() + (situation === "fast aboard" ? 15 : -15) * 60_000,
        );
        if (situation === "fast aboard") {
          await offlineRow
            .getByRole("button", {
              name: role === "diver" ? "Mark boarded" : "Mark aboard",
              exact: true,
            })
            .click();
          await expect(
            offlineRow.getByRole("button", {
              name: role === "diver" ? "Boarded — tap again to undo" : "Aboard — tap again to undo",
              exact: true,
            }),
          ).toBeVisible();
          await live
            .getByRole("dialog")
            .getByRole("button", { name: "Mark not back aboard", exact: true })
            .click();
          await expect(
            live.getByRole("dialog").getByRole("button", { name: "Not back aboard", exact: true }),
          ).toBeVisible();
        } else {
          await offlineRow.getByText("Not back aboard?", { exact: true }).click();
          await offlineRow
            .getByRole("button", { name: "Mark not back aboard", exact: true })
            .click();
          await liveRow
            .getByRole("button", {
              name: role === "diver" ? "Mark boarded" : "Mark aboard",
              exact: true,
            })
            .click();
          await expect(
            liveRow.getByRole("button", {
              name: role === "diver" ? "Boarded — tap again to undo" : "Aboard — tap again to undo",
            }),
          ).toBeVisible();
        }
        // Change the offline clock again between tap and send.
        await setDeviceClock(page, new Date(E2E_FROZEN_CLOCK).getTime() - 7 * 60_000);
        const persisted = page.waitForResponse((response) => {
          const request = response.request();
          return (
            request.method() === "POST" &&
            new URL(response.url()).pathname === "/api/offline-manifests/sync" &&
            ((request.postDataJSON() as { events?: unknown[] }).events?.length ?? 0) > 0
          );
        });
        await context.setOffline(false);
        mark("network-restored");
        const acknowledgement = await persisted;
        expect(acknowledgement.ok()).toBe(true);
        const settled = (await acknowledgement.json()) as {
          results: { status: string }[];
        };
        expect(
          settled.results.some(
            (result) => result.status === "applied" || result.status === "duplicate",
          ),
        ).toBe(true);
        mark("tap-persisted");
        const resolve = page.getByRole("button", {
          name: staff("manifest.conflicts.confirmAboard"),
          exact: true,
        });
        await Promise.all([
          expect(resolve).toBeVisible(),
          live.reload({ waitUntil: "domcontentloaded" }),
        ]);
        mark("conflict-visible-and-live-refreshed");
        await expect(offlineRow).toContainText(staff("manifest.conflicts.missing"));
        const liveResolve = live.getByRole("button", {
          name: staff("manifest.conflicts.confirmAboard"),
          exact: true,
        });
        await expect(liveResolve).toBeVisible();
        // Both raw opposing statements remain visible before reconciliation.
        const panel = live.locator("details").filter({ has: liveResolve });
        await expect(panel).toContainText(staff("manifest.conflicts.missing"));
        await expect(panel).toContainText(staff("manifest.conflicts.aboard"));
        mark("opposing-evidence-checked");
      } finally {
        mark("closing-live-page");
        try {
          await live.close();
          mark("live-page-closed");
        } finally {
          await second.close();
          mark("second-context-closed");
        }
      }
    });
  }
}

// Reconciliation begins with an independently authored, named concurrent
// conflict. Keeping this journey separate preserves the ordinary 15s budget
// while the four cases above prove real clock-skewed reconnects independently.
for (const role of ["diver", "crew"] as const) {
  test.describe(`${role} explicit reconciliation`, () => {
    test.use({
      storageState: { cookies: [], origins: [] },
      privateShopSlug: `causal-${role}-reconciliation`,
      privateShopFacts: [{ name: "causalRollCallConflict", role }],
    });

    test("a second device's explicit resolution reaches a quiet saved copy", async ({
      page,
      context,
      browser,
      privateShop,
    }) => {
      const started = performance.now();
      const mark = (name: string) =>
        console.log("causal resolution step", role, name, Math.round(performance.now() - started));
      const fact = privateShop.values.causalRollCallConflict as {
        role: "diver" | "crew";
        tripId: string;
        fullName: string;
        evidenceIds: string[];
      };
      expect(fact.role).toBe(role);
      expect(fact.evidenceIds).toHaveLength(2);
      const liveUrl = `/shop/${privateShop.slug}/trips/${fact.tripId}/manifest?checkpoint=after_dive_1`;
      const savedCopy = page
        .goto(liveUrl, { waitUntil: "domcontentloaded" })
        .then(() => offlineCopySaved(page));
      const second = await browser.newContext({ storageState: await context.storageState() });
      const live = makeActivitySafe(await second.newPage());
      try {
        await pinBrowserClock(second, E2E_FROZEN_CLOCK);
        await savedCopy;
        mark("snapshot-saved");
        await Promise.all([
          live.goto(liveUrl, { waitUntil: "domcontentloaded" }),
          page.goto(`/offline-manifest?trip=${fact.tripId}&checkpoint=after_dive_1`, {
            waitUntil: "domcontentloaded",
          }),
        ]);
        const liveRow =
          role === "diver"
            ? manifestRow(live, fact.fullName)
            : live.locator("li[id^='crew-row-']").filter({ hasText: fact.fullName });
        const offlineList = page.locator(
          role === "diver" ? "#offline-roll-call" : "#offline-crew-roll-call",
        );
        const offlineRow = offlineList
          .getByRole("listitem")
          .filter({ has: page.getByRole("heading", { name: fact.fullName, exact: true }) });
        const liveResolve = live.getByRole("button", {
          name: staff("manifest.conflicts.confirmAboard"),
          exact: true,
        });
        const savedResolve = page.getByRole("button", {
          name: staff("manifest.conflicts.confirmAboard"),
          exact: true,
        });
        await expect(liveResolve).toBeVisible();
        await expect(savedResolve).toBeVisible();
        const evidence = live.locator("details").filter({ has: liveResolve });
        await expect(evidence).toContainText(staff("manifest.conflicts.missing"));
        await expect(evidence).toContainText(staff("manifest.conflicts.aboard"));
        await expect(offlineRow).toContainText(staff("manifest.conflicts.missing"));
        mark("conflict-visible");
        await liveResolve.click();
        const aboardLabel =
          role === "diver" ? "Boarded — tap again to undo" : "Aboard — tap again to undo";
        await expect(liveRow.getByRole("button", { name: aboardLabel, exact: true })).toBeVisible();
        await expect(liveResolve).toHaveCount(0);
        mark("explicit-resolution-persisted");
        // No event was recorded on the saved device. Its reconnect still has
        // to fetch the other device's resolution; absence alone cannot pass.
        const quietReceipt = page.waitForResponse((response) => {
          const request = response.request();
          if (
            request.method() !== "POST" ||
            new URL(response.url()).pathname !== "/api/offline-manifests/sync"
          )
            return false;
          const batch = request.postDataJSON() as { events?: unknown[]; refreshTripId?: string };
          return batch.refreshTripId === fact.tripId && batch.events?.length === 0;
        });
        await context.setOffline(true);
        await context.setOffline(false);
        const refreshed = await quietReceipt;
        expect(refreshed.ok()).toBe(true);
        await expect(
          offlineRow.getByRole("button", { name: aboardLabel, exact: true }),
        ).toBeVisible();
        await expect(savedResolve).toHaveCount(0);
        mark("quiet-copy-positive-aboard");
      } finally {
        mark("closing-live-page");
        try {
          await live.close();
          mark("live-page-closed");
        } finally {
          await second.close();
          mark("second-context-closed");
        }
      }
    });
  });
}
