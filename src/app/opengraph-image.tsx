import { ImageResponse } from "next/og";
import { allowSvgRasterization } from "@/lib/og-rasterizer";

// i18n-exempt-file: link-preview card rendered for crawlers with no visitor
// locale context, the same carve-out as static metadata.title.
/**
 * The shared-link card for every public page. Rendered by satori, which cannot
 * read CSS custom properties, so the deep-ocean dark palette from
 * `globals.css` is restated here as literals — the one sanctioned exception to
 * the semantic-token rule. Dark works on every chat client's light and dark
 * chrome, which is why the card commits to it.
 */
export const alt =
  "DiveDay — dive shop software for the whole dive day, from booking to head count.";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

export default async function OpenGraphImage() {
  // Before any ImageResponse is built: Next's image optimizer disables
  // libvips' SVG loader process-wide, which is what @vercel/og rasterizes
  // through. See src/lib/og-rasterizer.ts — the failure mode is a severed
  // socket, not an error page.
  await allowSvgRasterization();

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        backgroundColor: "#071720",
        backgroundImage: "linear-gradient(160deg, #071720 55%, #0d222d 100%)",
        color: "#e9f3f4",
        fontSize: 32,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/*
         * The bubble-trail mark from `src/components/Logo.tsx` — three ascending
         * bubbles, the top one the rationed coral accent. Restated as positioned
         * circles because satori has no `<svg>`, with `LogoMark`'s 24x24 viewBox
         * geometry doubled to a 48px box — the same mark-to-wordmark proportion
         * the site header uses (`size-6` beside `text-base`). Keep the two in step. It used to be one plain
         * circle here, which read as a bullet rather than as the logo.
         */}
        <div style={{ display: "flex", position: "relative", width: 48, height: 48 }}>
          <div
            style={{
              position: "absolute",
              left: 4,
              top: 24,
              width: 20,
              height: 20,
              borderRadius: 9999,
              backgroundColor: "#22d3ee",
              display: "flex",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 24,
              top: 11,
              width: 14,
              height: 14,
              borderRadius: 9999,
              backgroundColor: "#22d3ee",
              opacity: 0.75,
              display: "flex",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 35,
              top: 5,
              width: 8,
              height: 8,
              borderRadius: 9999,
              backgroundColor: "#ff8a7e",
              display: "flex",
            }}
          />
        </div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>
          DiveDay
          <span style={{ color: "#ff8a7e" }}>.</span>
        </div>
      </div>

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
          Run the whole dive day, from booking to head count.
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#9fc0c7" }}>
          Bookings · Waivers · Cert checks · Trip prep · The boat
        </div>
      </div>

      <div style={{ display: "flex", fontSize: 28, color: "#22d3ee" }}>
        A calmer way to run a dive day
      </div>
    </div>,
    size,
  );
}
