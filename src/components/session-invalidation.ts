const EVENT = "diveday-session-invalidated";
const CHANNEL = "diveday-session-invalidated-v1";
let documentSessionGeneration = 0;
let receiver: BroadcastChannel | null = null;
let receiverConstructor: typeof BroadcastChannel | undefined;
const remoteListeners = new Set<() => void>();

function ensureReceiver() {
  const current = typeof BroadcastChannel === "undefined" ? undefined : BroadcastChannel;
  if (receiver && receiverConstructor === current) return;
  receiver?.close();
  receiver = null;
  receiverConstructor = current;
  if (!current) return;
  try {
    receiver = new current(CHANNEL);
    (receiver as BroadcastChannel & { unref?: () => void }).unref?.();
    receiver.onmessage = (event) => {
      if (event.data !== "invalidate") return;
      documentSessionGeneration += 1;
      for (const listener of remoteListeners) listener();
    };
  } catch {
    receiver?.close();
    receiver = null;
  }
}

export function sessionInvalidationGeneration(): number {
  return documentSessionGeneration;
}

/** Notify open tabs before this device signs out or starts a new sign-in. */
export function announceSessionInvalidation() {
  if (typeof window === "undefined") return;
  documentSessionGeneration += 1;
  window.dispatchEvent(new Event(EVENT));
  if (typeof BroadcastChannel === "undefined") return;
  try {
    ensureReceiver();
    if (receiver) {
      receiver.postMessage("invalidate");
      return;
    }
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("invalidate");
    channel.close();
  } catch {
    // Same-document invalidation still works when cross-tab messaging is unavailable.
  }
}

export function subscribeSessionInvalidation(invalidate: () => void) {
  window.addEventListener(EVENT, invalidate);
  remoteListeners.add(invalidate);
  // Keep the single receiver while this document lives, even when Activity
  // suspends every page listener, so a hidden page observes a later signout.
  ensureReceiver();
  return () => {
    window.removeEventListener(EVENT, invalidate);
    remoteListeners.delete(invalidate);
  };
}
