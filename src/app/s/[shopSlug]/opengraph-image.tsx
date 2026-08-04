import { ImageResponse } from "next/og";
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

const CARD_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  padding: 72,
  backgroundColor: "#071720",
  backgroundImage: "linear-gradient(160deg, #071720 55%, #0d222d 100%)",
  color: "#e9f3f4",
  fontSize: 32,
};

const WORDMARK = (
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 9999,
        backgroundColor: "#22d3ee",
        display: "flex",
      }}
    />
    <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>
      DiveDay
      <span style={{ color: "#ff8a7e" }}>.</span>
    </div>
  </div>
);

function genericCard() {
  return new ImageResponse(
    <div style={CARD_STYLE}>
      {WORDMARK}
      <div style={{ display: "flex", fontSize: 56, fontWeight: 600, letterSpacing: "-0.03em" }}>
        Dive schedule
      </div>
      <div style={{ display: "flex", fontSize: 28, color: "#22d3ee" }}>
        A calmer way to run a dive day
      </div>
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
      {WORDMARK}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", fontSize: 30, color: "#9fc0c7" }}>Dive schedule</div>
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
      <div style={{ display: "flex", fontSize: 28, color: "#22d3ee" }}>
        A calmer way to run a dive day
      </div>
    </div>,
    size,
  );
}
