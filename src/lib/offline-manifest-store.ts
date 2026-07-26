"use client";
import { nowDate } from "./clock";

import {
  canRecordOfflineStatus,
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

async function encryptionKey(db: IDBDatabase): Promise<CryptoKey> {
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
      if (new Date(record.expiresAt) <= nowDate()) await deleteOfflineManifest(tripId, db);
      throw error;
    }
    if (new Date(record.expiresAt) <= nowDate()) {
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

// The live manifest page primes this in the background on mount, and "Save
// for offline" primes it again on click — sharing one in-flight promise keeps
// a fast click from kicking off a second concurrent register/cache round trip.
let primeInFlight: Promise<void> | null = null;

export function primeOfflineManifestShell(): Promise<void> {
  if (!primeInFlight) {
    primeInFlight = (async () => {
      if (!("serviceWorker" in navigator))
        throw new Error("This browser does not support offline mode");
      const registration = await navigator.serviceWorker.register("/manifest-sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: "CACHE_OFFLINE_MANIFEST_SHELL" });
    })().finally(() => {
      primeInFlight = null;
    });
  }
  return primeInFlight;
}
