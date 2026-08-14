import { ImageResponse } from "next/og";
import { CARD_STYLE, OG_COLORS, OG_WORDMARK, ogFooter } from "@/app/_og/card";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { allowSvgRasterization } from "@/lib/og-rasterizer";

// i18n-exempt-file: link-preview card rendered for crawlers with no visitor
// locale context, the same carve-out as the root `opengraph-image.tsx`.
/**
 * The unfurl card for a shop's public schedule link. A shop sharing its own
 * schedule deserves better than the generic DiveDay card the root
 * `opengraph-image.tsx` renders everywhere — this one names the shop. Kept to
 * the same non-personal fact the schedule page itself shows an anonymous
 * visitor (the shop's name); no trip, roster, or diver data. An unknown slug
 * renders the same generic card a dead link would, disclosing nothing about
 * why (mirrors `src/app/recap/[token]/opengraph-image.tsx`).
 */
export const alt = "A dive shop's schedule on DiveDay.";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

function genericCard() {
  return new ImageResponse(
    <div style={CARD_STYLE}>
      {OG_WORDMARK}
      <div style={{ display: "flex", fontSize: 56, fontWeight: 600, letterSpacing: "-0.03em" }}>
        Dive schedule
      </div>
      {ogFooter()}
    </div>,
    size,
  );
}

export default async function ScheduleOpenGraphImage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  // Before any ImageResponse is built: Next's image optimizer disables
  // libvips' SVG loader process-wide, which is what @vercel/og rasterizes
  // through. See src/lib/og-rasterizer.ts — the failure mode is a severed
  // socket, not an error page.
  await allowSvgRasterization();
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return genericCard();

  return new ImageResponse(
    <div style={CARD_STYLE}>
      {OG_WORDMARK}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", fontSize: 30, color: OG_COLORS.muted }}>Dive schedule</div>
        <div
          style={{
            display: "flex",
            fontSize: 68,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            maxWidth: 1000,
          }}
        >
          {shop.name}
        </div>
      </div>
      {ogFooter()}
    </div>,
    size,
  );
}
