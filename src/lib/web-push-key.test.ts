import { describe, expect, it } from "vitest";
import { applicationServerKey, pushSupport } from "./web-push-key";

describe("applicationServerKey", () => {
  it("decodes an unpadded base64url key to its raw bytes", () => {
    // "Hello!" is base64 "SGVsbG8h" — already padding-free and with no
    // substituted characters, so it isolates the plain decode.
    expect(Array.from(applicationServerKey("SGVsbG8h"))).toEqual([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21,
    ]);
  });

  it("restores the padding base64url drops", () => {
    // "Hi" is base64 "SGk=" — one '=' short without re-padding, which `atob`
    // rejects outright rather than decoding to something subtly wrong.
    expect(Array.from(applicationServerKey("SGk"))).toEqual([0x48, 0x69]);
  });

  it("maps the base64url alphabet back to base64", () => {
    // 0xfb 0xff round-trips through '+' and '/' in standard base64 ("+/8=");
    // a key containing those bytes is exactly what a naive atob() call breaks
    // on, and VAPID keys are random enough to hit it regularly.
    expect(Array.from(applicationServerKey("-_8"))).toEqual([0xfb, 0xff]);
  });

  it("decodes a realistic 65-byte VAPID public key", () => {
    // The uncompressed P-256 point a real applicationServerKey carries: 65
    // bytes starting with 0x04. Length is the assertion that matters — a
    // subscription made with the wrong length is accepted and never delivers.
    // 65 bytes is 87 unpadded base64url characters (21 full 3-byte groups →
    // 84 chars, plus 2 trailing bytes → 3 more).
    const key = `B${"A".repeat(86)}`;
    expect(key).toHaveLength(87);
    expect(applicationServerKey(key)).toHaveLength(65);
  });
});

describe("pushSupport", () => {
  const desktop = {
    navigator: { serviceWorker: {}, userAgent: "Mozilla/5.0 (X11; Linux x86_64)" },
    PushManager: {},
    Notification: {},
    matchMedia: () => ({ matches: false }),
  } as unknown as Parameters<typeof pushSupport>[0];

  it("reports a normal browser with all three APIs as supported", () => {
    expect(pushSupport(desktop)).toBe("supported");
  });

  it("reports a browser missing PushManager as unsupported", () => {
    expect(pushSupport({ ...desktop, PushManager: undefined })).toBe("unsupported");
  });

  it("tells an iOS Safari tab to install rather than to check its settings", () => {
    // The APIs are present but iOS only grants a subscription to an installed
    // web app, so the remedy is "add to Home Screen" — not the notification
    // settings a bare "unsupported" would send someone to.
    const iosTab = {
      navigator: {
        serviceWorker: {},
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)",
        standalone: false,
      },
      PushManager: {},
      Notification: {},
      matchMedia: () => ({ matches: false }),
    } as unknown as Parameters<typeof pushSupport>[0];
    expect(pushSupport(iosTab)).toBe("needs-home-screen");
  });

  it("reports the same iOS device as supported once installed to the Home Screen", () => {
    const iosInstalled = {
      navigator: {
        serviceWorker: {},
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)",
        standalone: true,
      },
      PushManager: {},
      Notification: {},
      matchMedia: () => ({ matches: false }),
    } as unknown as Parameters<typeof pushSupport>[0];
    expect(pushSupport(iosInstalled)).toBe("supported");
  });
});
