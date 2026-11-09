import { expect, STUB_BASEMAP_TILE, signedInAsOwner, test } from "../e2e/fixtures";
import { DEMO_TODAY_TRIP_ID } from "../src/db/seed-identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { measurementNetworkPolicy } from "./network-policy";

signedInAsOwner();

const routes = {
  today: ["/shop/blue-mantis", "/shop/blue-mantis/settings"],
  manifest: [
    `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}/manifest`,
    `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`,
  ],
  schedule: ["/s/blue-mantis", "/s/blue-mantis/courses"],
  catalog: ["/shop/blue-mantis/dive-sites?view=catalog", "/shop/blue-mantis/dive-sites"],
};

for (const [name, [route, sourceRoute]] of Object.entries(routes)) {
  test(`${name}: cold/warm document and cached/uncached client navigation baseline`, async ({
    page,
    workerBaseURL,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    // A fixed marina-like profile. CPU and byte measures stay separate.
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 100,
      downloadThroughput: 125_000,
      uploadThroughput: 62_500,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      const costs: number[] = [];
      Object.assign(window, { __longTaskCosts: costs });
      new PerformanceObserver((list) =>
        (window as unknown as { __longTaskCosts: number[] }).__longTaskCosts.push(
          ...list.getEntries().map((entry) => entry.duration),
        ),
      ).observe({ type: "longtask", buffered: true });
    });
    let blockedPrefetches = 0;
    // The shared fixture's external stubs also use Playwright routing. Remove
    // them only in this measurement, replacing them with equivalent native stubs.
    await page.context().unrouteAll({ behavior: "wait" });
    const workerOrigin = new URL(workerBaseURL).origin;
    // Native interception avoids Playwright routing's automatic HTTP-cache disable.
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
      const prefetch = Object.entries(request.headers).some(
        ([key, value]) => key.toLowerCase() === "next-router-prefetch" && value === "1",
      );
      if (prefetch) {
        blockedPrefetches++;
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      } else {
        const policy = measurementNetworkPolicy(request.url, workerOrigin);
        if (policy === "continue") await cdp.send("Fetch.continueRequest", { requestId });
        else if (policy === "abort")
          await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
        else {
          const contentType =
            policy === "tile" ? "image/png" : policy === "stylesheet" ? "text/css" : "text/html";
          const body =
            policy === "tile"
              ? STUB_BASEMAP_TILE.toString("base64")
              : Buffer.from(policy === "frame" ? "<!doctype html><title></title>" : "").toString(
                  "base64",
                );
          await cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: "content-type", value: contentType }],
            body,
          });
        }
      }
    });
    const samples = [];
    for (const mode of [
      "cold-document",
      "warm-document",
      "uncached-navigation",
      "cached-navigation",
    ]) {
      if (mode === "cold-document") await cdp.send("Network.clearBrowserCache");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: mode === "uncached-navigation" });
      if (mode === "uncached-navigation") await page.goto(sourceRoute);
      if (mode === "cached-navigation") {
        await page.goBack();
        await page.waitForURL((url) => url.pathname + url.search === sourceRoute);
      }
      await page.evaluate(() => {
        performance.clearResourceTimings();
        Object.assign(window, { __longTaskCosts: [] });
      });
      let documentResponses = 0;
      const responses: Promise<{ type: string; bytes: number; failed?: boolean }>[] = [];
      const record = (response: import("@playwright/test").Response) => {
        if (
          response.request().isNavigationRequest() &&
          response.request().frame() === page.mainFrame()
        )
          documentResponses++;
        const type = response.headers()["content-type"] ?? "";
        if (/javascript|text\/x-component/.test(type))
          responses.push(
            response
              .body()
              .then((body) => ({ type, bytes: body.length }))
              .catch(() => ({ type, bytes: 0, failed: true })),
          );
      };
      page.on("response", record);
      const start = performance.now();
      if (mode === "cached-navigation") {
        await page.goForward();
        await page.waitForURL((url) => url.pathname + url.search === route);
      } else if (mode.includes("navigation")) {
        // Click a real application Next Link; failure to find it is not another document sample.
        const link = page.locator(`a[href="${route}"]`).filter({ visible: true }).first();
        await expect(link).toBeVisible();
        await link.click();
        await page.waitForURL((url) => url.pathname + url.search === route);
      } else await page.goto(route);
      if (name === "manifest")
        await expect(page.locator("#roll-call-list").getByRole("button").first()).toBeVisible();
      else if (name === "catalog") {
        await expect(
          page.getByRole("heading", {
            name: staffTranslator("en-US")("diveSites.catalog.title"),
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.locator(".leaflet-site-marker, .leaflet-site-cluster-marker").first(),
        ).toBeVisible();
      } else if (name === "today")
        await expect(
          page
            .locator(`main a[href^="/shop/blue-mantis/trips/"]`)
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
      else
        await expect(
          page.locator('main a[href^="/s/blue-mantis/trips/"]').filter({ visible: true }).first(),
        ).toBeVisible();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const elapsedMs = performance.now() - start;
      const browser = await page.evaluate(() => {
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const tasks = (window as unknown as { __longTaskCosts: number[] }).__longTaskCosts ?? [];
        return {
          inlineRscCarrierUtf8Bytes: new TextEncoder().encode(
            [...document.scripts]
              .map((script) => script.textContent ?? "")
              .filter((source) => source.includes("self.__next_f"))
              .join("\n"),
          ).length,
          transferBytes: resources.reduce((n, entry) => n + entry.transferSize, 0),
          cachedScriptResources: resources.filter(
            (entry) =>
              /\.js(?:\?|$)/.test(entry.name) &&
              entry.transferSize === 0 &&
              entry.encodedBodySize > 0,
          ).length,
          longTaskMs: tasks.reduce((n, cost) => n + cost, 0),
          longTasks: tasks.length,
        };
      });
      if (mode === "warm-document")
        expect(
          browser.cachedScriptResources,
          "warm sample must observe cached script delivery",
        ).toBeGreaterThan(0);
      page.off("response", record);
      const payloads = await Promise.all(responses);
      expect(
        payloads.every((payload) => !payload.failed),
        "all observed payload bodies must be readable",
      ).toBe(true);
      const decodedRscBytes = payloads
        .filter((payload) => payload.type.includes("text/x-component"))
        .reduce((total, payload) => total + payload.bytes, 0);
      if (mode.includes("navigation")) {
        expect(documentResponses, "client transitions must not become document loads").toBe(0);
        if (mode === "uncached-navigation")
          expect(decodedRscBytes, "uncached navigation must fetch its target RSC").toBeGreaterThan(
            0,
          );
        else expect(decodedRscBytes, "cached history navigation must reuse target RSC").toBe(0);
      }
      // Client transitions retain source document script tags; those are not target RSC bytes.
      if (mode.includes("navigation")) Object.assign(browser, { inlineRscCarrierUtf8Bytes: null });
      samples.push({
        mode,
        elapsedMs,
        documentResponses,
        ...browser,
        decodedJsBytes: payloads
          .filter((p) => p.type.includes("javascript"))
          .reduce((n, p) => n + p.bytes, 0),
        decodedRscBytes,
      });
    }
    await cdp.send("Fetch.disable");
    await testInfo.attach(`${name}-baseline`, {
      body: JSON.stringify({ route, viewport: 390, cpuSlowdown: 4, blockedPrefetches, samples }),
      contentType: "application/json",
    });
  });
}
