import { ImageResponse } from "next/og";

/**
 * The bubble-trail mark, rasterized for the browser tab. ImageResponse runs
 * outside the themed component tree (no access to globals.css custom
 * properties), so the lagoon/coral values are the light-mode brand hexes
 * duplicated intentionally — see src/components/Logo.tsx for the live SVG.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: "linear-gradient(135deg, #0e7490, #155e75)",
        borderRadius: 7,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 3,
          top: 15,
          width: 12,
          height: 12,
          borderRadius: 999,
          background: "#eafcff",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 13,
          top: 8,
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "#eafcff",
          opacity: 0.85,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 21,
          top: 4,
          width: 5,
          height: 5,
          borderRadius: 999,
          background: "#ff6f61",
        }}
      />
    </div>,
    { ...size },
  );
}
