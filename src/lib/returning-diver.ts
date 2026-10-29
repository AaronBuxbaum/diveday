/**
 * A diver may opt in to remembering the lead name/email on this device for
 * this shop. This is a convenience only: never payment data, account data, or
 * a cross-shop identity. The server authorizes a successful opt-in before the
 * client writes the memory.
 */

import { DAY_MS, nowDate } from "@/lib/clock";

const STORAGE_PREFIX = "diveday:returning-diver:v2:";
const CLEAR_PREFIX = "diveday:returning-diver:clear:v2:";
const CLEAR_EVENT = "diveday:returning-diver:cleared";
const CLEAR_CHANNEL = "diveday:returning-diver-clear-v2";
const LEGACY_STORAGE_KEY = "diveday:returning-diver:v1";
export const RETURNING_DIVER_MEMORY_MS = 30 * DAY_MS;
export const RETURNING_DIVER_RECEIPT_COOKIE = "diveday-returning-diver-receipt";

export type ReturningDiver = { fullName: string; email: string };

type StoredReturningDiver = ReturningDiver & {
  expiresAt: number;
  receiptId?: string;
  clearGeneration?: string | null;
};

type ClearState = { generation: string; blockedReceiptId?: string };
const volatileClearGenerations = new Map<string, string>();

function isReturningDiver(value: unknown): value is ReturningDiver {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fullName?: unknown }).fullName === "string" &&
    typeof (value as { email?: unknown }).email === "string"
  );
}

function storageKey(shopSlug: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug) ? `${STORAGE_PREFIX}${shopSlug}` : null;
}

function clearKey(shopSlug: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug) ? `${CLEAR_PREFIX}${shopSlug}` : null;
}

function readClearState(shopSlug: string): ClearState | null {
  const key = clearKey(shopSlug);
  if (!key) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { generation?: unknown }).generation !== "string"
    ) {
      localStorage.removeItem(key);
      return null;
    }
    const state = parsed as ClearState;
    return state;
  } catch {
    throw new Error("device storage is unavailable");
  }
}

function effectiveClearState(shopSlug: string): ClearState | null {
  const persistent = readClearState(shopSlug);
  const volatile = volatileClearGenerations.get(shopSlug);
  if (!volatile || persistent?.generation === volatile) return persistent;
  return { ...persistent, generation: volatile };
}

function nextClearGeneration(): string {
  try {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
    );
  } catch {
    return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

/** Capture shop clear generations before the retry request starts. */
export function snapshotReturningDiverClearGenerations(): Record<string, string> | null {
  try {
    const snapshot: Record<string, string> = {};
    const slugs = new Set(volatileClearGenerations.keys());
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CLEAR_PREFIX)) slugs.add(key.slice(CLEAR_PREFIX.length));
    }
    for (const slug of slugs) {
      const state = effectiveClearState(slug);
      if (state) snapshot[slug] = state.generation;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function subscribeToReturningDiverClears(
  onClear: (input: { shopSlug: string; receiptId?: string }) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const receive = (value: unknown) => {
    if (typeof value !== "object" || value === null) return;
    const message = value as { shopSlug?: unknown; generation?: unknown; receiptId?: unknown };
    if (
      typeof message.shopSlug !== "string" ||
      !storageKey(message.shopSlug) ||
      typeof message.generation !== "string"
    ) {
      return;
    }
    const receiptId = typeof message.receiptId === "string" ? message.receiptId : undefined;
    volatileClearGenerations.set(message.shopSlug, message.generation);
    if (receiptId) clearOnlyThisReceipt(storageKey(message.shopSlug) ?? "", receiptId);
    onClear({ shopSlug: message.shopSlug, ...(receiptId ? { receiptId } : {}) });
  };
  const onWindowEvent = (event: Event) => receive((event as CustomEvent<unknown>).detail);
  window.addEventListener(CLEAR_EVENT, onWindowEvent);
  let channel: BroadcastChannel | null = null;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CLEAR_CHANNEL);
  } catch {
    channel = null;
  }
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
  return () => {
    window.removeEventListener(CLEAR_EVENT, onWindowEvent);
    channel?.close();
  };
}

function clearOnlyThisReceipt(key: string, receiptId: string | undefined): void {
  if (!receiptId) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { receiptId?: unknown }).receiptId === receiptId
    ) {
      localStorage.removeItem(key);
    }
  } catch {
    // A blocked store cannot safely confirm or remove this write.
  }
}

function clearLegacyStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be blocked; remembering anyone is optional.
  }
}

/** Remove expired shop-scoped copies opportunistically whenever memory is used. */
function clearExpiredShopMemories(now: Date): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key): key is string => key?.startsWith(STORAGE_PREFIX) ?? false);
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as { expiresAt?: unknown }).expiresAt === "number" &&
          (parsed as { expiresAt: number }).expiresAt <= now.getTime()
        ) {
          localStorage.removeItem(key);
        }
      } catch {
        // The active shop's malformed value is removed by its normal read.
      }
    }
  } catch {
    // Storage can be blocked; remembering anyone is optional.
  }
}

/** Best-effort: storage failures never block booking or the confirmation. */
export function saveReturningDiver(
  shopSlug: string,
  diver: ReturningDiver,
  expiresAt: number,
  now: Date = nowDate(),
  receipt?: { id: string; generationAtStart: string | null },
): "saved" | "cleared" | "unavailable" {
  clearLegacyStorage();
  clearExpiredShopMemories(now);
  const key = storageKey(shopSlug);
  if (!key || !diver.fullName.trim() || !diver.email.trim() || expiresAt <= now.getTime())
    return "unavailable";
  let clearState: ClearState | null;
  try {
    clearState = effectiveClearState(shopSlug);
  } catch {
    return "unavailable";
  }
  if (
    receipt &&
    (receipt.generationAtStart !== (clearState?.generation ?? null) ||
      clearState?.blockedReceiptId === receipt.id)
  ) {
    clearOnlyThisReceipt(key, receipt.id);
    return "cleared";
  }
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...diver,
        expiresAt,
        clearGeneration: clearState?.generation ?? null,
        ...(receipt ? { receiptId: receipt.id } : {}),
      } satisfies StoredReturningDiver),
    );
    // A clear in another tab may land between the pre-write check and setItem.
    // Recheck the generation and remove only this receipt, preserving a later
    // deliberate opt-in that may already have replaced it.
    const latestClear = effectiveClearState(shopSlug);
    if (
      (latestClear?.generation ?? null) !== (clearState?.generation ?? null) ||
      latestClear?.blockedReceiptId === receipt?.id
    ) {
      clearOnlyThisReceipt(key, receipt?.id);
      return "cleared";
    }
    return "saved";
  } catch {
    // Private browsing, quota exceeded, storage disabled — silently skip.
    return "unavailable";
  }
}

export function loadReturningDiver(shopSlug: string, now: Date = nowDate()): ReturningDiver | null {
  clearLegacyStorage();
  clearExpiredShopMemories(now);
  const key = storageKey(shopSlug);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      localStorage.removeItem(key);
      return null;
    }
    if (
      !isReturningDiver(parsed) ||
      typeof (parsed as { expiresAt?: unknown }).expiresAt !== "number"
    ) {
      localStorage.removeItem(key);
      return null;
    }
    const clearState = effectiveClearState(shopSlug);
    const stored = parsed as StoredReturningDiver;
    if (
      clearState &&
      (stored.clearGeneration !== clearState.generation ||
        (stored.receiptId && clearState.blockedReceiptId === stored.receiptId))
    ) {
      localStorage.removeItem(key);
      return null;
    }
    if (stored.expiresAt <= now.getTime()) {
      localStorage.removeItem(key);
      return null;
    }
    return { fullName: parsed.fullName, email: parsed.email };
  } catch {
    return null;
  }
}

export function forgetReturningDiver(shopSlug: string): "cleared" | "partial" | "unavailable" {
  clearLegacyStorage();
  const key = storageKey(shopSlug);
  const tombstone = clearKey(shopSlug);
  if (!key || !tombstone) return "unavailable";
  let blockedReceiptId: string | undefined;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { receiptId?: unknown }).receiptId === "string"
      ) {
        blockedReceiptId = (parsed as { receiptId: string }).receiptId;
      }
    }
    blockedReceiptId ??= readClearState(shopSlug)?.blockedReceiptId;
  } catch {
    // The clear still attempts both writes independently below.
  }
  const generation = nextClearGeneration();
  volatileClearGenerations.set(shopSlug, generation);
  let markerWritten = false;
  let identityRemoved = false;
  try {
    localStorage.setItem(
      tombstone,
      JSON.stringify({
        generation,
        ...(blockedReceiptId ? { blockedReceiptId } : {}),
      } satisfies ClearState),
    );
    markerWritten = true;
  } catch {
    // Persistence may fail from quota; still make the same-tab fence volatile.
  }
  try {
    localStorage.removeItem(key);
    identityRemoved = true;
  } catch {
    // Browser storage can refuse deletion; report partial completion honestly.
  }
  const outcome =
    markerWritten && identityRemoved
      ? "cleared"
      : markerWritten || identityRemoved
        ? "partial"
        : "unavailable";
  if (typeof window !== "undefined") {
    const detail = {
      shopSlug,
      generation,
      ...(blockedReceiptId ? { receiptId: blockedReceiptId } : {}),
    };
    window.dispatchEvent(new CustomEvent(CLEAR_EVENT, { detail }));
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(CLEAR_CHANNEL);
        channel.postMessage(detail);
        channel.close();
      }
    } catch {
      // The local generation and server revocation still fence future retries.
    }
  }
  return outcome;
}
