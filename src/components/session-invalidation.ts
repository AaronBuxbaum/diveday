const EVENT = "diveday-session-invalidated";
const CHANNEL = "diveday-session-invalidated-v1";

/** Notify open tabs before this device signs out or starts a new sign-in. */
export function announceSessionInvalidation() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("invalidate");
    channel.close();
  } catch {
    // Same-document invalidation still works when cross-tab messaging is unavailable.
  }
}

export function subscribeSessionInvalidation(invalidate: () => void) {
  window.addEventListener(EVENT, invalidate);
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => invalidate();
    }
  } catch {
    channel?.close();
    channel = null;
  }
  return () => {
    window.removeEventListener(EVENT, invalidate);
    channel?.close();
  };
}
