import { expect, test } from "../e2e/fixtures";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed-identifiers";
import { signRecapToken } from "../src/lib/recap-links";

for (const width of [390, 1280]) {
  test(`optimized public fixture decodes at ${width}px, then recap card rasterizes`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const imageResponses = new Map<string, import("@playwright/test").Response>();
    page.on("response", (response) => {
      if (response.url().includes("/_next/image?")) imageResponses.set(response.url(), response);
    });
    await page.goto("/s/blue-mantis");
    const photo = page.locator('img[srcset*="_next%2Fimage"], img[srcset*="_next/image"]').first();
    await expect(photo).toBeVisible();
    await photo.scrollIntoViewIfNeeded();
    const selected = await photo.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return {
        src: img.currentSrc,
        naturalWidth: img.naturalWidth,
        renderedWidth: img.getBoundingClientRect().width,
      };
    });
    const candidate = Number(new URL(selected.src).searchParams.get("w"));
    expect(candidate).toBeGreaterThan(0);
    expect(candidate).toBeLessThanOrEqual(width === 390 ? 1080 : 3840);
    expect(selected.naturalWidth).toBeGreaterThan(0);
    const image = imageResponses.get(selected.src);
    expect(image, "the browser selected an optimized response").toBeTruthy();
    if (!image) throw new Error("No browser image response");
    expect(image.ok()).toBe(true);
    expect(image.headers()["content-type"]).toMatch(/^image\//);
    const bytes = (await image.body()).length;
    const transfer = await page.evaluate((src) => {
      const resource = performance.getEntriesByName(src).at(-1) as
        | PerformanceResourceTiming
        | undefined;
      return {
        transferBytes: resource?.transferSize ?? null,
        encodedBodyBytes: resource?.encodedBodySize ?? null,
      };
    }, selected.src);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(1_000_000);
    await testInfo.attach("image-delivery", {
      body: JSON.stringify({
        viewport: width,
        ...selected,
        candidate,
        browserResponseBodyBytes: bytes,
        ...transfer,
      }),
      contentType: "application/json",
    });

    // Ordering matters: Next's optimizer initializes sharp before the SVG card path.
    await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
    const advertised = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(advertised).toBeTruthy();
    const card = await request.get(new URL(advertised as string).pathname);
    expect(card.ok()).toBe(true);
    expect(card.headers()["content-type"]).toContain("image/png");
    expect((await card.body()).length).toBeGreaterThan(1000);
  });
}
