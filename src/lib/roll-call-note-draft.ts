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

/**
 * Fired on `window` whenever a draft is written or cleared, so a component
 * that is *not* the note field can still track it — specifically the two
 * roll-call buttons, which mirror a still-pending draft into their own submit
 * so a note typed before anyone was called rides whichever result lands.
 * `storage` events only fire in *other* tabs, which is the opposite of what
 * that needs.
 */
export const NOTE_DRAFT_CHANGE_EVENT = "diveday:roll-call-note-draft";

function announce(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTE_DRAFT_CHANGE_EVENT));
}

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
  announce();
}

export function clearNoteDraft(bookingId: string, checkpoint: string): void {
  const store = deviceStore();
  if (!store) return;
  try {
    store.removeItem(draftKey(bookingId, checkpoint));
  } catch {
    // A store that can't delete also couldn't have written; nothing to undo.
  }
  announce();
}

/**
 * Subscribe to one row's still-unsaved draft. Returns the pending text, or
 * `null` when there is nothing owed to the server — either nothing was typed,
 * or what was typed has already been acknowledged.
 *
 * Deliberately `null` for an *acknowledged* draft, not just an absent one: the
 * roll-call buttons post this value as their own `note` field, and posting an
 * empty string for a note the server already holds would silently erase it.
 */
export function pendingNoteDraft(bookingId: string, checkpoint: string): string | null {
  const draft = readNoteDraft(bookingId, checkpoint);
  return draft?.pending ? draft.value : null;
}
