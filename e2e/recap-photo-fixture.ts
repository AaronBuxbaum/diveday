import type { Page } from "@playwright/test";
import sharp from "sharp";

/** The seeded recap's original photo; production and other tests keep its JPEG. */
export const RECAP_PHOTO_PATH =
  "/dive-sites/Blue Parrotfish on Molasses Outer Reef, Key Largo (15274849398).jpg";

/** Preserve the complete decoded photograph; PNG does not offer scaled JPEG decodes. */
export function losslessRecapPhoto(jpeg: Buffer): Promise<Buffer> {
  return sharp(jpeg).png().toBuffer();
}

/**
 * Keep the actual server request and photo, but make its test-only encoding
 * independent of Chromium's choice of full or scaled JPEG decode. The visual
 * assertion still sees the whole photo and fails on any changed source pixels.
 */
export async function stabilizeRecapPhoto(page: Page): Promise<void> {
  await page.route(
    (url) => decodeURIComponent(url.pathname) === RECAP_PHOTO_PATH,
    async (route) => {
      const original = await route.fetch();
      if (!original.ok()) {
        await route.fulfill({ response: original });
        return;
      }
      const png = await losslessRecapPhoto(await original.body());
      await route.fulfill({ status: original.status(), contentType: "image/png", body: png });
    },
  );
}
