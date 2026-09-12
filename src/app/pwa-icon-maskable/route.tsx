import { ImageResponse } from "next/og";
import { BubbleMark } from "@/app/_brand/mark";
import { allowSvgRasterization } from "@/lib/og-rasterizer";

/**
 * **The launcher tile Android crops into whatever shape the phone uses.**
 *
 * A route handler rather than one of the committed icons, because anything
 * that takes Next's `icon` metadata convention becomes a `<link rel="icon">` a
 * browser may pick for a tab — and this one bleeds to the edge with the mark
 * inset inside the safe zone, which is right on a home screen and wrong in a
 * tab strip. `src/app/manifest.ts` is its only referrer.
 *
 * It is also the last request-time rasterizer of the mark: the favicon and the
 * touch icon are PNGs rendered ahead of time by `pnpm brand:icons` (issue
 * #1361, ADR 20260804-og-svg-rasterizer). This one stays live because it is its
 * own function closure and was never attached to a page entry.
 *
 * Without `purpose: "maskable"` in the manifest, Android letterboxes the square
 * mark inside a white circle and shrinks it, which is the state DiveDay shipped
 * in until issue #794.
 */
const SIZE = 512;

export async function GET() {
  // Same libvips/SVG hazard as the OG cards, despite this being pure shapes:
  // satori still emits SVG and @vercel/og still rasterizes it through sharp.
  // See src/lib/og-rasterizer.ts.
  await allowSvgRasterization();

  return new ImageResponse(<BubbleMark size={SIZE} maskable />, {
    width: SIZE,
    height: SIZE,
  });
}
