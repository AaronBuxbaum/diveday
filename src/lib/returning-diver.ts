/**
 * A diver may opt in to remembering the lead name/email on this device for
 * this shop. This is a convenience only: never payment data, account data, or
 * a cross-shop identity. The server authorizes a successful opt-in before the
 * client writes the memory.
 */

import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";

const STORAGE_PREFIX = "diveday:returning-diver:v2:";
const DEVICE_SLOT_PREFIX = "diveday:returning-diver:device:v1:";
const CLEAR_PREFIX = "diveday:returning-diver:clear:v2:";
const CLEAR_EVENT = "diveday:returning-diver:cleared";
const CLEAR_CHANNEL = "diveday:returning-diver-clear-v2";
const LEGACY_STORAGE_KEY = "diveday:returning-diver:v1";
export const RETURNING_DIVER_MEMORY_MS = 30 * DAY_MS;
export const RETURNING_DIVER_DEVICE_SLOT_MS = 24 * HOUR_MS;
export const MAX_RETURNING_DIVER_DEVICE_SLOTS = 32;
export const MAX_RETURNING_DIVER_MEMORIES = 32;
export const RETURNING_DIVER_DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

export type ReturningDiver = { fullName: string; email: string };
export type ReturningDiverMemoryRecord = ReturningDiver & {
  receiptId: string | null;
  receiptOrder: string;
  clearGeneration: string | null;
};

type StoredReturningDiver = ReturningDiver & {
  expiresAt: number;
  receiptId?: string;
  receiptOrder?: string;
  clearGeneration?: string | null;
};

type ClearState = {
  generation: string;
  previousGeneration?: string | null;
  blockedReceiptId?: string;
  expiresAt: number;
};
const volatileClearGenerations = new Map<string, ClearState>();

function isReturningDiver(value: unknown): value is ReturningDiver {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fullName?: unknown }).fullName === "string" &&
    typeof (value as { email?: unknown }).email === "string"
  );
}

function storageKey(shopSlug: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug) ? `${STORAGE_PREFIX}${shopSlug}:` : null;
}

function receiptStorageKey(shopSlug: string, receiptId: string | null): string | null {
  const prefix = storageKey(shopSlug);
  return prefix ? `${prefix}${receiptId ?? "manual"}` : null;
}

function memoryKeys(shopSlug: string): string[] {
  const prefix = storageKey(shopSlug);
  if (!prefix) return [];
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
    (key): key is string => key?.startsWith(prefix) ?? false,
  );
}

function clearKey(shopSlug: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug) ? `${CLEAR_PREFIX}${shopSlug}` : null;
}

function deviceSlotKey(shopSlug: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug) ? `${DEVICE_SLOT_PREFIX}${shopSlug}` : null;
}

/** Create a per-shop, per-tab receipt slot only after explicit opt-in. */
export function getOrCreateReturningDiverDeviceToken(
  shopSlug: string,
  now: Date = nowDate(),
): string | null {
  const key = deviceSlotKey(shopSlug);
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { token?: unknown }).token === "string" &&
        RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test((parsed as { token: string }).token) &&
        typeof (parsed as { expiresAt?: unknown }).expiresAt === "number" &&
        (parsed as { expiresAt: number }).expiresAt > now.getTime()
      ) {
        return (parsed as { token: string }).token;
      }
      sessionStorage.removeItem(key);
    }
    let slotCount = 0;
    const slotKeys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    ).filter(
      (storageKey): storageKey is string => storageKey?.startsWith(DEVICE_SLOT_PREFIX) ?? false,
    );
    for (const slotKey of slotKeys) {
      const stored = sessionStorage.getItem(slotKey);
      if (!stored) continue;
      try {
        const slot: unknown = JSON.parse(stored);
        if (
          typeof slot === "object" &&
          slot !== null &&
          typeof (slot as { token?: unknown }).token === "string" &&
          RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test((slot as { token: string }).token) &&
          typeof (slot as { expiresAt?: unknown }).expiresAt === "number" &&
          (slot as { expiresAt: number }).expiresAt > now.getTime()
        ) {
          slotCount += 1;
        } else {
          sessionStorage.removeItem(slotKey);
        }
      } catch {
        sessionStorage.removeItem(slotKey);
      }
    }
    if (slotCount >= MAX_RETURNING_DIVER_DEVICE_SLOTS) return null;
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(
      key,
      JSON.stringify({ token, expiresAt: now.getTime() + RETURNING_DIVER_DEVICE_SLOT_MS }),
    );
    return token;
  } catch {
    // Memory is optional. A tab without session storage gets no retry slot.
    return null;
  }
}

/** Read only slots created by explicit opt-in in this tab. */
export function getReturningDiverDeviceSlots(shopScope?: string): Array<{
  token: string;
  generation: string | null;
}> {
  try {
    const slots: Array<{ token: string; generation: string | null }> = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(DEVICE_SLOT_PREFIX)) continue;
      const shopSlug = key.slice(DEVICE_SLOT_PREFIX.length);
      if (!storageKey(shopSlug)) continue;
      if (shopScope && shopSlug !== shopScope) continue;
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as { token?: unknown }).token !== "string" ||
        !RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test((parsed as { token: string }).token) ||
        typeof (parsed as { expiresAt?: unknown }).expiresAt !== "number"
      ) {
        sessionStorage.removeItem(key);
        continue;
      }
      if ((parsed as { expiresAt: number }).expiresAt <= nowDate().getTime()) {
        sessionStorage.removeItem(key);
        continue;
      }
      let generation: string | null = null;
      try {
        generation = effectiveClearState(shopSlug)?.generation ?? null;
      } catch {
        // A blocked clear marker fails closed for this shop slot.
        continue;
      }
      slots.push({ token: (parsed as { token: string }).token, generation });
    }
    return slots.length <= MAX_RETURNING_DIVER_DEVICE_SLOTS ? slots : [];
  } catch {
    return [];
  }
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
      typeof (parsed as { generation?: unknown }).generation !== "string" ||
      typeof (parsed as { expiresAt?: unknown }).expiresAt !== "number"
    ) {
      localStorage.removeItem(key);
      return null;
    }
    const state = parsed as ClearState;
    if (state.expiresAt <= nowDate().getTime()) {
      localStorage.removeItem(key);
      return null;
    }
    return state;
  } catch {
    throw new Error("device storage is unavailable");
  }
}

function effectiveClearState(shopSlug: string): ClearState | null {
  const persistent = readClearState(shopSlug);
  const volatile = volatileClearGenerations.get(shopSlug);
  if (volatile && volatile.expiresAt <= nowDate().getTime()) {
    volatileClearGenerations.delete(shopSlug);
    return persistent;
  }
  if (!volatile || persistent?.generation === volatile.generation) return persistent;
  return { ...persistent, ...volatile };
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
    const markerKeys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key): key is string => key?.startsWith(CLEAR_PREFIX) ?? false);
    for (const key of markerKeys) slugs.add(key.slice(CLEAR_PREFIX.length));
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
  onClear: (input: {
    shopSlug: string;
    generation: string;
    previousGeneration: string | null;
    receiptId?: string;
    deviceToken?: string;
  }) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const receive = (value: unknown) => {
    if (typeof value !== "object" || value === null) return;
    const message = value as {
      shopSlug?: unknown;
      generation?: unknown;
      expiresAt?: unknown;
      previousGeneration?: unknown;
      receiptId?: unknown;
      deviceToken?: unknown;
    };
    if (
      typeof message.shopSlug !== "string" ||
      !storageKey(message.shopSlug) ||
      typeof message.generation !== "string" ||
      typeof message.expiresAt !== "number" ||
      (message.previousGeneration !== undefined &&
        message.previousGeneration !== null &&
        (typeof message.previousGeneration !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            message.previousGeneration,
          ))) ||
      message.expiresAt <= nowDate().getTime()
    ) {
      return;
    }
    let currentClear: ClearState | null = null;
    try {
      currentClear = readClearState(message.shopSlug);
    } catch {
      // A volatile fence still orders clear events when localStorage is blocked.
    }
    const volatileClear = volatileClearGenerations.get(message.shopSlug);
    if (!currentClear && volatileClear) currentClear = volatileClear;
    const previousGeneration =
      typeof message.previousGeneration === "string" ? message.previousGeneration : null;
    // Clear generations form a predecessor chain. A delayed event from an
    // earlier clear cannot replace a later generation, without comparing
    // device timestamps to server-issued expiry values.
    if (
      currentClear &&
      currentClear.generation !== message.generation &&
      previousGeneration !== currentClear.generation
    )
      return;
    const receiptId = typeof message.receiptId === "string" ? message.receiptId : undefined;
    const deviceToken =
      typeof message.deviceToken === "string" &&
      RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test(message.deviceToken)
        ? message.deviceToken
        : undefined;
    const slotKey = deviceSlotKey(message.shopSlug);
    try {
      const raw = slotKey ? sessionStorage.getItem(slotKey) : null;
      let currentSlotToken: string | undefined;
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as { token?: unknown }).token === "string" &&
          RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test((parsed as { token: string }).token)
        ) {
          currentSlotToken = (parsed as { token: string }).token;
        }
      }
      // A delayed event from a previous clear must not remove a later opt-in's
      // slot. Also never infer the revoked token from the current slot: the
      // event may have been cloned or delayed across a deliberate new opt-in.
      if (slotKey && deviceToken && currentSlotToken === deviceToken)
        sessionStorage.removeItem(slotKey);
    } catch {
      // The persistent clear generation still fences the local response.
    }
    volatileClearGenerations.set(message.shopSlug, {
      generation: message.generation,
      previousGeneration,
      expiresAt: message.expiresAt,
      ...(receiptId ? { blockedReceiptId: receiptId } : {}),
    });
    if (receiptId) clearOnlyThisReceipt(message.shopSlug, receiptId);
    onClear({
      shopSlug: message.shopSlug,
      generation: message.generation,
      previousGeneration,
      ...(receiptId ? { receiptId } : {}),
      ...(deviceToken ? { deviceToken } : {}),
    });
  };
  const onWindowEvent = (event: Event) => receive((event as CustomEvent<unknown>).detail);
  const onStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(CLEAR_PREFIX) || !event.newValue) return;
    const shopSlug = event.key.slice(CLEAR_PREFIX.length);
    if (!storageKey(shopSlug)) return;
    try {
      const detail: unknown = JSON.parse(event.newValue);
      if (typeof detail === "object" && detail !== null) receive({ ...detail, shopSlug });
    } catch {
      // A malformed cross-tab clear marker cannot authorize deleting form data.
    }
  };
  window.addEventListener(CLEAR_EVENT, onWindowEvent);
  window.addEventListener("storage", onStorage);
  let channel: BroadcastChannel | null = null;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CLEAR_CHANNEL);
  } catch {
    channel = null;
  }
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
  return () => {
    window.removeEventListener(CLEAR_EVENT, onWindowEvent);
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}

function clearOnlyThisReceipt(shopSlug: string, receiptId: string | undefined): void {
  if (!receiptId) return;
  try {
    const key = receiptStorageKey(shopSlug, receiptId);
    if (key) localStorage.removeItem(key);
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

/**
 * Database sequence order is authoritative; client clocks and receipt UUIDs
 * do not establish which booking was issued later.
 */
function compareReceiptOrder(left: string, right: string): number | null {
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) return null;
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length)
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft < normalizedRight ? -1 : 1;
}

function hasNewerSavedReceipt(shopSlug: string, incoming: { id: string; order: string }): boolean {
  for (const key of memoryKeys(shopSlug)) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) continue;
      const stored = parsed as { receiptId?: unknown; receiptOrder?: unknown };
      if (typeof stored.receiptId !== "string" || typeof stored.receiptOrder !== "string") continue;
      const order = compareReceiptOrder(stored.receiptOrder, incoming.order);
      if (order !== null && order > 0) return true;
    } catch {
      // A malformed row cannot establish a newer authoritative receipt.
    }
  }
  return false;
}

/** Keep older out-of-order writes from lingering as extra personal data. */
function pruneOlderSavedReceipts(shopSlug: string, order: string, keepKey: string): void {
  try {
    let newerReceiptExists = false;
    for (const key of memoryKeys(shopSlug)) {
      if (key === keepKey) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        const storedOrder =
          typeof parsed === "object" && parsed !== null
            ? (parsed as { receiptOrder?: unknown }).receiptOrder
            : undefined;
        if (typeof storedOrder !== "string" || !/^\d+$/.test(storedOrder)) {
          localStorage.removeItem(key);
          continue;
        }
        const comparison = compareReceiptOrder(order, storedOrder);
        if (comparison !== null && comparison > 0) localStorage.removeItem(key);
        else if (comparison !== null && comparison < 0) newerReceiptExists = true;
      } catch {
        localStorage.removeItem(key);
      }
    }
    if (newerReceiptExists) localStorage.removeItem(keepKey);
  } catch {
    // The latest receipt remains deterministically selected if pruning fails.
  }
}

/** Remove expired shop-scoped copies opportunistically whenever memory is used. */
function clearExpiredShopMemories(now: Date, preserveKey?: string): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key): key is string => key?.startsWith(STORAGE_PREFIX) ?? false);
    const live: Array<{ key: string; expiresAt: number; order: string }> = [];
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
        } else if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as { expiresAt?: unknown }).expiresAt === "number"
        ) {
          live.push({
            key,
            expiresAt: (parsed as { expiresAt: number }).expiresAt,
            order:
              typeof (parsed as { receiptOrder?: unknown }).receiptOrder === "string"
                ? (parsed as { receiptOrder: string }).receiptOrder
                : "0",
          });
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        // The active shop's malformed value is removed by its normal read.
      }
    }
    const limit = MAX_RETURNING_DIVER_MEMORIES;
    live.sort((left, right) => {
      if (left.key === preserveKey) return 1;
      if (right.key === preserveKey) return -1;
      return left.expiresAt - right.expiresAt || compareReceiptOrder(left.order, right.order) || 0;
    });
    while (live.length > limit) {
      const oldest = live.shift();
      if (oldest) localStorage.removeItem(oldest.key);
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
  receipt?: { id: string; order: string; generationAtStart: string | null },
): "saved" | "cleared" | "unavailable" {
  clearLegacyStorage();
  const key = receiptStorageKey(shopSlug, receipt?.id ?? null);
  if (
    !key ||
    (receipt &&
      (!/^\d+$/.test(receipt.order) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.id))) ||
    !diver.fullName.trim() ||
    !diver.email.trim() ||
    expiresAt <= now.getTime()
  )
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
    clearOnlyThisReceipt(shopSlug, receipt.id);
    return "cleared";
  }
  try {
    if (receipt && hasNewerSavedReceipt(shopSlug, { id: receipt.id, order: receipt.order }))
      return "saved";
    clearExpiredShopMemories(now);
    localStorage.setItem(
      key,
      JSON.stringify({
        ...diver,
        expiresAt,
        clearGeneration: clearState?.generation ?? null,
        ...(receipt ? { receiptId: receipt.id } : {}),
        ...(receipt ? { receiptOrder: receipt.order } : {}),
      } satisfies StoredReturningDiver),
    );
    if (receipt) pruneOlderSavedReceipts(shopSlug, receipt.order, key);
    clearExpiredShopMemories(now, key);
    // A clear in another tab may land between the pre-write check and setItem.
    // Recheck the generation and remove only this receipt, preserving a later
    // deliberate opt-in that may already have replaced it.
    const latestClear = effectiveClearState(shopSlug);
    if (
      (latestClear?.generation ?? null) !== (clearState?.generation ?? null) ||
      latestClear?.blockedReceiptId === receipt?.id
    ) {
      clearOnlyThisReceipt(shopSlug, receipt?.id);
      return "cleared";
    }
    return "saved";
  } catch {
    // Private browsing, quota exceeded, storage disabled — silently skip.
    return "unavailable";
  }
}

export function loadReturningDiver(shopSlug: string, now: Date = nowDate()): ReturningDiver | null {
  const record = loadReturningDiverRecord(shopSlug, now);
  return record ? { fullName: record.fullName, email: record.email } : null;
}

/** Check for a stored candidate without judging its expiry on the device clock. */
export function hasStoredReturningDiver(shopSlug: string): boolean {
  clearLegacyStorage();
  try {
    return memoryKeys(shopSlug).some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}

/** Check whether this device has any shop-scoped memory that may need expiry cleanup. */
export function hasAnyStoredReturningDiver(): boolean {
  clearLegacyStorage();
  try {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).some(
      (key) => key?.startsWith(STORAGE_PREFIX) ?? false,
    );
  } catch {
    return false;
  }
}

/** Read a candidate against a caller-supplied trusted time and retain receipt provenance. */
export function loadReturningDiverRecord(
  shopSlug: string,
  now: Date = nowDate(),
): ReturningDiverMemoryRecord | null {
  clearLegacyStorage();
  clearExpiredShopMemories(now);
  try {
    const clearState = effectiveClearState(shopSlug);
    let latest: StoredReturningDiver | null = null;
    let latestOrder = "0";
    for (const key of memoryKeys(shopSlug)) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        localStorage.removeItem(key);
        continue;
      }
      if (
        !isReturningDiver(parsed) ||
        typeof (parsed as unknown as { expiresAt?: unknown }).expiresAt !== "number" ||
        (parsed as unknown as { expiresAt: number }).expiresAt <= now.getTime()
      ) {
        localStorage.removeItem(key);
        continue;
      }
      const stored = parsed as StoredReturningDiver;
      if (
        (stored.receiptId !== undefined &&
          (typeof stored.receiptOrder !== "string" || !/^\d+$/.test(stored.receiptOrder))) ||
        (stored.receiptOrder !== undefined && !/^\d+$/.test(stored.receiptOrder))
      ) {
        localStorage.removeItem(key);
        continue;
      }
      if (
        clearState &&
        (stored.clearGeneration !== clearState.generation ||
          (stored.receiptId && clearState.blockedReceiptId === stored.receiptId))
      ) {
        localStorage.removeItem(key);
        continue;
      }
      const order = typeof stored.receiptOrder === "string" ? stored.receiptOrder : "0";
      const comparison = compareReceiptOrder(order, latestOrder);
      if (!latest || (comparison !== null && comparison >= 0)) {
        latest = stored;
        latestOrder = order;
      }
    }
    if (latest?.receiptId && latest.receiptOrder)
      pruneOlderSavedReceipts(
        shopSlug,
        latest.receiptOrder,
        receiptStorageKey(shopSlug, latest.receiptId) ?? "",
      );
    return latest
      ? {
          fullName: latest.fullName,
          email: latest.email,
          receiptId: latest.receiptId ?? null,
          receiptOrder: latest.receiptOrder ?? "0",
          clearGeneration: latest.clearGeneration ?? null,
        }
      : null;
  } catch {
    return null;
  }
}

export function forgetReturningDiver(shopSlug: string): "cleared" | "partial" | "unavailable" {
  clearLegacyStorage();
  const prefix = storageKey(shopSlug);
  const tombstone = clearKey(shopSlug);
  const slotKey = deviceSlotKey(shopSlug);
  if (!prefix || !tombstone || !slotKey) return "unavailable";
  let blockedReceiptId: string | undefined;
  let deviceToken: string | undefined;
  let previousGeneration: string | null = null;
  try {
    previousGeneration = effectiveClearState(shopSlug)?.generation ?? null;
  } catch {
    // A failed marker read still permits local deletion, but old receipts may
    // not be safely revoked without knowing the generation they belong to.
  }
  try {
    const rows = memoryKeys(shopSlug).flatMap((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return [];
        return [{ raw, parsed: parsed as { receiptId?: unknown; receiptOrder?: unknown } }];
      } catch {
        return [];
      }
    });
    rows.sort((left, right) => {
      const leftOrder =
        typeof left.parsed.receiptOrder === "string" ? left.parsed.receiptOrder : "0";
      const rightOrder =
        typeof right.parsed.receiptOrder === "string" ? right.parsed.receiptOrder : "0";
      return compareReceiptOrder(rightOrder, leftOrder) ?? 0;
    });
    const latest = rows[0]?.parsed;
    if (typeof latest?.receiptId === "string") blockedReceiptId = latest.receiptId;
    blockedReceiptId ??= readClearState(shopSlug)?.blockedReceiptId;
  } catch {
    // Continue independently so failure reading memory cannot skip slot removal.
  }
  try {
    const slotRaw = sessionStorage.getItem(slotKey);
    if (slotRaw) {
      const slot: unknown = JSON.parse(slotRaw);
      if (
        typeof slot === "object" &&
        slot !== null &&
        typeof (slot as { token?: unknown }).token === "string" &&
        RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test((slot as { token: string }).token)
      ) {
        deviceToken = (slot as { token: string }).token;
      }
    }
  } catch {
    // The clear still attempts slot deletion below.
  }
  const generation = nextClearGeneration();
  const expiresAt = nowDate().getTime() + RETURNING_DIVER_DEVICE_SLOT_MS;
  const clearState: ClearState = {
    generation,
    previousGeneration,
    expiresAt,
    ...(blockedReceiptId ? { blockedReceiptId } : {}),
  };
  volatileClearGenerations.set(shopSlug, clearState);
  let markerWritten = false;
  let identityRemoved = false;
  let slotRemoved = false;
  let markerCapacityAvailable = false;
  try {
    const existing = readClearState(shopSlug);
    let markerCount = 0;
    const markerKeys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((markerKey): markerKey is string => markerKey?.startsWith(CLEAR_PREFIX) ?? false);
    for (const markerKey of markerKeys) {
      if (readClearState(markerKey.slice(CLEAR_PREFIX.length))) markerCount += 1;
    }
    markerCapacityAvailable = Boolean(existing) || markerCount < MAX_RETURNING_DIVER_DEVICE_SLOTS;
  } catch {
    // Persistence may fail from quota; still make the same-tab fence volatile.
  }
  if (markerCapacityAvailable) {
    try {
      localStorage.setItem(tombstone, JSON.stringify(clearState));
      markerWritten = true;
    } catch {
      // Persistence may fail from quota; still make the same-tab fence volatile.
    }
  }
  try {
    identityRemoved = true;
    for (const key of memoryKeys(shopSlug)) {
      try {
        localStorage.removeItem(key);
      } catch {
        identityRemoved = false;
      }
    }
  } catch {
    identityRemoved = false;
  }
  try {
    sessionStorage.removeItem(slotKey);
    slotRemoved = true;
  } catch {
    // A retained slot could retry old consent, so a refused deletion is partial.
  }
  const outcome =
    markerWritten && identityRemoved && slotRemoved
      ? "cleared"
      : markerWritten || identityRemoved || slotRemoved
        ? "partial"
        : "unavailable";
  if (typeof window !== "undefined") {
    const detail = {
      shopSlug,
      generation,
      previousGeneration,
      expiresAt,
      ...(blockedReceiptId ? { receiptId: blockedReceiptId } : {}),
      ...(deviceToken ? { deviceToken } : {}),
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
