import { ImageResponse } from "next/og";
import { BubbleMark } from "@/app/_brand/mark";
import { allowSvgRasterization } from "@/lib/og-rasterizer";

/**
 * The bubble-trail mark, rasterized for the browser tab **and for a phone's
 * home screen**.
 *
 * There used to be one size here, 32. `src/app/manifest.ts` referenced it and
 * `apple-icon`, and that is the whole reason DiveDay could not be installed on
 * Android: Chrome's installability criteria want an icon of at least 192×192,
 * and without one it never fires `beforeinstallprompt`, so the "Install app"
 * option simply does not appear (issue #794). The app whose *purpose* is a crew
 * phone holding a manifest for a boat with no signal was the one thing that
 * could not be put on a home screen.
 *
 * These are `ImageResponse` routes, so a size is a number rather than new
 * artwork — the mark is drawn from fractions of it in `_brand/mark.tsx`. The
 * maskable variant is deliberately *not* here: it bleeds to the edge and is
 * meaningless as a favicon, and everything this file declares becomes a
 * `<link rel="icon">` the browser may choose from.
 */
export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  // Same libvips/SVG hazard as the OG cards, despite this being pure shapes:
  // satori still emits SVG and @vercel/og still rasterizes it through sharp.
  // See src/lib/og-rasterizer.ts.
  await allowSvgRasterization();

  const size = Number(await id);
  return new ImageResponse(<BubbleMark size={size} />, { width: size, height: size });
}
