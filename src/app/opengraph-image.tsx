import { ImageResponse } from "next/og";

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

export default function OpenGraphImage() {
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
