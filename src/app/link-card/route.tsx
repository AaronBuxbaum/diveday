import { ImageResponse } from "next/og";
import { CARD_STYLE, OG_COLORS, OG_WORDMARK, ogFooter } from "@/app/_og/card";
import { allowSvgRasterization } from "@/lib/og-rasterizer";
import { LINK_CARD_SIZE } from "@/lib/site-metadata";

// i18n-exempt-file: link-preview card rendered for crawlers with no visitor
// locale context, the same carve-out as static metadata.title.
/**
 * **The shared-link card for every public page.** The chrome — ground,
 * wordmark, footer — comes from `src/app/_og/card.tsx`, which every card
 * shares; only the body below is this card's own. See that file for why satori
 * cards carry hex rather than semantic tokens.
 *
 * **A route handler and not `src/app/opengraph-image.tsx`, deliberately.** Next
 * attaches a metadata module to every page entry, so as a convention file this
 * card's `next/og` import put 3.07 MiB of satori, its bundled font,
 * `resvg.wasm` and `yoga.wasm` into the traced closure of every route in the
 * app — including the ones that render no image at all. A route handler is its
 * own closure and is attached to nothing (issue #1709, and the same reasoning
 * that keeps `src/app/pwa-icon-maskable/route.tsx` a route). Nothing about the
 * card changed; only who imports it.
 *
 * Because Next no longer generates the URL, the metadata has to name it:
 * `sharedLinkCardImage` in `src/lib/site-metadata.ts` carries the path, the
 * size and the `alt` this file used to export, the root layout names it as the
 * app-wide floor, and every page with an `openGraph` block of its own spreads
 * `sharedLinkCard`. `src/app/_og/card.test.tsx` holds this file to the same
 * chrome obligations as the three `opengraph-image.tsx` cards, and refuses a
 * root metadata module that renders an image.
 */
export async function GET() {
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
    LINK_CARD_SIZE,
  );
}
