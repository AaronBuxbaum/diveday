"use client";
import { nowDate } from "./clock";

import {
  canRecordOfflineStatus,
  isOfflineManifestExpired,
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestEnvelope,
  type OfflineManifestPayload,
  type OfflineRollCallEvent,
  offlineManifestExpiresAt,
} from "./offline-manifests";

const DB_NAME = "diveday-offline-manifests";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const MANIFEST_STORE = "manifests";
const KEY_ID = "manifest-aes-gcm-v1";

type StoredRecord = {
  tripId: string;
  expiresAt: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

export type OfflineSyncResult = {
  clientEventId: string;
  status: "applied" | "duplicate" | "rejected";
  reason?: string;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    if (!db.objectStoreNames.contains(MANIFEST_STORE))
      db.createObjectStore(MANIFEST_STORE, { keyPath: "tripId" });
  };
  return requestResult(request);
}

/**
 * Guards the whole read-or-generate-and-write sequence below against two
 * concurrent first-ever callers (e.g. OfflineManifestAutoSave saving several
 * trips at once on a device with no key yet, see
 * ADR 20260726-shopwide-offline-manifest-priming). Without this, both could
 * read "no key yet," each generate and encrypt with its *own* key, and only
 * the last write survives in the key store — leaving every earlier record
 * permanently undecryptable under the one key that remains. A separate lock
 * name from withManifestLock's per-trip locks, so this never nests inside
 * one of those (no deadlock risk) and simply serializes key creation itself.
 */
function withKeyLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request("diveday-offline-manifest-key", fn);
}

async function encryptionKey(db: IDBDatabase): Promise<CryptoKey> {
  return withKeyLock(async () => {
    const read = db.transaction(KEY_STORE, "readonly");
    const existing = await requestResult(read.objectStore(KEY_STORE).get(KEY_ID));
    await transactionDone(read);
    if (existing instanceof CryptoKey) return existing;

    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const write = db.transaction(KEY_STORE, "readwrite");
    write.objectStore(KEY_STORE).put(key, KEY_ID);
    await transactionDone(write);
    return key;
  });
}

function additionalData(tripId: string): ArrayBuffer {
  return new TextEncoder().encode(`${OFFLINE_MANIFEST_RECORD_VERSION}:${tripId}`)
    .buffer as ArrayBuffer;
}

async function persistEnvelope(db: IDBDatabase, envelope: OfflineManifestEnvelope): Promise<void> {
  const tripId = envelope.snapshot.manifests[0]?.trip.id;
  if (!tripId) throw new Error("Manifest snapshot has no trip");
  const key = await encryptionKey(db);
  const iv = crypto.getRandomValues(new Uint8Array(12)).buffer as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(tripId) },
    key,
    new TextEncoder().encode(JSON.stringify(envelope)).buffer as ArrayBuffer,
  );
  const transaction = db.transaction(MANIFEST_STORE, "readwrite");
  transaction.objectStore(MANIFEST_STORE).put({
    tripId,
    expiresAt: envelope.snapshot.expiresAt,
    iv,
    ciphertext,
  } satisfies StoredRecord);
  await transactionDone(transaction);
}

async function readStoredRecord(
  db: IDBDatabase,
  tripId: string,
): Promise<StoredRecord | undefined> {
  const transaction = db.transaction(MANIFEST_STORE, "readonly");
  const record = (await requestResult(transaction.objectStore(MANIFEST_STORE).get(tripId))) as
    | StoredRecord
    | undefined;
  await transactionDone(transaction);
  return record;
}

/**
 * Serializes a read-modify-write cycle against this trip's record across
 * tabs/windows (the live manifest's automatic save, the offline viewer's
 * roll-call append, and sync reconciliation can all be open at once). A plain
 * IndexedDB transaction doesn't cover this: each of those operations reads
 * the current record, decides what to write, and writes it back in *separate*
 * transactions, so one can read stale data, do its work, and overwrite what
 * another wrote in between — silently discarding a roll-call event the other
 * tab just recorded. Never called reentrantly (nothing under a lock calls back
 * into it for the same tripId), so this can't deadlock against itself.
 */
function withManifestLock<T>(tripId: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request(`diveday-offline-manifest:${tripId}`, fn);
}

export async function loadOfflineManifest(tripId: string): Promise<OfflineManifestEnvelope | null> {
  const db = await openDatabase();
  try {
    const record = await readStoredRecord(db, tripId);
    if (!record) return null;
    const key = await encryptionKey(db);
    let envelope: OfflineManifestEnvelope;
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.iv, additionalData: additionalData(tripId) },
        key,
        record.ciphertext,
      );
      envelope = JSON.parse(new TextDecoder().decode(plaintext)) as OfflineManifestEnvelope;
    } catch (error) {
      // Nothing recoverable from ciphertext this key can't open — if it's
      // also past its retention window, clean it up now rather than leaving
      // unreadable bytes behind forever with no delete button to clear them.
      if (isOfflineManifestExpired(record)) await deleteOfflineManifest(tripId, db);
      throw error;
    }
    if (isOfflineManifestExpired(record)) {
      // A record still holding a roll-call event that never reached the
      // server is the only copy of that evidence — keep serving it (as
      // stale) rather than silently discarding it, until every event is
      // resolved and it can expire for real on the next read.
      const hasUnsyncedEvents = envelope.events.some((event) => event.syncStatus === "pending");
      if (!hasUnsyncedEvents) {
        await deleteOfflineManifest(tripId, db);
        return null;
      }
    }
    return envelope;
  } finally {
    db.close();
  }
}

/**
 * Every saved trip on this device, for the offline shell's list view (see
 * ADR 20260726-shopwide-offline-manifest-priming). Reuses loadOfflineManifest
 * per trip rather than a bespoke bulk-decrypt path so the same expiry/
 * pending-event rules (keep an expired record alive only while it still
 * holds an unsynced roll-call event) apply exactly once, in one place,
 * instead of being re-implemented here and risking drift.
 *
 * Ordered upcoming-or-active trips first (soonest departure on top — "the
 * next boat leaving"), then past trips still within their post-trip
 * retention window behind them: a plain ascending sort by start time alone
 * would put an old, already-departed trip ahead of tomorrow's departure
 * once the board has run for more than a few days, which is the opposite of
 * what this list is for.
 */
export async function listOfflineManifests(): Promise<OfflineManifestEnvelope[]> {
  const db = await openDatabase();
  let tripIds: string[];
  try {
    const transaction = db.transaction(MANIFEST_STORE, "readonly");
    tripIds = (await requestResult(
      transaction.objectStore(MANIFEST_STORE).getAllKeys(),
    )) as string[];
    await transactionDone(transaction);
  } finally {
    db.close();
  }
  const envelopes = await Promise.all(
    tripIds.map((tripId) => loadOfflineManifest(tripId).catch(() => null)),
  );
  const now = nowDate();
  const byStartsAt = (a: OfflineManifestEnvelope, b: OfflineManifestEnvelope) =>
    (a.snapshot.manifests[0]?.trip.startsAt ?? "").localeCompare(
      b.snapshot.manifests[0]?.trip.startsAt ?? "",
    );
  const saved = envelopes.filter(
    (envelope): envelope is OfflineManifestEnvelope => envelope !== null,
  );
  const isPast = (envelope: OfflineManifestEnvelope) => {
    const endsAt = envelope.snapshot.manifests[0]?.trip.endsAt;
    return !!endsAt && new Date(endsAt) < now;
  };
  return [
    ...saved.filter((envelope) => !isPast(envelope)).sort(byStartsAt),
    ...saved.filter(isPast).sort(byStartsAt),
  ];
}

/**
 * Deletes every device record belonging to a shop other than the one the
 * caller is currently signed into. This IndexedDB store has never been
 * shop-scoped — it's keyed purely by tripId, per browser origin, not per
 * shop — so a device shared across shops (a freelance captain, a resold or
 * reassigned boat tablet) could otherwise accumulate another shop's roster
 * indefinitely. Call this with the server-verified shop slug from
 * GET /api/offline-manifests/upcoming (never a client-supplied value) any
 * time that endpoint is reached, so the moment a different shop's staff
 * authenticates on this device, the previous shop's cached manifests stop
 * being readable — see ADR 20260726-shopwide-offline-manifest-priming.
 *
 * Never deletes a record still holding an unsynced (`pending`) roll-call
 * event: that event cannot be reconciled under a *different* shop's session
 * (the server would look it up against the wrong tenant and reject or
 * misattribute it), so deleting it here would destroy the only copy of that
 * evidence for good. It's left in place — visible until the original shop's
 * own session next runs a purge pass and finds it resolved, or it clears via
 * the ordinary expiry-once-no-pending-events rule above — the same
 * least-bad tradeoff `loadOfflineManifest` already makes for the single-shop
 * expiry case, applied here too.
 */
export async function purgeOfflineManifestsExceptShop(currentShopSlug: string): Promise<void> {
  const saved = await listOfflineManifests();
  await Promise.all(
    saved
      .filter(
        (envelope) =>
          envelope.snapshot.shop.slug !== currentShopSlug &&
          !envelope.events.some((event) => event.syncStatus === "pending"),
      )
      .map((envelope) => deleteOfflineManifest(envelope.snapshot.manifests[0]?.trip.id ?? "")),
  );
}

export async function saveOfflineManifest(
  payload: OfflineManifestPayload,
): Promise<OfflineManifestEnvelope> {
  const trip = payload.manifests[0]?.trip;
  if (!trip || payload.manifests.length === 0) throw new Error("Manifest payload is empty");
  return withManifestLock(trip.id, async () => {
    // A corrupt or undecryptable existing record (storage corruption, a stale
    // key, a version/AAD mismatch) must not abort the save — there's no delete
    // button anymore, so failing here would brick this device's offline copy
    // for good instead of just losing that record's own queued events.
    const existing = await loadOfflineManifest(trip.id).catch(() => null);
    const savedAt = nowDate();
    const envelope: OfflineManifestEnvelope = {
      snapshot: {
        ...payload,
        version: OFFLINE_MANIFEST_RECORD_VERSION,
        snapshotId: crypto.randomUUID(),
        savedAt: savedAt.toISOString(),
        expiresAt: offlineManifestExpiresAt(savedAt, new Date(trip.endsAt)).toISOString(),
      },
      events: existing?.events ?? [],
    };
    const db = await openDatabase();
    try {
      await persistEnvelope(db, envelope);
    } finally {
      db.close();
    }
    return envelope;
  });
}

export async function deleteOfflineManifest(
  tripId: string,
  existingDb?: IDBDatabase,
): Promise<void> {
  const db = existingDb ?? (await openDatabase());
  try {
    const transaction = db.transaction(MANIFEST_STORE, "readwrite");
    transaction.objectStore(MANIFEST_STORE).delete(tripId);
    await transactionDone(transaction);
  } finally {
    if (!existingDb) db.close();
  }
}

export async function appendOfflineRollCall(
  tripId: string,
  input: Pick<OfflineRollCallEvent, "bookingId" | "checkpoint" | "status" | "note">,
): Promise<OfflineManifestEnvelope> {
  return withManifestLock(tripId, async () => {
    const envelope = await loadOfflineManifest(tripId);
    if (!envelope) throw new Error("Saved manifest is unavailable or expired");
    // A snapshot kept alive past its retention window (loadOfflineManifest
    // preserves one that still has an unsynced event) is not a boarding
    // source — the H-05 stop rule treats expired the same as missing. It
    // stays readable so its pending evidence can still reconcile, but
    // records no new roll call.
    if (isOfflineManifestExpired(envelope.snapshot)) {
      throw new Error("This saved copy has expired — open the live manifest to record roll call.");
    }
    if (!canRecordOfflineStatus(envelope.snapshot, input.bookingId, input.status)) {
      throw new Error("This saved readiness record does not allow boarding");
    }
    envelope.events.push({
      ...input,
      clientEventId: crypto.randomUUID(),
      snapshotId: envelope.snapshot.snapshotId,
      snapshotSavedAt: envelope.snapshot.savedAt,
      tripId,
      occurredAt: nowDate().toISOString(),
      syncStatus: "pending",
    });
    const db = await openDatabase();
    try {
      await persistEnvelope(db, envelope);
    } finally {
      db.close();
    }
    return envelope;
  });
}

export async function syncOfflineManifest(tripId: string): Promise<OfflineManifestEnvelope | null> {
  const envelope = await loadOfflineManifest(tripId);
  if (!envelope) return null;
  const pending = envelope.events.filter((event) => event.syncStatus === "pending");
  if (pending.length === 0 || !navigator.onLine) return envelope;
  const response = await fetch("/api/offline-manifests/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: pending }),
  });
  if (!response.ok)
    throw new Error(
      "Back online, but your roll-call changes couldn't be checked against the live manifest yet.",
    );
  const body = (await response.json()) as { results: OfflineSyncResult[] };
  const byId = new Map(body.results.map((result) => [result.clientEventId, result]));
  // Re-read and merge under the lock instead of writing back the envelope
  // read before the network round-trip: a concurrent appendOfflineRollCall
  // (this tab or another) could have recorded a new pending event while the
  // request was in flight, and writing the pre-fetch snapshot would discard it.
  return withManifestLock(tripId, async () => {
    const current = await loadOfflineManifest(tripId);
    if (!current) return null;
    current.events = current.events.map((event) => {
      const result = byId.get(event.clientEventId);
      if (!result) return event;
      return {
        ...event,
        syncStatus: result.status === "rejected" ? "rejected" : "applied",
        rejectionReason: result.reason,
      };
    });
    const db = await openDatabase();
    try {
      await persistEnvelope(db, current);
    } finally {
      db.close();
    }
    return current;
  });
}

// The live manifest page primes this in the background on mount, and every
// automatic/manual save primes it again — sharing one in-flight promise keeps
// overlapping callers from kicking off a second concurrent register/cache
// round trip.
let primeInFlight: Promise<void> | null = null;

const SHELL_CACHE_ACK_TIMEOUT_MS = 10_000;

export function primeOfflineManifestShell(): Promise<void> {
  if (!primeInFlight) {
    primeInFlight = (async () => {
      if (!("serviceWorker" in navigator))
        throw new Error("This browser does not support offline mode");
      const registration = await navigator.serviceWorker.register("/manifest-sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      const active = registration.active;
      if (!active) throw new Error("This browser does not support offline mode");
      // Wait for the worker's own confirmation that the shell (and every
      // asset it references) actually finished caching — an already-active
      // worker can still fail this (storage quota, a dropped fetch), and a
      // save must not announce "up to date" while that failed silently.
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
          channel.port1.close();
          reject(new Error("The offline shell didn't confirm it was ready in time"));
        }, SHELL_CACHE_ACK_TIMEOUT_MS);
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          channel.port1.close();
          if (event.data?.ok) resolve();
          else reject(new Error(event.data?.error ?? "Offline shell could not be cached"));
        };
        active.postMessage({ type: "CACHE_OFFLINE_MANIFEST_SHELL" }, [channel.port2]);
      });
    })().finally(() => {
      primeInFlight = null;
    });
  }
  return primeInFlight;
}
