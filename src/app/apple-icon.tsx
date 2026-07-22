import { ImageResponse } from "next/og";

/** Same bubble-trail mark as icon.tsx, scaled up for the iOS home screen. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: "linear-gradient(135deg, #0e7490, #155e75)",
        borderRadius: 39,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 17,
          top: 84,
          width: 68,
          height: 68,
          borderRadius: 999,
          background: "#eafcff",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 73,
          top: 45,
          width: 45,
          height: 45,
          borderRadius: 999,
          background: "#eafcff",
          opacity: 0.85,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 118,
          top: 22,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: "#ff6f61",
        }}
      />
    </div>,
    { ...size },
  );
}
