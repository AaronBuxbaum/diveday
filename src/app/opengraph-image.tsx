import { ImageResponse } from "next/og";
import { CARD_STYLE, OG_COLORS, OG_WORDMARK, ogFooter } from "@/app/_og/card";
import { allowSvgRasterization } from "@/lib/og-rasterizer";

// i18n-exempt-file: link-preview card rendered for crawlers with no visitor
// locale context, the same carve-out as static metadata.title.
/**
 * The shared-link card for every public page. The chrome — ground, wordmark,
 * footer — comes from `src/app/_og/card.tsx`, which every card shares; only
 * the body below is this card's own. See that file for why satori cards carry
 * hex rather than semantic tokens.
 */
export const alt =
  "DiveDay — dive shop software: who's booked, who's cleared, who's on the boat, one answer all day.";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

export default async function OpenGraphImage() {
  // Before any ImageResponse is built: Next's image optimizer disables
  // libvips' SVG loader process-wide, which is what @vercel/og rasterizes
  // through. See src/lib/og-rasterizer.ts — the failure mode is a severed
  // socket, not an error page.
  await allowSvgRasterization();

  return new ImageResponse(
    <div style={CARD_STYLE}>
      {OG_WORDMARK}

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.04em",
            maxWidth: 980,
          }}
        >
          Who's booked, who's cleared, who's on the boat — one answer, all day.
        </div>
        <div style={{ display: "flex", fontSize: 34, color: OG_COLORS.muted }}>
          Bookings · Waivers · Cert checks · Trip prep · The boat
        </div>
      </div>

      {ogFooter()}
    </div>,
    size,
  );
}
