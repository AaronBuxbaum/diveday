/**
 * A tiny device-local backing store for roll-call note drafts. A note typed at
 * the dock — a kit issue, a medical question — must never be lost to marina
 * Wi-Fi dropping mid-sentence, so every keystroke is mirrored to this device
 * the instant it changes and only cleared once the server confirms the save.
 * When the connection returns the RollCallNote field replays any still-pending
 * draft against the live manifest.
 *
 * Framework-free and defensive: `localStorage` can throw (Safari private mode,
 * quota, storage disabled), so every access is guarded and a failure degrades
 * to in-memory-only behaviour rather than breaking the field mid-keystroke.
 * Keeps no timestamps so it never needs the wall clock (see check:clock).
 */
const PREFIX = "diveday:roll-call-note:v1";

export type NoteDraft = {
  value: string;
  /** True until the server has acknowledged this exact value. */
  pending: boolean;
};

function draftKey(bookingId: string, checkpoint: string): string {
  return `${PREFIX}:${bookingId}:${checkpoint}`;
}

function deviceStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readNoteDraft(bookingId: string, checkpoint: string): NoteDraft | null {
  const store = deviceStore();
  if (!store) return null;
  try {
    const raw = store.getItem(draftKey(bookingId, checkpoint));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoteDraft>;
    if (typeof parsed.value !== "string") return null;
    return { value: parsed.value, pending: parsed.pending === true };
  } catch {
    return null;
  }
}

export function writeNoteDraft(bookingId: string, checkpoint: string, draft: NoteDraft): void {
  const store = deviceStore();
  if (!store) return;
  try {
    store.setItem(draftKey(bookingId, checkpoint), JSON.stringify(draft));
  } catch {
    // Full or unavailable storage: the note still lives in the input, we just
    // can't survive a reload. Better than throwing while staff are typing.
  }
}

export function clearNoteDraft(bookingId: string, checkpoint: string): void {
  const store = deviceStore();
  if (!store) return;
  try {
    store.removeItem(draftKey(bookingId, checkpoint));
  } catch {
    // A store that can't delete also couldn't have written; nothing to undo.
  }
}
