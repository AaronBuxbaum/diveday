import { ImageResponse } from "next/og";
import { BubbleMark } from "@/app/_brand/mark";
import { allowSvgRasterization } from "@/lib/og-rasterizer";

/**
 * Same bubble-trail mark as `icon.tsx`, at the size iOS asks for.
 *
 * Not maskable: iOS applies its own corner radius to a square that bleeds to
 * the edge, which is what `BubbleMark`'s default already draws.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  // Same libvips/SVG hazard as the OG cards, despite this being pure shapes:
  // satori still emits SVG and @vercel/og still rasterizes it through sharp.
  // See src/lib/og-rasterizer.ts.
  await allowSvgRasterization();

  return new ImageResponse(<BubbleMark size={size.width} />, { ...size });
}
