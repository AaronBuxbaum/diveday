/**
 * VAPID public keys travel as base64url, and `PushManager.subscribe` wants raw
 * bytes — the one conversion between them, kept here (and unit-tested) rather
 * than inline in a component, because getting it subtly wrong produces a
 * subscription that is accepted at signup and silently never delivers.
 *
 * base64url differs from base64 in two ways that both matter: `-`/`_` stand in
 * for `+`/`/`, and the `=` padding is dropped. `atob` accepts neither.
 */
export function applicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  // Backed by a plain ArrayBuffer, not the `ArrayBufferLike` a bare Uint8Array
  // is typed against: `PushSubscriptionOptions.applicationServerKey` is a
  // BufferSource, which excludes SharedArrayBuffer-backed views.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Web Push needs all three of these, and Safari on iOS additionally only grants
 * it to a web app launched from the Home Screen — a plain Safari tab has the
 * APIs present but can never hold a subscription. Split from the permission
 * state on purpose: "this browser cannot" and "you said no" are different
 * problems with different remedies, and telling a captain to check their
 * notification settings when the real answer is "add it to your Home Screen"
 * wastes the one minute they have before the boat leaves.
 */
export function pushSupport(
  win: Pick<Window, "navigator"> & {
    PushManager?: unknown;
    Notification?: unknown;
    matchMedia?: Window["matchMedia"];
  },
): "supported" | "needs-home-screen" | "unsupported" {
  const hasApis = "serviceWorker" in win.navigator && !!win.PushManager && !!win.Notification;
  if (!hasApis) {
    // An iOS Safari *tab* is the case worth naming: the APIs are missing there
    // but present once the same page runs as an installed web app.
    return isIos(win.navigator.userAgent) ? "needs-home-screen" : "unsupported";
  }
  if (isIos(win.navigator.userAgent) && !isStandalone(win)) return "needs-home-screen";
  return "supported";
}

function isIos(userAgent: string): boolean {
  // iPadOS 13+ reports a desktop Macintosh UA, distinguishable only by touch.
  return (
    /iphone|ipad|ipod/i.test(userAgent) ||
    (/macintosh/i.test(userAgent) && typeof document !== "undefined" && "ontouchend" in document)
  );
}

function isStandalone(
  win: Pick<Window, "navigator"> & { matchMedia?: Window["matchMedia"] },
): boolean {
  // `navigator.standalone` is the iOS-only signal; the media query is the
  // standard one every other installed context reports.
  if ((win.navigator as Navigator & { standalone?: boolean }).standalone) return true;
  return win.matchMedia?.("(display-mode: standalone)").matches ?? false;
}
