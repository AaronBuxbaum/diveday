"use client";
import { nowDate } from "./clock";
import {
  canRecordOfflineArrival,
  canRecordOfflineChecklistCheck,
  canRecordOfflineCrewStatus,
  canRecordOfflineStatus,
  isOfflineManifestExpired,
  medicalAlertWordsOf,
  OFFLINE_MANIFEST_MAX_RETENTION_MS,
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineArrivalEvent,
  type OfflineChecklistEvent,
  type OfflineManifestEnvelope,
  type OfflineManifestPayload,
  type OfflineManifestUpcomingResponse,
  type OfflineMedicalAlertsSavedBy,
  type OfflineRollCallEvent,
  offlineArrivalEvents,
  offlineManifestExpiresAt,
  offlineManifestMayHoldMedicalAlertWords,
  offlineManifestPayloads,
  offlineManifestShopSlug,
  offlineManifestViewerPersonId,
  offlineRollCallSubject,
  offlineSnapshotTokenClaims,
  pendingOfflineEventCount,
  withMedicalAlertWords,
} from "./offline-manifests";
import { type PostedOfflineEvents, receiptStillNamesCurrentEvents } from "./offline-sync-receipt";
import { clientRollCallEvidenceId } from "./roll-call-causality";
import {
  OFFLINE_UNRESOLVED_HEADER,
  OFFLINE_UNRESOLVED_VERSION,
  ROLL_CALL_CAUSAL_HEADERS,
} from "./roll-call-protocol";

const DB_NAME = "diveday-offline-manifests";
// Version 2 keeps the same stores and ciphertext. Older shells opening version
// 1 cannot write once the conditional-write protocol is active.
const DB_VERSION = 2;
const KEY_STORE = "keys";
const MANIFEST_STORE = "manifests";
const UNREADABLE_PRESERVATION_PREFIX = "unreadable-preservation-v1:";
const KEY_ID = "manifest-aes-gcm-v1";
const KEY_EPOCH_KEY = "manifest-aes-gcm-identity-v1";
const TENANT_ROUND_KEY = "tenant-verification-round-v1";
const MANIFEST_CHANGE_EVENT = "diveday-offline-manifest-change";
const MANIFEST_CHANGE_CHANNEL = "diveday-offline-manifest-changes-v1";
const MANIFEST_SOURCE_ID =
  globalThis.crypto?.randomUUID?.() ?? `manifest-${Math.random().toString(36).slice(2)}`;

export type OfflineManifestChangeReason =
  | "snapshot"
  | "record"
  | "sync"
  | "medical-alerts"
  | "delete"
  | "unknown";

export type OfflineManifestChangeSource = {
  origin: "same-document" | "same-context-broadcast" | "other-context-broadcast";
  reason: OfflineManifestChangeReason;
};

type ManifestBrowserWindow = {
  dispatchEvent: (event: Event) => boolean;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
};

function manifestBrowserWindow(): ManifestBrowserWindow | undefined {
  return (globalThis as typeof globalThis & { window?: ManifestBrowserWindow }).window;
}

export type OfflineManifestChangeListener = (
  tripId: string,
  source: OfflineManifestChangeSource,
) => void;

function manifestChangeReason(value: unknown): OfflineManifestChangeReason {
  if (typeof value !== "object" || value === null || !("reason" in value)) return "unknown";
  const reason = (value as { reason?: unknown }).reason;
  return reason === "snapshot" ||
    reason === "record" ||
    reason === "sync" ||
    reason === "medical-alerts" ||
    reason === "delete"
    ? reason
    : "unknown";
}

function manifestChangeOrigin(value: unknown): OfflineManifestChangeSource["origin"] {
  if (typeof value !== "object" || value === null || !("sourceId" in value)) {
    return "other-context-broadcast";
  }
  return (value as { sourceId?: unknown }).sourceId === MANIFEST_SOURCE_ID
    ? "same-context-broadcast"
    : "other-context-broadcast";
}

function validTripChange(value: unknown): value is { tripId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "tripId" in value &&
    typeof value.tripId === "string" &&
    value.tripId.length > 0
  );
}

function announceManifestChange(tripId: string, reason: OfflineManifestChangeReason): void {
  const change = { tripId, sourceId: MANIFEST_SOURCE_ID, reason };
  const browserWindow = manifestBrowserWindow();
  if (browserWindow) {
    browserWindow.dispatchEvent(new CustomEvent(MANIFEST_CHANGE_EVENT, { detail: change }));
  }
  // Service workers have no `window`, but they share this origin's
  // BroadcastChannel namespace with open pages. The trip key and source/reason
  // metadata are non-sensitive; receivers reload the encrypted record from IDB.
  if (typeof BroadcastChannel !== "undefined") {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(MANIFEST_CHANGE_CHANNEL);
      channel.postMessage(change);
    } catch {
      // IndexedDB remains authoritative; the next focus/visibility reload
      // picks up the mutation when cross-context messaging is unavailable.
    } finally {
      channel?.close();
    }
  }
}

/**
 * Subscribe to committed changes in another tab or in this document. Readers
 * reload the encrypted record from IndexedDB rather than trusting the
 * cross-context trip key and source/reason metadata.
 */
export function subscribeOfflineManifestChanges(listener: OfflineManifestChangeListener) {
  const browserWindow = manifestBrowserWindow();
  if (!browserWindow) return () => {};
  const onLocalChange = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (validTripChange(detail)) {
      listener(detail.tripId, { origin: "same-document", reason: manifestChangeReason(detail) });
    }
  };
  browserWindow.addEventListener(MANIFEST_CHANGE_EVENT, onLocalChange);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(MANIFEST_CHANGE_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (validTripChange(event.data)) {
          listener(event.data.tripId, {
            origin: manifestChangeOrigin(event.data),
            reason: manifestChangeReason(event.data),
          });
        }
      };
    } catch {
      // Same-document notifications and visibility reload remain available.
    }
  }
  return () => {
    browserWindow.removeEventListener(MANIFEST_CHANGE_EVENT, onLocalChange);
    channel?.close();
  };
}

/** After this grace period, a copy with pending events is retained but withheld
 * from ordinary reads. Recovery requires a separate live authorization path.
 */
export const OFFLINE_MANIFEST_PENDING_GRACE_MS = 2 * OFFLINE_MANIFEST_MAX_RETENTION_MS;

/**
 * What an earlier shell gave up when its retention ceiling fired: enough for a human to
 * go and find out what was lost, and deliberately nothing more. No diver names,
 * no booking ids, no emergency contacts, no readiness text — the notice must not
 * quietly re-retain the very roster the discard exists to remove. A trip title
 * and the shop's own name are what make the loss actionable ("Reef Runners ·
 * Morning Two-Tank"); both are already on every staff-facing screen and neither
 * describes a person.
 */
export type DiscardedOfflineRecord = {
  /** Stable identity keeps a later loss on the same trip from being acknowledged accidentally. */
  noticeId: string;
  tripId: string;
  tripTitle: string;
  shopName: string;
  /** Saved tenant identity lets verified devices hide another shop's notice. */
  shopSlug: string;
  /** How many roll-call events on that record had never reached the server. */
  pendingEvents: number;
  discardedAt: string;
};

/**
 * Stored beside the encryption key rather than in an object store of its own,
 * which would mean bumping `DB_VERSION`. That bump is not free here: an older
 * offline shell held in a device's service-worker cache (the whole reason
 * `OFFLINE_MANIFEST_SHELL_VERSION` exists) opens this database at version 1, and
 * `indexedDB.open(name, 1)` against a version-2 database fails outright with a
 * `VersionError` — so a schema bump would take a stale-but-working dock copy and
 * brick its storage entirely, on the surface that exists for having no signal.
 * `KEY_STORE` is an out-of-line-keyed store, so an entry under a different key is
 * invisible to every version of this module that only ever reads `KEY_ID`.
 */
const DISCARD_NOTICE_KEY = "discarded-pending-roll-call-v1";

/** Newest kept; a device that somehow discards more than this has bigger news. */
const DISCARD_NOTICE_LIMIT = 50;

type StoredRecord = {
  tripId: string;
  expiresAt: string;
  /** Non-name metadata used to recheck tenant/pending state in the delete transaction. */
  shopSlug?: string;
  pendingEvents?: number;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

type InventoryFence = {
  generation: number;
  records: StoredRecord[];
  preservationKeys: IDBValidKey[];
};

function sameInventoryRecords(expected: StoredRecord[], actual: unknown[]): boolean {
  if (expected.length !== actual.length || !actual.every(strictStoredRecoveryRecord)) return false;
  return expected.every((row, index) => sameStoredRecord(row, actual[index] as StoredRecord));
}

function samePreservationKeys(expected: IDBValidKey[], actual: IDBValidKey[]): boolean {
  const keys = actual.filter(isPreservationKey);
  return expected.length === keys.length && expected.every((key, index) => key === keys[index]);
}

type ManifestVersion = {
  generation: number;
  tenantRound: number;
  record: StoredRecord | undefined;
};
const loadedManifestVersions = new WeakMap<OfflineManifestEnvelope, ManifestVersion>();
const generationKey = (tripId: string) => `manifest-generation-v2:${tripId}`;
const INVENTORY_GENERATION_KEY = "manifest-inventory-generation-v2";

function storedGeneration(value: unknown): number {
  if (value === undefined) return 0;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= Number.MAX_SAFE_INTEGER
  )
    throw new OfflineManifestError("unavailable");
  return value;
}

/** Must be called inside the same read/write transaction as the record mutation. */
function advanceInventoryGeneration(keys: IDBObjectStore): void {
  keys.get(INVENTORY_GENERATION_KEY).onsuccess = (event) => {
    try {
      const current = storedGeneration((event.target as IDBRequest<unknown>).result);
      if (current >= Number.MAX_SAFE_INTEGER - 1) throw new Error("inventory generation exhausted");
      keys.put(current + 1, INVENTORY_GENERATION_KEY);
    } catch {
      keys.transaction.abort();
    }
  };
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStoredRecord(a: StoredRecord | undefined, b: StoredRecord | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.tripId === b.tripId &&
    a.expiresAt === b.expiresAt &&
    a.shopSlug === b.shopSlug &&
    a.pendingEvents === b.pendingEvents &&
    sameBytes(a.iv, b.iv) &&
    sameBytes(a.ciphertext, b.ciphertext)
  );
}

function loadedVersion(envelope: OfflineManifestEnvelope): ManifestVersion {
  const version = loadedManifestVersions.get(envelope);
  if (!version) throw new OfflineManifestError("unavailable");
  return version;
}

export type OfflineSyncResult = {
  clientEventId: string;
  status: "applied" | "duplicate" | "rejected" | "unresolved";
  storedOccurredAt?: string;
  reason?: string;
  noteDisposition?: "discarded_erasure_cutoff" | "discarded_unverified_snapshot";
};

/** The sync route's answer: one result per event, and each departure's snapshot revision. */
type OfflineSyncResponse = {
  results: OfflineSyncResult[];
  refreshedManifests?: OfflineManifestUpcomingResponse;
  /** Absent from a server that predates it, or when its read failed; see `offlineEventInCopy`. */
  snapshotRevisions?: Record<string, number>;
};

/**
 * A code, not a sentence (`src/lib` returns codes, not English — ADR
 * 20260731-domain-layer-copy-leaks) — this module is `"use client"` but still
 * framework-free domain logic, and its callers (`OfflineManifestView`,
 * `OfflineManifestManager`) display these to a captain mid-roll-call, so a
 * bare `Error("...")` string here would be the literal on-screen refusal text
 * for the fail-closed boarding gate, unlocalized (dive-domain-expert review,
 * docs/product/features/story-backlog.md, Sal). Callers map the code through their own
 * translator.
 */
export type OfflineManifestErrorCode =
  | "unavailable"
  | "expired"
  | "not_allowed"
  | "write_conflict"
  | "shop_changed"
  | "sync_unreachable";

export class OfflineManifestError extends Error {
  readonly code: OfflineManifestErrorCode;
  constructor(code: OfflineManifestErrorCode) {
    super(`offline-manifest-error:${code}`);
    this.name = "OfflineManifestError";
    this.code = code;
  }
}

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
  return new Promise((resolve, reject) => {
    let cancelled = false;
    request.onblocked = () => {
      cancelled = true;
      reject(new OfflineManifestError("unavailable"));
    };
    request.onupgradeneeded = () => {
      if (cancelled) {
        request.transaction?.abort();
        return;
      }
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(MANIFEST_STORE))
        db.createObjectStore(MANIFEST_STORE, { keyPath: "tripId" });
    };
    request.onerror = () => {
      if (!cancelled) reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (cancelled) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

/**
 * What a refreshed snapshot says about the notes this device holds.
 * `unverified`: the old copy's token never proved its epoch, so none of its
 * text can be trusted to have crossed no erasure. `erasure`: a newer epoch,
 * so somebody in the shop was erased since, and only that person's own notes
 * go (issue #3569); every other note stays for the server, which judges each
 * one against its own signed token (`src/db/manifests.ts`).
 */
function refreshForSnapshot(
  previousToken: string | undefined,
  currentToken: string | undefined,
): "unverified" | "erasure" | undefined {
  const current = offlineSnapshotTokenClaims(currentToken);
  if (!current) return undefined;
  const previous = offlineSnapshotTokenClaims(previousToken);
  if (!previous) return "unverified";
  return current.epoch > previous.epoch ? "erasure" : undefined;
}

function clearSavedNotes<T extends OfflineRollCallEvent | OfflineChecklistEvent>(
  events: T[],
  disposition: NonNullable<OfflineSyncResult["noteDisposition"]>,
  clears: (event: T) => boolean = () => true,
): T[] {
  return events.map((event) =>
    event.note?.trim() && clears(event)
      ? { ...event, note: null, noteDisposition: disposition }
      : event,
  );
}

/**
 * `ANONYMIZED_PERSON_NAME` (`src/features/anonymization/rules.ts`), which this client
 * module cannot import: that file pulls in `node:crypto`. A test pins the two.
 */
export const OFFLINE_ERASED_NAME = "[anonymized]";

/**
 * The roll-call subjects a fresh snapshot shows as erased: a seat or crew row
 * under the erased name. A subject the fresh copy no longer carries at all
 * may be erased too, but may as well have been moved or cancelled, so that
 * alone clears only a note the server already has (`applied`): a pending
 * "last seen at the mooring line" is never dropped on a guess.
 */
function erasedSubjectNote(payload: OfflineManifestPayload, tripId: string) {
  const manifest = payload.manifests.find((entry) => entry.trip.id === tripId);
  const named = new Map<string, string>();
  for (const diver of manifest?.divers ?? []) named.set(diver.bookingId, diver.fullName);
  for (const crew of manifest?.crew ?? []) if (crew.id) named.set(crew.id, crew.fullName);
  return (event: OfflineRollCallEvent) => {
    const subject = event.bookingId ?? event.crewPersonId;
    const name = subject ? named.get(subject) : undefined;
    if (name === OFFLINE_ERASED_NAME) return true;
    return name === undefined && event.syncStatus === "applied";
  };
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
    // Existing keys from older stores acquire an identity in the same
    // transaction that reads them. Supported key writers update it whenever
    // they install a new key; recovery compares it at its own commit.
    const read = db.transaction(KEY_STORE, "readwrite");
    const readDone = transactionDone(read);
    const readStore = read.objectStore(KEY_STORE);
    let existing: unknown;
    let identity: unknown;
    let ready = 0;
    const identify = () => {
      if (++ready !== 2) return;
      if (existing instanceof CryptoKey && identity === undefined)
        readStore.put(crypto.randomUUID(), KEY_EPOCH_KEY);
      else if (existing instanceof CryptoKey && (typeof identity !== "string" || !identity))
        read.abort();
    };
    readStore.get(KEY_ID).onsuccess = (event) => {
      existing = (event.target as IDBRequest<unknown>).result;
      identify();
    };
    readStore.get(KEY_EPOCH_KEY).onsuccess = (event) => {
      identity = (event.target as IDBRequest<unknown>).result;
      identify();
    };
    await readDone;
    if (existing instanceof CryptoKey) return existing;

    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    // Installing a replacement key while any old ciphertext exists would make
    // later recovery ambiguous and could strand the only queued evidence.
    // Serialize the empty-store check with both key and manifest writers.
    const write = db.transaction([KEY_STORE, MANIFEST_STORE], "readwrite");
    const done = transactionDone(write);
    const store = write.objectStore(KEY_STORE);
    let selected: CryptoKey | undefined;
    let keyReady = false;
    let countReady = false;
    let archiveKeysReady = false;
    let archiveKeys: IDBValidKey[] = [];
    let winner: unknown;
    let count = 0;
    const choose = () => {
      if (!keyReady || !countReady || !archiveKeysReady) return;
      if (winner instanceof CryptoKey) selected = winner;
      else if (winner === undefined && count === 0 && !archiveKeys.some(isPreservationKey)) {
        store.put(key, KEY_ID);
        store.put(crypto.randomUUID(), KEY_EPOCH_KEY);
        selected = key;
      } else write.abort();
    };
    store.get(KEY_ID).onsuccess = (event) => {
      winner = (event.target as IDBRequest<unknown>).result;
      keyReady = true;
      choose();
    };
    write.objectStore(MANIFEST_STORE).count().onsuccess = (event) => {
      count = (event.target as IDBRequest<number>).result;
      countReady = true;
      choose();
    };
    store.getAllKeys().onsuccess = (event) => {
      archiveKeys = (event.target as IDBRequest<IDBValidKey[]>).result;
      archiveKeysReady = true;
      choose();
    };
    await done;
    if (!selected) throw new Error("Offline encryption key unavailable");
    return selected;
  });
}

function isPreservationKey(key: IDBValidKey): boolean {
  return typeof key === "string" && key.startsWith(UNREADABLE_PRESERVATION_PREFIX);
}

function additionalData(tripId: string): ArrayBuffer {
  return new TextEncoder().encode(`${OFFLINE_MANIFEST_RECORD_VERSION}:${tripId}`)
    .buffer as ArrayBuffer;
}

function nextTenantRound(previous: unknown): number | null {
  if (previous === undefined) return 1;
  if (
    typeof previous !== "number" ||
    !Number.isSafeInteger(previous) ||
    previous < 0 ||
    previous >= Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  return previous + 1;
}

/** Compare non-extractable keys while the readwrite transaction excludes other writers. */
function verifyTransactionKey(
  store: IDBObjectStore,
  candidate: CryptoKey,
  dataIv: ArrayBuffer,
  finish: (matches: boolean) => void,
): void {
  const read = store.get(KEY_ID);
  read.onsuccess = () => {
    const current: unknown = read.result;
    if (!(current instanceof CryptoKey)) {
      finish(false);
      return;
    }
    try {
      const proofIv = new Uint8Array(dataIv.slice(0));
      proofIv[0] ^= 0x80; // The proof never reuses this write's encryption nonce.
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      let verdict: boolean | undefined;
      const deadline = performance.now() + 2_000;
      crypto.subtle
        .encrypt({ name: "AES-GCM", iv: proofIv }, candidate, challenge)
        .then((proof) => crypto.subtle.decrypt({ name: "AES-GCM", iv: proofIv }, current, proof))
        .then(
          (plaintext) => {
            verdict = sameBytes(challenge.buffer as ArrayBuffer, plaintext);
          },
          () => {
            verdict = false;
          },
        )
        .catch(() => {
          verdict = false;
        });
      // IndexedDB transactions become inactive between tasks. Keep one request
      // outstanding while WebCrypto runs, and make the decision in its callback.
      const poll = () => {
        const request = store.get(KEY_ID);
        request.onsuccess = () => {
          if (verdict !== undefined || performance.now() >= deadline) {
            finish(verdict === true && performance.now() < deadline);
            return;
          }
          try {
            poll();
          } catch {
            finish(false);
          }
        };
      };
      poll();
    } catch {
      finish(false);
    }
  };
}

async function persistEnvelope(
  db: IDBDatabase,
  envelope: OfflineManifestEnvelope,
  expected: ManifestVersion,
  tenantRound?: number,
  changeReason: OfflineManifestChangeReason = "unknown",
  expectedInventory?: InventoryFence,
): Promise<boolean> {
  const tripId = envelope.snapshot.manifests[0]?.trip.id;
  if (!tripId) throw new Error("Manifest snapshot has no trip");
  const key = await encryptionKey(db);
  const iv = crypto.getRandomValues(new Uint8Array(12)).buffer as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(tripId) },
    key,
    new TextEncoder().encode(JSON.stringify(envelope)).buffer as ArrayBuffer,
  );
  const transaction = db.transaction([KEY_STORE, MANIFEST_STORE], "readwrite");
  const done = transactionDone(transaction);
  let persisted = false;
  let conflicted = false;
  let invalidGeneration = false;
  let recordReady = false;
  let generationReady = false;
  let roundReady = false;
  let inventoryReady = false;
  let recordsReady = !expectedInventory;
  let preservationKeysReady = !expectedInventory;
  let keyReady = false;
  let keyMatches = false;
  let record: StoredRecord | undefined;
  let generation: unknown;
  let currentRound: unknown;
  let inventoryGeneration: unknown;
  let inventoryRecords: unknown[] = [];
  let preservationKeys: IDBValidKey[] = [];
  let committedRecord: StoredRecord | undefined;
  const keys = transaction.objectStore(KEY_STORE);
  const manifestStore = transaction.objectStore(MANIFEST_STORE);
  const maybeWrite = () => {
    if (
      !recordReady ||
      !generationReady ||
      !roundReady ||
      !inventoryReady ||
      !recordsReady ||
      !preservationKeysReady ||
      !keyReady
    )
      return;
    if (!keyMatches) {
      conflicted = true;
      return;
    }
    const currentTenantRound = currentRound === undefined ? 0 : currentRound;
    if (tenantRound !== undefined && currentTenantRound !== tenantRound) return;
    if (currentTenantRound !== expected.tenantRound) {
      conflicted = true;
      return;
    }
    let token: number;
    try {
      token = storedGeneration(generation);
      if (
        expectedInventory !== undefined &&
        (storedGeneration(inventoryGeneration) !== expectedInventory.generation ||
          !sameInventoryRecords(expectedInventory.records, inventoryRecords) ||
          !samePreservationKeys(expectedInventory.preservationKeys, preservationKeys))
      ) {
        conflicted = true;
        return;
      }
    } catch {
      invalidGeneration = true;
      return;
    }
    if (token !== expected.generation || !sameStoredRecord(record, expected.record)) {
      conflicted = true;
      return;
    }
    const newRecord = {
      tripId,
      expiresAt: envelope.snapshot.expiresAt,
      shopSlug: envelope.snapshot.shop.slug,
      pendingEvents: pendingOfflineEventCount(envelope),
      iv,
      ciphertext,
    } satisfies StoredRecord;
    manifestStore.put(newRecord);
    committedRecord = newRecord;
    keys.put(token + 1, generationKey(tripId));
    advanceInventoryGeneration(keys);
    persisted = true;
  };
  manifestStore.get(tripId).onsuccess = (event) => {
    record = (event.target as IDBRequest<StoredRecord | undefined>).result;
    recordReady = true;
    maybeWrite();
  };
  keys.get(generationKey(tripId)).onsuccess = (event) => {
    generation = (event.target as IDBRequest<unknown>).result;
    generationReady = true;
    maybeWrite();
  };
  keys.get(TENANT_ROUND_KEY).onsuccess = (event) => {
    currentRound = (event.target as IDBRequest<unknown>).result;
    roundReady = true;
    maybeWrite();
  };
  keys.get(INVENTORY_GENERATION_KEY).onsuccess = (event) => {
    inventoryGeneration = (event.target as IDBRequest<unknown>).result;
    inventoryReady = true;
    maybeWrite();
  };
  verifyTransactionKey(keys, key, iv, (matches) => {
    keyMatches = matches;
    keyReady = true;
    maybeWrite();
  });
  if (expectedInventory) {
    manifestStore.getAll().onsuccess = (event) => {
      inventoryRecords = (event.target as IDBRequest<unknown[]>).result;
      recordsReady = true;
      maybeWrite();
    };
    keys.getAllKeys().onsuccess = (event) => {
      preservationKeys = (event.target as IDBRequest<IDBValidKey[]>).result;
      preservationKeysReady = true;
      maybeWrite();
    };
  }
  await done;
  if (persisted && committedRecord && expectedInventory) {
    const committed = committedRecord;
    expectedInventory.records = expectedInventory.records.map((row) =>
      row.tripId === tripId ? committed : row,
    );
    expectedInventory.generation += 1;
  }
  if (invalidGeneration) throw new OfflineManifestError("unavailable");
  if (conflicted) throw new OfflineManifestError("write_conflict");
  if (persisted) announceManifestChange(tripId, changeReason);
  return persisted;
}

/**
 * Allocate a monotonic, device-local ordering token before starting an
 * authenticated tenant lookup. It carries no tenant identity or authorization;
 * it only prevents an older response (including one returned to another tab or
 * the service worker) from acting after a newer request has begun.
 */
export async function beginOfflineTenantVerificationRound(): Promise<number> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(KEY_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(KEY_STORE);
    let allocatedRound: number | null = null;
    store.get(TENANT_ROUND_KEY).onsuccess = (event) => {
      const previous = (event.target as IDBRequest<unknown>).result;
      const nextRound = nextTenantRound(previous);
      if (nextRound === null) {
        transaction.abort();
        return;
      }
      allocatedRound = nextRound;
      store.put(nextRound, TENANT_ROUND_KEY);
    };
    await done;
    if (allocatedRound === null) throw new Error("IndexedDB tenant round was not allocated");
    return allocatedRound;
  } finally {
    db.close();
  }
}

async function readStoredRecord(db: IDBDatabase, tripId: string): Promise<ManifestVersion> {
  const transaction = db.transaction([KEY_STORE, MANIFEST_STORE], "readonly");
  const done = transactionDone(transaction);
  const record = requestResult(transaction.objectStore(MANIFEST_STORE).get(tripId));
  const generation = requestResult(transaction.objectStore(KEY_STORE).get(generationKey(tripId)));
  const tenantRound = requestResult(transaction.objectStore(KEY_STORE).get(TENANT_ROUND_KEY));
  const [stored, token, round] = await Promise.all([record, generation, tenantRound]);
  await done;
  return {
    record: stored as StoredRecord | undefined,
    generation: storedGeneration(token),
    tenantRound: storedGeneration(round),
  };
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

async function readNotices(db: IDBDatabase): Promise<DiscardedOfflineRecord[]> {
  const transaction = db.transaction(KEY_STORE, "readonly");
  const stored = await requestResult(transaction.objectStore(KEY_STORE).get(DISCARD_NOTICE_KEY));
  await transactionDone(transaction);
  return Array.isArray(stored) ? (stored as DiscardedOfflineRecord[]) : [];
}

/** Delete only the examined record, atomically recording any pending loss. */
async function deleteExpiredRecord(
  db: IDBDatabase,
  tripId: string,
  expected: ManifestVersion,
  envelope: OfflineManifestEnvelope,
  pendingEvents: number,
): Promise<boolean> {
  const trip = envelope.snapshot.manifests[0]?.trip;
  const notice: DiscardedOfflineRecord | null =
    pendingEvents > 0
      ? {
          noticeId: crypto.randomUUID(),
          tripId: trip?.id ?? "",
          tripTitle: trip?.title ?? "",
          shopName: envelope.snapshot.shop.name,
          shopSlug: envelope.snapshot.shop.slug,
          pendingEvents,
          discardedAt: nowDate().toISOString(),
        }
      : null;
  const transaction = db.transaction([KEY_STORE, MANIFEST_STORE], "readwrite");
  const done = transactionDone(transaction);
  const keys = transaction.objectStore(KEY_STORE);
  const manifests = transaction.objectStore(MANIFEST_STORE);
  let recordReady = false,
    generationReady = false,
    noticesReady = !notice;
  let record: StoredRecord | undefined, generation: unknown, notices: unknown;
  let deleted = false;
  const maybeDelete = () => {
    if (!recordReady || !generationReady || !noticesReady) return;
    let token: number;
    try {
      token = storedGeneration(generation);
    } catch {
      transaction.abort();
      return;
    }
    if (token !== expected.generation || !sameStoredRecord(record, expected.record)) return;
    if (notice) {
      if (notices !== undefined && !Array.isArray(notices)) {
        transaction.abort();
        return;
      }
      const previous = Array.isArray(notices) ? (notices as DiscardedOfflineRecord[]) : [];
      keys.put([...previous, notice].slice(-DISCARD_NOTICE_LIMIT), DISCARD_NOTICE_KEY);
    }
    keys.put(token + 1, generationKey(tripId));
    advanceInventoryGeneration(keys);
    manifests.delete(tripId);
    deleted = true;
  };
  manifests.get(tripId).onsuccess = (event) => {
    record = (event.target as IDBRequest<StoredRecord | undefined>).result;
    recordReady = true;
    maybeDelete();
  };
  keys.get(generationKey(tripId)).onsuccess = (event) => {
    generation = (event.target as IDBRequest<unknown>).result;
    generationReady = true;
    maybeDelete();
  };
  if (notice)
    keys.get(DISCARD_NOTICE_KEY).onsuccess = (event) => {
      notices = (event.target as IDBRequest<unknown>).result;
      noticesReady = true;
      maybeDelete();
    };
  await done;
  if (deleted) announceManifestChange(tripId, "delete");
  return deleted;
}

/**
 * Every unsynced roll-call record an earlier shell discarded at its retention
 * ceiling and that has not been acknowledged yet — the offline shell reads this and says
 * so on screen.
 *
 * It is durable rather than a return value from the delete, because the delete
 * frequently happens where there is no screen at all: the service worker's push
 * refresh, or `OfflineManifestAutoSave` inside the staff shop layout, both with
 * the shell closed. A returned value would be dropped by exactly the callers
 * whose loss nobody would otherwise hear about (that is the same shape as the
 * bug commit 194ee22 fixed in the worker — "no screen to say so"). Written once
 * and kept until a human acknowledges it: it carries no personal data, so
 * holding it costs nothing, and a notice that cleared itself on display would be
 * missed by the tablet nobody opened that day.
 */
export async function readDiscardedOfflineRecords(): Promise<DiscardedOfflineRecord[]> {
  const db = await openDatabase();
  try {
    return await readNotices(db);
  } finally {
    db.close();
  }
}

/** Clears the notice above, once a human has actually seen it. */
export async function acknowledgeDiscardedOfflineRecords(
  acknowledged: Array<Pick<DiscardedOfflineRecord, "noticeId">>,
): Promise<void> {
  const db = await openDatabase();
  try {
    const acknowledgedIds = new Set(acknowledged.map(({ noticeId }) => noticeId));
    const transaction = db.transaction(KEY_STORE, "readwrite");
    const done = transactionDone(transaction);
    const notices = transaction.objectStore(KEY_STORE);
    notices.get(DISCARD_NOTICE_KEY).onsuccess = (event) => {
      const stored = (event.target as IDBRequest<unknown>).result;
      if (stored !== undefined && !Array.isArray(stored)) {
        transaction.abort();
        return;
      }
      const remaining = (Array.isArray(stored) ? (stored as DiscardedOfflineRecord[]) : []).filter(
        (notice: DiscardedOfflineRecord) => !acknowledgedIds.has(notice.noticeId),
      );
      if (remaining.length === 0) notices.delete(DISCARD_NOTICE_KEY);
      else notices.put(remaining, DISCARD_NOTICE_KEY);
    };
    await done;
  } finally {
    db.close();
  }
}

/**
 * True once a record is far enough past its own `expiresAt` that the
 * pending-event exception stops permitting ordinary reads — see
 * {@link OFFLINE_MANIFEST_PENDING_GRACE_MS} for the window. Reads the *stored* (plaintext) expiry, the same field
 * `isOfflineManifestExpired` is given here, so the two answers can never be
 * computed from different copies of the same date.
 */
function isPastPendingGrace(
  record: Pick<StoredRecord, "expiresAt">,
  now: Date = nowDate(),
): boolean {
  return new Date(record.expiresAt).getTime() + OFFLINE_MANIFEST_PENDING_GRACE_MS <= now.getTime();
}

async function loadOfflineManifestState(
  tripId: string,
  options: { cleanupExpired?: boolean } = {},
): Promise<{ envelope: OfflineManifestEnvelope | null; version: ManifestVersion }> {
  const db = await openDatabase();
  try {
    const version = await readStoredRecord(db, tripId);
    const record = version.record;
    if (!record) return { envelope: null, version };
    let envelope: OfflineManifestEnvelope;
    {
      const key = await encryptionKey(db);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.iv, additionalData: additionalData(tripId) },
        key,
        record.ciphertext,
      );
      const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      // Decrypting proves the bytes are ours, not that their shape is current:
      // a record written by an older build can drift. Reject it into the same
      // cleanup path as an unreadable one instead of returning a lying cast.
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !Array.isArray((parsed as { snapshot?: { manifests?: unknown } }).snapshot?.manifests)
      ) {
        throw new Error("Stored offline-manifest envelope has an unrecognized shape");
      }
      envelope = parsed as OfflineManifestEnvelope;
      // A record written before a queue existed has no array for it, and the
      // pending counts below (and every reader downstream) would throw reading
      // `.filter` off `undefined` — on the one surface a crew has with no
      // signal, about the copy that holds their unsynced roll call. There is
      // no deploy that reaches a phone in a dry bag on a boat, so the shape a
      // device already wrote is the shape this has to accept.
      envelope.events ??= [];
      envelope.checklistEvents ??= [];
      envelope.arrivalEvents ??= [];
    }
    if (options.cleanupExpired !== false && isOfflineManifestExpired(record)) {
      // A record still holding a roll-call event that never reached the
      // server is the only copy of that evidence — keep serving it (as
      // stale) rather than silently discarding it, until every event is
      // resolved and it can expire for real on the next read.
      //
      // Past the grace period, withhold the roster from unauthenticated reads
      // but do not erase the only copy of unsent evidence. Throwing also
      // prevents a refresh from treating the retained record as an empty slot.
      // A separate authenticated recovery path is still required.
      const pendingEvents = pendingOfflineEventCount(envelope);
      if (pendingEvents > 0 && isPastPendingGrace(record))
        throw new OfflineManifestError("unavailable");
      if (pendingEvents === 0) {
        if (!(await deleteExpiredRecord(db, tripId, version, envelope, pendingEvents)))
          throw new OfflineManifestError("unavailable");
        return {
          envelope: null,
          version: {
            generation: version.generation + 1,
            tenantRound: version.tenantRound,
            record: undefined,
          },
        };
      }
    }
    loadedManifestVersions.set(envelope, version);
    return { envelope, version };
  } finally {
    db.close();
  }
}

export async function loadOfflineManifest(tripId: string): Promise<OfflineManifestEnvelope | null> {
  return (await loadOfflineManifestState(tripId)).envelope;
}

/**
 * Every saved trip on this device, for the offline shell's list view (see
 * ADR 20260726-shopwide-offline-manifest-priming). Reuses loadOfflineManifest
 * per trip rather than a bespoke bulk-decrypt path so the same expiry/
 * pending-event rules (keep an expired record alive only while it still
 * holds an unsynced roll-call event, and only until
 * OFFLINE_MANIFEST_PENDING_GRACE_MS past its expiry) apply exactly once, in
 * one place, instead of being re-implemented here and risking drift. It also
 * reports a past-grace pending record as unavailable without deleting it.
 *
 * Ordered upcoming-or-active trips first (soonest departure on top — "the
 * next boat leaving"), then past trips still within their post-trip
 * retention window behind them: a plain ascending sort by start time alone
 * would put an old, already-departed trip ahead of tomorrow's departure
 * once the board has run for more than a few days, which is the opposite of
 * what this list is for.
 */
async function readOfflineManifestInventoryOnce(): Promise<{
  manifests: OfflineManifestEnvelope[];
  incomplete: boolean;
  changed: boolean;
  preservedOnly: boolean;
  generation: number;
  fence: InventoryFence | null;
}> {
  const db = await openDatabase();
  let tripIds: string[];
  let inventoryGeneration: number;
  let hasPreservations: boolean;
  let records: unknown[];
  let preservationKeys: IDBValidKey[];
  try {
    const transaction = db.transaction([KEY_STORE, MANIFEST_STORE], "readonly");
    const done = transactionDone(transaction);
    const [ids, generation, keyIds, rows] = await Promise.all([
      requestResult(transaction.objectStore(MANIFEST_STORE).getAllKeys()),
      requestResult(transaction.objectStore(KEY_STORE).get(INVENTORY_GENERATION_KEY)),
      requestResult(transaction.objectStore(KEY_STORE).getAllKeys()),
      requestResult(transaction.objectStore(MANIFEST_STORE).getAll()),
    ]);
    tripIds = ids as string[];
    inventoryGeneration = storedGeneration(generation);
    hasPreservations = keyIds.some(isPreservationKey);
    preservationKeys = keyIds.filter(isPreservationKey);
    records = rows;
    await done;
  } finally {
    db.close();
  }
  const reads = await Promise.allSettled(tripIds.map((tripId) => loadOfflineManifest(tripId)));
  const checkDb = await openDatabase();
  let changed: boolean;
  try {
    const transaction = checkDb.transaction([KEY_STORE, MANIFEST_STORE], "readonly");
    const done = transactionDone(transaction);
    const [current, currentRows, currentKeys] = await Promise.all([
      requestResult(transaction.objectStore(KEY_STORE).get(INVENTORY_GENERATION_KEY)),
      requestResult(transaction.objectStore(MANIFEST_STORE).getAll()),
      requestResult(transaction.objectStore(KEY_STORE).getAllKeys()),
    ]);
    await done;
    changed =
      storedGeneration(current) !== inventoryGeneration ||
      !records.every(strictStoredRecoveryRecord) ||
      !sameInventoryRecords(records as StoredRecord[], currentRows) ||
      !samePreservationKeys(preservationKeys, currentKeys);
  } finally {
    checkDb.close();
  }
  const unreadable = reads.some((read) => read.status === "rejected");
  const incomplete = changed || hasPreservations || unreadable;
  const envelopes = reads.flatMap((read) => (read.status === "fulfilled" ? [read.value] : []));
  const now = nowDate();
  const byStartsAt = (a: OfflineManifestEnvelope, b: OfflineManifestEnvelope) =>
    (a.snapshot.manifests[0]?.trip.startsAt ?? "").localeCompare(
      b.snapshot.manifests[0]?.trip.startsAt ?? "",
    );
  const saved = envelopes.filter(
    (envelope): envelope is OfflineManifestEnvelope => envelope !== null,
  );
  const recordsValid = records.every(strictStoredRecoveryRecord);
  const matchingReads =
    recordsValid &&
    saved.length === records.length &&
    saved.every((item) => {
      const version = loadedVersion(item);
      return records.some((row) => sameStoredRecord(row as StoredRecord, version.record));
    });
  const isPast = (envelope: OfflineManifestEnvelope) => {
    const endsAt = envelope.snapshot.manifests[0]?.trip.endsAt;
    return !!endsAt && new Date(endsAt) < now;
  };
  return {
    manifests: [
      ...saved.filter((envelope) => !isPast(envelope)).sort(byStartsAt),
      ...saved.filter(isPast).sort(byStartsAt),
    ],
    incomplete: incomplete || !matchingReads,
    changed,
    preservedOnly: hasPreservations && !changed && !unreadable && matchingReads,
    generation: inventoryGeneration,
    fence: matchingReads
      ? { generation: inventoryGeneration, records: records as StoredRecord[], preservationKeys }
      : null,
  };
}

/** Retry once after a changing read, including expiry cleanup. */
export async function readOfflineManifestInventory(): Promise<{
  manifests: OfflineManifestEnvelope[];
  incomplete: boolean;
  preservedOnly: boolean;
  generation: number;
  fence: InventoryFence | null;
}> {
  const first = await readOfflineManifestInventoryOnce();
  return first.changed ? readOfflineManifestInventoryOnce() : first;
}

/** Callers needing a complete inventory must never mistake an unreadable row for an empty queue. */
export async function listOfflineManifests(): Promise<OfflineManifestEnvelope[]> {
  const inventory = await readOfflineManifestInventory();
  if (inventory.incomplete) throw new OfflineManifestError("unavailable");
  return inventory.manifests;
}

/**
 * Deletes every device record belonging to a shop other than the one the
 * caller is currently signed into. This IndexedDB store has never been
 * shop-scoped — it's keyed purely by tripId, per browser origin, not per
 * shop — so a device shared across shops (a freelance captain, a resold or
 * reassigned boat tablet) could otherwise accumulate another shop's roster
 * indefinitely. Call this with the server-verified shop slug from
 * GET /api/offline-manifests/upcoming or GET /api/offline-manifests/identity
 * (never a client-supplied value, and never one read off a snapshot this
 * device already holds) any time either endpoint is reached, so the moment a
 * different shop's staff authenticates on this device, the previous shop's
 * cached manifests stop being readable — see ADR
 * 20260726-shopwide-offline-manifest-priming.
 *
 * Never deletes a record still holding an unsynced (`pending`) roll-call
 * event: that event cannot be reconciled under a *different* shop's session
 * (the server would look it up against the wrong tenant and reject or
 * misattribute it), so deleting it here would destroy the only copy of that
 * evidence for good. It's left in place — the same least-bad tradeoff
 * `loadOfflineManifest` already makes for the single-shop expiry case,
 * applied here too.
 *
 * After the pending grace period the ordinary read fails closed. The record is
 * retained for a future authenticated recovery path rather than being purged.
 *
 * The pending check and the delete both run under this trip's
 * `withManifestLock`, re-reading the record once the lock is held rather than
 * trusting the snapshot `listOfflineManifests` returned before it — otherwise
 * a concurrent `appendOfflineRollCall` (a second tab still has that foreign
 * shop's offline roll-call view open) could record a new pending event
 * between that read and this delete, and this would erase it anyway despite
 * the filter above having correctly seen "no pending events" a moment
 * earlier. Every other mutator in this module already goes through the same
 * lock for exactly this read-then-write race; this one hadn't.
 */
export async function purgeOfflineManifestsExceptShop(
  currentShopSlug: string,
  tenantRound: number,
  options: { isCurrent?: () => boolean } = {},
): Promise<string[]> {
  // **The guard is here, at the chokepoint, and not at the call sites.**
  //
  // This is the most destructive function in the feature: it deletes every
  // record whose shop does not match, so `""`, `undefined` or `null` makes
  // *every* record a mismatch and wipes the device — the current shop's copies
  // included, on a boat, with no page open to say so. A caller-side check only
  // ever protects the callers that remember to write one, and the two that
  // exist already disagreed about it: `OfflineManifestView` validated the slug
  // was a non-empty string, while `OfflineManifestAutoSave` reached this
  // through `(await response.json()) as OfflineManifestUpcomingResponse` — a
  // cast, not a parse, which happily yields `undefined` for `body.shop.slug`
  // and does not throw on the way past (security review, 2026-08-06). Put the
  // refusal in the one function every path must go through and every present
  // and future caller — a new surface, the service worker, a test — inherits
  // it, with no version of "forgot to guard" that still reaches the delete
  // loop below.
  //
  // The parameter stays typed `string`, so a caller that *knows* it may be
  // holding `undefined` is still a `pnpm typecheck` failure rather than a
  // silent no-op; this is the runtime half, for the values a cast lets past
  // the compiler.
  if (
    typeof currentShopSlug !== "string" ||
    currentShopSlug.length === 0 ||
    !Number.isSafeInteger(tenantRound) ||
    tenantRound < 1
  )
    return [];
  const isCurrent = options.isCurrent;
  if (isCurrent && !isCurrent()) return [];
  const saved = await listOfflineManifests();
  if (isCurrent && !isCurrent()) return [];
  const candidates = saved.filter((envelope) => envelope.snapshot.shop.slug !== currentShopSlug);
  const deletedTripIds = await Promise.all(
    candidates.map((envelope) => {
      const tripId = envelope.snapshot.manifests[0]?.trip.id;
      if (!tripId) return Promise.resolve(null);
      return withManifestLock(tripId, async () => {
        // A later verification round may have started while this candidate
        // waited for the trip lock. Do not let an older tenant answer delete
        // records after the browser has established a newer tenant.
        if (isCurrent && !isCurrent()) return null;
        const current = await loadOfflineManifest(tripId);
        if (!current) return null;
        // Re-evaluate ownership from the locked record, not the pre-lock list.
        if (current.snapshot.shop.slug === currentShopSlug) return null;
        if (pendingOfflineEventCount(current) > 0) return null;
        // loadOfflineManifest can yield to IndexedDB; the verification round
        // may have changed while it was reading. Keep the final guard adjacent
        // to deletion, inside the same per-trip lock.
        if (isCurrent && !isCurrent()) return null;
        const deleted = await deletePurgeCandidate(
          tripId,
          currentShopSlug,
          tenantRound,
          loadedVersion(current),
          isCurrent,
        );
        if (!deleted) return null;
        return tripId;
      });
    }),
  );
  // Report only records this locked pass actually removed; selected-trip UI
  // uses that proof to distinguish a purge from a bookmark never saved here.
  return deletedTripIds.filter((tripId): tripId is string => tripId !== null);
}

/**
 * Compare the exact examined record, generation, and verification round in
 * the delete transaction. An older shell may write without the Web Lock;
 * plaintext pending metadata alone cannot prove its replacement is safe.
 */
async function deletePurgeCandidate(
  tripId: string,
  currentShopSlug: string,
  tenantRound: number,
  expected: ManifestVersion,
  isCurrent?: () => boolean,
): Promise<boolean> {
  if (isCurrent && !isCurrent()) return false;
  const db = await openDatabase();
  try {
    if (isCurrent && !isCurrent()) return false;
    const transaction = db.transaction([KEY_STORE, MANIFEST_STORE], "readwrite");
    const done = transactionDone(transaction);
    const keyStore = transaction.objectStore(KEY_STORE);
    const manifestStore = transaction.objectStore(MANIFEST_STORE);
    let roundReady = false;
    let recordReady = false;
    let generationReady = false;
    let latestRound: unknown;
    let generation: unknown;
    let record: StoredRecord | undefined;
    let deleted = false;
    const maybeDelete = () => {
      if (!roundReady || !recordReady || !generationReady || (isCurrent && !isCurrent())) return;
      if (latestRound !== tenantRound || !record) return;
      if (!strictStoredRecoveryRecord(record) || !strictStoredRecoveryRecord(expected.record))
        return;
      if (typeof record.shopSlug !== "string" || record.shopSlug.length === 0) return;
      if (record.shopSlug === currentShopSlug) return;
      if (
        typeof record.pendingEvents !== "number" ||
        !Number.isSafeInteger(record.pendingEvents) ||
        record.pendingEvents < 0 ||
        record.pendingEvents > 0
      )
        return;
      let token: number;
      try {
        token = storedGeneration(generation);
        if (
          token !== expected.generation ||
          storedGeneration(latestRound) !== expected.tenantRound ||
          !sameStoredRecord(record, expected.record)
        )
          return;
      } catch {
        transaction.abort();
        return;
      }
      manifestStore.delete(tripId);
      keyStore.put(token + 1, generationKey(tripId));
      advanceInventoryGeneration(keyStore);
      deleted = true;
    };
    keyStore.get(TENANT_ROUND_KEY).onsuccess = (event) => {
      latestRound = (event.target as IDBRequest<unknown>).result;
      roundReady = true;
      maybeDelete();
    };
    manifestStore.get(tripId).onsuccess = (event) => {
      record = (event.target as IDBRequest<StoredRecord | undefined>).result;
      recordReady = true;
      maybeDelete();
    };
    keyStore.get(generationKey(tripId)).onsuccess = (event) => {
      generation = (event.target as IDBRequest<unknown>).result;
      generationReady = true;
      maybeDelete();
    };
    await done;
    if (deleted) announceManifestChange(tripId, "delete");
    return deleted;
  } finally {
    db.close();
  }
}

export async function saveOfflineManifest(
  payload: OfflineManifestPayload,
  options: {
    /**
     * False when the server says this viewer may no longer hold the words
     * (`offlineManifestMayHoldMedicalAlertWords`, security review 2, L3): the
     * refresh drops any saved words along with who saved them. The manifest
     * page's own save, whose viewer the page just checked, leaves it true.
     */
    keepMedicalAlertWords?: boolean;
    /** Shared tenant-verification round allocated before the payload request. */
    tenantRound?: number;
    /** Internal sync fence: the posted events must still name this envelope. */
    receiptGuard?: { posted: PostedOfflineEvents; disposed: ReadonlyMap<string, string> };
    /** Guard a preserved-only inventory decision through the replacement transaction. */
    expectedInventory?: InventoryFence;
  } = {},
): Promise<OfflineManifestEnvelope> {
  const keepMedicalAlertWords = options.keepMedicalAlertWords ?? true;
  const trip = payload.manifests[0]?.trip;
  if (!trip || payload.manifests.length === 0) throw new Error("Manifest payload is empty");
  return withManifestLock(trip.id, async () => {
    // An unreadable record may hold the only queued evidence. Never replace
    // it merely because decryption or shape validation failed.
    const state = await loadOfflineManifestState(trip.id);
    const existing = state.envelope;
    if (
      options.receiptGuard &&
      (!existing ||
        !receiptStillNamesCurrentEvents(
          existing,
          options.receiptGuard.posted,
          options.receiptGuard.disposed,
        ))
    )
      throw new OfflineManifestError("sync_unreachable");
    const savedAt = nowDate();
    // Snapshot tokens carry a server-authenticated epoch. This local comparison
    // only removes retained text from this device; every sync writer still
    // verifies the token MAC and compares the epoch server-side before accepting
    // note text. A changed snapshot id at the same epoch is an ordinary refresh
    // and must not erase notes staff added after the last deletion.
    const previousClaims = offlineSnapshotTokenClaims(existing?.snapshot.erasureEpochToken);
    const currentClaims = offlineSnapshotTokenClaims(payload.erasureEpochToken);
    if (
      existing &&
      previousClaims &&
      (!currentClaims ||
        currentClaims.epoch < previousClaims.epoch ||
        (currentClaims.epoch === previousClaims.epoch &&
          currentClaims.revision <= previousClaims.revision))
    ) {
      if (options.expectedInventory !== undefined) throw new OfflineManifestError("write_conflict");
      // An older in-flight render must not replace a post-erasure copy and put
      // erased names back on this device, or mark old facts fresh. A revoked
      // medical-alert grant still takes effect when the roster payload is stale.
      if (keepMedicalAlertWords) return existing;
      const { medicalAlertsSavedBy: _previous, ...withoutSavedBy } = existing;
      const revoked: OfflineManifestEnvelope = {
        ...withoutSavedBy,
        snapshot: {
          ...existing.snapshot,
          manifests: withMedicalAlertWords(existing.snapshot.manifests, {}),
        },
      };
      const db = await openDatabase();
      try {
        const persisted = await persistEnvelope(
          db,
          revoked,
          state.version,
          options.tenantRound,
          "snapshot",
        );
        if (!persisted && options.tenantRound !== undefined)
          throw new OfflineManifestError("shop_changed");
      } finally {
        db.close();
      }
      return revoked;
    }
    const refresh = existing
      ? refreshForSnapshot(existing.snapshot.erasureEpochToken, payload.erasureEpochToken)
      : undefined;
    // **The medical alerts' words** (H-20261023-medical-alert-for-the amendment). A payload from the
    // server never carries them, and any it did carry are dropped here. Words
    // an explicit save already put on this copy stay through the background
    // refreshes that follow, for every diver the fresh board still flags, so
    // the divemaster's tap at the dock survives the five-minute refresh,
    // unless the server says this viewer may no longer hold them
    // (`keepMedicalAlertWords`). Signing out or another person signing in
    // removes them too (`wipeOfflineMedicalAlerts`).
    const kept =
      keepMedicalAlertWords && existing?.medicalAlertsSavedBy
        ? medicalAlertWordsOf(existing.snapshot.manifests)
        : {};
    const manifests = withMedicalAlertWords(payload.manifests, kept);
    const carriesWords = Object.keys(medicalAlertWordsOf(manifests)).length > 0;
    const envelope: OfflineManifestEnvelope = {
      ...(existing?.selectedRollCallMeetingDay !== undefined
        ? { selectedRollCallMeetingDay: existing.selectedRollCallMeetingDay }
        : {}),
      snapshot: {
        ...payload,
        manifests,
        version: OFFLINE_MANIFEST_RECORD_VERSION,
        snapshotId: payload.snapshotId ?? crypto.randomUUID(),
        savedAt: savedAt.toISOString(),
        expiresAt: offlineManifestExpiresAt(savedAt, new Date(trip.endsAt)).toISOString(),
      },
      // A newer epoch clears only the erased person's own roll-call notes; a
      // checklist note is nobody's own data and stays (issue #3569).
      events:
        refresh === "unverified"
          ? clearSavedNotes(
              existing?.events ?? [],
              "discarded_unverified_snapshot",
              (event) => event.syncStatus !== "pending",
            )
          : refresh === "erasure"
            ? clearSavedNotes(
                existing?.events ?? [],
                "discarded_erasure_cutoff",
                erasedSubjectNote(payload, trip.id),
              )
            : (existing?.events ?? []),
      checklistEvents:
        refresh === "unverified"
          ? clearSavedNotes(
              existing?.checklistEvents ?? [],
              "discarded_unverified_snapshot",
              (event) => event.syncStatus !== "pending",
            )
          : (existing?.checklistEvents ?? []),
      arrivalEvents: existing?.arrivalEvents ?? [],
      ...(carriesWords && existing?.medicalAlertsSavedBy
        ? { medicalAlertsSavedBy: existing.medicalAlertsSavedBy }
        : {}),
    };
    const db = await openDatabase();
    try {
      const persisted = await persistEnvelope(
        db,
        envelope,
        state.version,
        options.tenantRound,
        "snapshot",
        options.expectedInventory,
      );
      if (!persisted && options.tenantRound !== undefined)
        throw new OfflineManifestError("shop_changed");
    } finally {
      db.close();
    }
    return envelope;
  });
}

/**
 * **Puts the medical alerts' words on this device's copy of one departure**
 * (H-20261023-medical-alert-for-the amendment), after a permitted reader tapped save-for-offline and
 * `POST /api/offline-manifests/[tripId]/medical-alerts` recorded the save on
 * each diver's trail. Only divers the copy already flags take words, and the
 * copy records who saved them. Null when there is no copy to put them on.
 */
export async function saveOfflineMedicalAlerts(
  tripId: string,
  texts: Readonly<Record<string, string>>,
  savedBy: OfflineMedicalAlertsSavedBy,
  tenantRound?: number,
): Promise<OfflineManifestEnvelope | null> {
  return withManifestLock(tripId, async () => {
    const existing = await loadOfflineManifest(tripId);
    if (!existing) return null;
    const manifests = withMedicalAlertWords(existing.snapshot.manifests, texts);
    const carriesWords = Object.keys(medicalAlertWordsOf(manifests)).length > 0;
    const { medicalAlertsSavedBy: _previous, ...rest } = existing;
    const envelope: OfflineManifestEnvelope = {
      ...rest,
      snapshot: { ...existing.snapshot, manifests },
      ...(carriesWords ? { medicalAlertsSavedBy: savedBy } : {}),
    };
    const db = await openDatabase();
    try {
      const persisted = await persistEnvelope(
        db,
        envelope,
        loadedVersion(existing),
        tenantRound,
        "medical-alerts",
      );
      if (!persisted && tenantRound !== undefined) throw new OfflineManifestError("shop_changed");
    } finally {
      db.close();
    }
    return envelope;
  });
}

type PreservedOfflineRecord = {
  record: StoredRecord;
  observedKey: CryptoKey | null;
  aad: ArrayBuffer;
  keyId: string;
  revision: number;
};

function strictStoredRecoveryRecord(value: unknown): value is StoredRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as StoredRecord;
  const allowed = new Set(["tripId", "expiresAt", "shopSlug", "pendingEvents", "iv", "ciphertext"]);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    typeof row.tripId === "string" &&
    typeof row.expiresAt === "string" &&
    (row.shopSlug === undefined || typeof row.shopSlug === "string") &&
    (row.pendingEvents === undefined ||
      (Number.isSafeInteger(row.pendingEvents) && row.pendingEvents >= 0)) &&
    Object.prototype.toString.call(row.iv) === "[object ArrayBuffer]" &&
    Object.prototype.toString.call(row.ciphertext) === "[object ArrayBuffer]"
  );
}

function strictPreservedRecoveryRecord(
  value: unknown,
): value is PreservedOfflineRecord & { version: number; observedKey: CryptoKey } {
  if (!value || typeof value !== "object") return false;
  const archive = value as PreservedOfflineRecord & { version?: number };
  const allowed = new Set(["record", "observedKey", "aad", "version", "keyId", "revision"]);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    archive.version === OFFLINE_MANIFEST_RECORD_VERSION &&
    typeof archive.keyId === "string" &&
    archive.keyId.length > 0 &&
    Number.isSafeInteger(archive.revision) &&
    archive.revision >= 0 &&
    archive.observedKey instanceof CryptoKey &&
    Object.prototype.toString.call(archive.aad) === "[object ArrayBuffer]" &&
    strictStoredRecoveryRecord(archive.record)
  );
}

/** A point-in-time live authorization check; no cached slug authorizes recovery. */
async function recoveryAuthority(): Promise<{
  body: unknown;
  round: number;
  deadline: number;
} | null> {
  if (!navigator.onLine) return null;
  const round = await beginOfflineTenantVerificationRound();
  const deadline = performance.now() + 10_000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = (async () => {
    const response = await fetch("/api/offline-manifests/upcoming", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: ROLL_CALL_CAUSAL_HEADERS,
    });
    if (!response.ok || response.redirected) return null;
    return response.json() as Promise<unknown>;
  })();
  try {
    const body = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("recovery authorization timeout"));
        }, 10_000);
      }),
    ]);
    return performance.now() < deadline &&
      offlineManifestShopSlug(body) &&
      offlineManifestViewerPersonId(body)
      ? { body, round, deadline }
      : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    request.catch(() => undefined);
  }
}

/** Retire only an authenticated, byte-identical copy; no event is merged or settled. */
export async function recoverExactPreservedDuplicates(): Promise<number> {
  // Disabled until the version-3 shell and rollback cutover is verified.
  if (DB_VERSION < 3) return 0;
  const db = await openDatabase();
  try {
    const index = db.transaction(KEY_STORE, "readonly");
    const indexDone = transactionDone(index);
    const ids = (await requestResult(index.objectStore(KEY_STORE).getAllKeys())).filter(
      isPreservationKey,
    );
    await indexDone;
    if (!ids.length) return 0;
    const authority = await recoveryAuthority();
    if (!authority) return 0;
    const shop = offlineManifestShopSlug(authority.body);
    if (!shop) return 0;
    let recovered = 0;
    for (const id of ids) {
      try {
        if (
          await recoverExactPreservedDuplicate(
            db,
            id,
            shop,
            authority.body,
            authority.round,
            authority.deadline,
          )
        )
          recovered += 1;
      } catch {
        // A malformed, changed, or inaccessible copy remains preserved.
      }
    }
    return recovered;
  } finally {
    db.close();
  }
}

async function recoverExactPreservedDuplicate(
  db: IDBDatabase,
  id: IDBValidKey,
  shop: string,
  body: unknown,
  round: number,
  deadline: number,
): Promise<boolean> {
  await encryptionKey(db);
  const read = db.transaction(KEY_STORE, "readonly");
  const readDone = transactionDone(read);
  const keys = read.objectStore(KEY_STORE);
  const [value, activeKey, savedRound, keyIdentity] = await Promise.all([
    requestResult(keys.get(id)),
    requestResult(keys.get(KEY_ID)),
    requestResult(keys.get(TENANT_ROUND_KEY)),
    requestResult(keys.get(KEY_EPOCH_KEY)),
  ]);
  await readDone;
  if (
    !strictPreservedRecoveryRecord(value) ||
    !(activeKey instanceof CryptoKey) ||
    typeof keyIdentity !== "string" ||
    !keyIdentity ||
    storedGeneration(savedRound) !== round
  )
    return false;
  const archive = value;
  const tripId = archive.record.tripId;
  if (
    !offlineManifestPayloads(body).some(
      (item) =>
        item?.shop?.slug === shop &&
        Array.isArray(item.manifests) &&
        item.manifests.some((manifest) => manifest?.trip?.id === tripId),
    )
  )
    return false;
  if (!sameBytes(archive.aad, additionalData(tripId)) || isOfflineManifestExpired(archive.record))
    return false;
  const active = await readStoredRecord(db, tripId);
  if (
    active.tenantRound !== round ||
    !strictStoredRecoveryRecord(active.record) ||
    !sameStoredRecord(active.record, archive.record)
  )
    return false;
  const [archivedPlaintext, activePlaintext] = await Promise.all([
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: archive.record.iv, additionalData: archive.aad },
      archive.observedKey,
      archive.record.ciphertext,
    ),
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: active.record.iv, additionalData: additionalData(tripId) },
      activeKey,
      active.record.ciphertext,
    ),
  ]);
  if (!sameBytes(archivedPlaintext, activePlaintext)) return false;
  const envelope: unknown = JSON.parse(new TextDecoder().decode(activePlaintext));
  const { validRecoveryEnvelope } = await import("./offline-recovery-envelope");
  if (!validRecoveryEnvelope(envelope, shop, tripId)) return false;
  const copy = envelope as OfflineManifestEnvelope;
  if (
    copy.snapshot.expiresAt !== active.record.expiresAt ||
    (active.record.shopSlug !== undefined && active.record.shopSlug !== shop) ||
    (active.record.pendingEvents !== undefined &&
      active.record.pendingEvents !== pendingOfflineEventCount(copy))
  )
    return false;
  return deleteExactPreservedDuplicate(db, id, archive, active, round, keyIdentity, deadline);
}

async function deleteExactPreservedDuplicate(
  db: IDBDatabase,
  id: IDBValidKey,
  archive: PreservedOfflineRecord,
  active: ManifestVersion,
  round: number,
  keyIdentity: string,
  deadline: number,
): Promise<boolean> {
  const tx = db.transaction([KEY_STORE, MANIFEST_STORE], "readwrite");
  const done = transactionDone(tx);
  const keys = tx.objectStore(KEY_STORE);
  let latestArchive: PreservedOfflineRecord | undefined;
  let latestRecord: StoredRecord | undefined;
  let latestGeneration: unknown;
  let latestRound: unknown;
  let currentKey: unknown;
  let currentKeyIdentity: unknown;
  let ready = 0;
  let deleted = false;
  const commit = () => {
    if (++ready !== 6) return;
    try {
      if (
        performance.now() >= deadline ||
        !strictPreservedRecoveryRecord(latestArchive) ||
        !(currentKey instanceof CryptoKey) ||
        currentKeyIdentity !== keyIdentity ||
        storedGeneration(latestRound) !== round ||
        storedGeneration(latestGeneration) !== active.generation ||
        !strictStoredRecoveryRecord(latestRecord) ||
        isOfflineManifestExpired(latestRecord) ||
        !sameStoredRecord(latestRecord, active.record) ||
        !strictStoredRecoveryRecord(latestArchive.record) ||
        !sameStoredRecord(latestArchive.record, archive.record) ||
        latestArchive.keyId !== archive.keyId ||
        latestArchive.revision !== archive.revision ||
        !sameBytes(latestArchive.aad, archive.aad)
      )
        return;
      keys.delete(id);
      advanceInventoryGeneration(keys);
      deleted = true;
    } catch {
      tx.abort();
    }
  };
  keys.get(id).onsuccess = (event) => {
    latestArchive = (event.target as IDBRequest<PreservedOfflineRecord | undefined>).result;
    commit();
  };
  tx.objectStore(MANIFEST_STORE).get(archive.record.tripId).onsuccess = (event) => {
    latestRecord = (event.target as IDBRequest<StoredRecord | undefined>).result;
    commit();
  };
  keys.get(generationKey(archive.record.tripId)).onsuccess = (event) => {
    latestGeneration = (event.target as IDBRequest<unknown>).result;
    commit();
  };
  keys.get(TENANT_ROUND_KEY).onsuccess = (event) => {
    latestRound = (event.target as IDBRequest<unknown>).result;
    commit();
  };
  keys.get(KEY_ID).onsuccess = (event) => {
    currentKey = (event.target as IDBRequest<unknown>).result;
    commit();
  };
  keys.get(KEY_EPOCH_KEY).onsuccess = (event) => {
    currentKeyIdentity = (event.target as IDBRequest<unknown>).result;
    commit();
  };
  await done;
  if (deleted) announceManifestChange(archive.record.tripId, "unknown");
  return deleted;
}

/** Bind an old-format candidate to an identity before any read-modify-write. */
async function identifyLegacyPreservedRecord(
  db: IDBDatabase,
  id: IDBValidKey,
  expectedRound: number,
): Promise<PreservedOfflineRecord | undefined> {
  const transaction = db.transaction(KEY_STORE, "readwrite");
  const done = transactionDone(transaction);
  const keys = transaction.objectStore(KEY_STORE);
  let current: PreservedOfflineRecord | undefined;
  let round: unknown;
  let ready = 0;
  let identified: PreservedOfflineRecord | undefined;
  const commit = () => {
    if (++ready !== 2) return;
    try {
      if (!current || storedGeneration(round) !== expectedRound) return;
      if (
        typeof current.keyId === "string" &&
        current.keyId &&
        Number.isSafeInteger(current.revision) &&
        current.revision >= 0
      ) {
        identified = current;
        return;
      }
      if (current.keyId !== undefined || current.revision !== undefined) return;
      identified = { ...current, keyId: crypto.randomUUID(), revision: 0 };
      keys.put(identified, id);
      advanceInventoryGeneration(keys);
    } catch {
      transaction.abort();
    }
  };
  keys.get(id).onsuccess = (event) => {
    current = (event.target as IDBRequest<PreservedOfflineRecord | undefined>).result;
    commit();
  };
  keys.get(TENANT_ROUND_KEY).onsuccess = (event) => {
    round = (event.target as IDBRequest<unknown>).result;
    commit();
  };
  await done;
  return identified;
}

/** Redact readable preserved copies without deleting or acknowledging their queues. */
async function wipePreservedMedicalAlerts(
  keepSavedBy?: string,
  tenantRound?: number,
): Promise<void> {
  const db = await openDatabase();
  try {
    const initial = db.transaction(KEY_STORE, "readonly");
    const initialDone = transactionDone(initial);
    const ids = await requestResult(initial.objectStore(KEY_STORE).getAllKeys());
    await initialDone;
    entry: for (const id of ids.filter(isPreservationKey)) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const read = db.transaction(KEY_STORE, "readonly");
        const readDone = transactionDone(read);
        const store = read.objectStore(KEY_STORE);
        const [candidate, capturedRound] = await Promise.all([
          requestResult(store.get(id)),
          requestResult(store.get(TENANT_ROUND_KEY)),
        ]);
        await readDone;
        let archive = candidate as PreservedOfflineRecord | undefined;
        const round = storedGeneration(capturedRound);
        if (tenantRound !== undefined && tenantRound !== round) continue entry;
        if (archive && archive.keyId === undefined && archive.revision === undefined)
          archive = await identifyLegacyPreservedRecord(db, id, round);
        const isBuffer = (value: unknown) =>
          Object.prototype.toString.call(value) === "[object ArrayBuffer]";
        if (
          !archive ||
          typeof archive.keyId !== "string" ||
          !archive.keyId ||
          !Number.isSafeInteger(archive.revision) ||
          archive.revision < 0 ||
          !(archive.observedKey instanceof CryptoKey) ||
          !isBuffer(archive.aad) ||
          !archive.record ||
          !isBuffer(archive.record.iv) ||
          !isBuffer(archive.record.ciphertext)
        )
          continue entry;
        let envelope: OfflineManifestEnvelope;
        try {
          const plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: archive.record.iv, additionalData: archive.aad },
            archive.observedKey,
            archive.record.ciphertext,
          );
          envelope = JSON.parse(new TextDecoder().decode(plaintext)) as OfflineManifestEnvelope;
          if (!Array.isArray(envelope?.snapshot?.manifests)) continue entry;
        } catch {
          // An unknown copy stays intact and keeps the inventory incomplete.
          continue entry;
        }
        if (keepSavedBy && envelope.medicalAlertsSavedBy?.personId === keepSavedBy) continue entry;
        if (
          !envelope.medicalAlertsSavedBy &&
          Object.keys(medicalAlertWordsOf(envelope.snapshot.manifests)).length === 0
        )
          continue entry;
        const { medicalAlertsSavedBy: _savedBy, ...rest } = envelope;
        const redacted = {
          ...rest,
          snapshot: {
            ...envelope.snapshot,
            manifests: withMedicalAlertWords(envelope.snapshot.manifests, {}),
          },
        };
        const iv = crypto.getRandomValues(new Uint8Array(12)).buffer as ArrayBuffer;
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: archive.aad },
          archive.observedKey,
          new TextEncoder().encode(JSON.stringify(redacted)),
        );
        const write = db.transaction(KEY_STORE, "readwrite");
        const done = transactionDone(write);
        const keys = write.objectStore(KEY_STORE);
        let current: PreservedOfflineRecord | undefined;
        let currentRound: unknown;
        let ready = 0;
        let conflict = false;
        const commit = () => {
          if (++ready !== 2) return;
          try {
            if (!current || storedGeneration(currentRound) !== round) return;
            if (
              current.revision !== archive.revision ||
              current.keyId !== archive.keyId ||
              !sameStoredRecord(current.record, archive.record) ||
              !sameBytes(current.aad, archive.aad)
            ) {
              conflict = true;
              return;
            }
            keys.put(
              {
                ...current,
                record: { ...current.record, iv, ciphertext },
                revision: current.revision + 1,
              },
              id,
            );
            advanceInventoryGeneration(keys);
          } catch {
            write.abort();
          }
        };
        keys.get(id).onsuccess = (event) => {
          current = (event.target as IDBRequest<PreservedOfflineRecord | undefined>).result;
          commit();
        };
        keys.get(TENANT_ROUND_KEY).onsuccess = (event) => {
          currentRound = (event.target as IDBRequest<unknown>).result;
          commit();
        };
        await done;
        if (!conflict) continue entry;
      }
    }
  } finally {
    db.close();
  }
}

/**
 * **Takes the medical alerts' words off every copy on this device** (H-20261023-medical-alert-for-the
 * amendment), keeping the rest of each copy: the roster, the fact of each
 * alert, and every queued roll-call event. Run on sign-out with no argument,
 * and with `keepSavedBy` whenever the server names who is signed in now
 * (`/api/offline-manifests/upcoming`), so a shared tablet never shows one
 * person's saved words to the next.
 */
export async function wipeOfflineMedicalAlerts(
  keepSavedBy?: string,
  tenantRound?: number,
): Promise<void> {
  await wipeMedicalAlerts(keepSavedBy, tenantRound);
}

async function wipeMedicalAlerts(
  keepSavedBy?: string,
  tenantRound?: number,
  allowPreservedFor?: { tripId: string; shopSlug: string },
): Promise<InventoryFence | undefined> {
  // Start both paths independently: a blocked or failed preserved-copy write
  // must not prevent readable manifest copies being wiped on sign-out.
  const preserved = wipePreservedMedicalAlerts(keepSavedBy, tenantRound).then(
    () => null,
    (error: unknown) => error,
  );
  const { manifests: saved, incomplete, preservedOnly } = await readOfflineManifestInventory();
  await Promise.all(
    saved
      .filter(
        (envelope) =>
          envelope.medicalAlertsSavedBy &&
          (!keepSavedBy || envelope.medicalAlertsSavedBy.personId !== keepSavedBy),
      )
      .map((envelope) => {
        const tripId = envelope.snapshot.manifests[0]?.trip.id;
        if (!tripId) return Promise.resolve();
        return withManifestLock(tripId, async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const current = await loadOfflineManifest(tripId);
            if (!current?.medicalAlertsSavedBy) return;
            if (keepSavedBy && current.medicalAlertsSavedBy.personId === keepSavedBy) return;
            const { medicalAlertsSavedBy: _wiped, ...rest } = current;
            const db = await openDatabase();
            try {
              const persisted = await persistEnvelope(
                db,
                {
                  ...rest,
                  snapshot: {
                    ...current.snapshot,
                    manifests: withMedicalAlertWords(current.snapshot.manifests, {}),
                  },
                },
                loadedVersion(current),
                tenantRound,
                "medical-alerts",
              );
              if (!persisted) throw new OfflineManifestError("shop_changed");
              return;
            } catch (error) {
              if (
                !(error instanceof OfflineManifestError) ||
                error.code !== "write_conflict" ||
                attempt === 2
              )
                throw error;
            } finally {
              db.close();
            }
          }
        });
      }),
  );
  if (
    allowPreservedFor &&
    preservedOnly &&
    saved.some(
      (envelope) =>
        envelope.snapshot.shop.slug === allowPreservedFor.shopSlug &&
        envelope.snapshot.manifests[0]?.trip.id === allowPreservedFor.tripId,
    )
  ) {
    const checked = await readOfflineManifestInventory();
    if (
      !checked.preservedOnly ||
      !checked.fence ||
      !checked.manifests.some(
        (envelope) =>
          envelope.snapshot.shop.slug === allowPreservedFor.shopSlug &&
          envelope.snapshot.manifests[0]?.trip.id === allowPreservedFor.tripId,
      ) ||
      checked.manifests.some(
        (envelope) =>
          envelope.medicalAlertsSavedBy &&
          (!keepSavedBy || envelope.medicalAlertsSavedBy.personId !== keepSavedBy),
      )
    )
      throw new OfflineManifestError("unavailable");
    return checked.fence;
  }
  const preservedFailure = await preserved;
  if (preservedFailure) throw preservedFailure;
  if (incomplete) throw new OfflineManifestError("unavailable");
}

export async function deleteOfflineManifest(
  tripId: string,
  existingDb?: IDBDatabase,
  isCurrent?: () => boolean,
): Promise<boolean> {
  if (isCurrent && !isCurrent()) return false;
  // Plaintext pendingEvents is only a hint. An unreadable ciphertext may
  // contain the sole copy of safety evidence even when that hint says zero.
  let examined: Awaited<ReturnType<typeof loadOfflineManifestState>>;
  try {
    examined = await loadOfflineManifestState(tripId, { cleanupExpired: false });
  } catch {
    return false;
  }
  if (examined.envelope && pendingOfflineEventCount(examined.envelope) > 0) return false;
  const ownsDb = existingDb === undefined;
  const db = existingDb ?? (await openDatabase());
  try {
    // The purge may have waited for openDatabase after its locked record
    // reread. Recheck at the last synchronous point before queuing the delete
    // request so a newer tenant round cannot be crossed by that await.
    if (isCurrent && !isCurrent()) return false;
    const transaction = db.transaction([KEY_STORE, MANIFEST_STORE], "readwrite");
    const manifests = transaction.objectStore(MANIFEST_STORE);
    const keys = transaction.objectStore(KEY_STORE);
    let recordReady = false;
    let generationReady = false;
    let roundReady = false;
    let record: StoredRecord | undefined;
    let generation: unknown;
    let round: unknown;
    let deleted = false;
    const maybeDelete = () => {
      if (!recordReady || !generationReady || !roundReady || (isCurrent && !isCurrent())) return;
      // Missing or invalid metadata cannot establish that no evidence is queued.
      if (record && record.pendingEvents !== 0) return;
      let token: number;
      try {
        token = storedGeneration(generation);
        if (
          token !== examined.version.generation ||
          storedGeneration(round) !== examined.version.tenantRound ||
          !sameStoredRecord(record, examined.version.record)
        )
          return;
      } catch {
        transaction.abort();
        return;
      }
      if (record) manifests.delete(tripId);
      keys.put(token + 1, generationKey(tripId));
      advanceInventoryGeneration(keys);
      deleted = !!record;
    };
    manifests.get(tripId).onsuccess = (event) => {
      record = (event.target as IDBRequest<StoredRecord | undefined>).result;
      recordReady = true;
      maybeDelete();
    };
    keys.get(generationKey(tripId)).onsuccess = (event) => {
      generation = (event.target as IDBRequest<unknown>).result;
      generationReady = true;
      maybeDelete();
    };
    keys.get(TENANT_ROUND_KEY).onsuccess = (event) => {
      round = (event.target as IDBRequest<unknown>).result;
      roundReady = true;
      maybeDelete();
    };
    await transactionDone(transaction);
    if (deleted) announceManifestChange(tripId, "delete");
    return deleted;
  } finally {
    if (ownsDb) db.close();
  }
}

/**
 * Queue one roll-call result on this device — a diver's or a crew member's.
 *
 * The subject comes in as the two optional fields `OfflineRollCallEvent` now
 * carries, and is read exactly once, through `offlineRollCallSubject`. An input
 * naming neither or both is refused as `not_allowed` rather than written: an
 * event nobody can attribute is worse than no event, because it survives in
 * storage, syncs, and is a claim about the one thing this surface exists to
 * record.
 *
 * A `cleared` names the exact statement it withdraws. Its identity and
 * observed basis are captured at tap and preserved while queued; only the
 * server validates the named target in the tenant/subject/checkpoint scope.
 * Receipt order and clocks cannot retarget it to another crew member's fact.

 */
export async function appendOfflineRollCall(
  tripId: string,
  input: Pick<
    OfflineRollCallEvent,
    | "bookingId"
    | "crewPersonId"
    | "checkpoint"
    | "status"
    | "retractsClientEventId"
    | "note"
    | "observedEvidenceIds"
    | "reconcilesEvidence"
    | "meetingDay"
    | "meetingIdentityProof"
  > &
    Partial<Pick<OfflineRollCallEvent, "snapshotId" | "snapshotSavedAt" | "erasureEpochToken">>,
): Promise<OfflineManifestEnvelope> {
  const capturedAt = nowDate().toISOString();
  const eventIdentity = crypto.randomUUID();
  return withManifestLock(tripId, async () => {
    const envelope = await loadOfflineManifest(tripId);
    if (!envelope) throw new OfflineManifestError("unavailable");
    // A snapshot kept alive past its retention window (loadOfflineManifest
    // preserves one that still has an unsynced event) is not a boarding
    // source — the H-20260724-product-now-uses-explicit stop rule treats expired the same as missing. It
    // stays readable so its pending evidence can still reconcile, but
    // records no new roll call.
    if (isOfflineManifestExpired(envelope.snapshot)) {
      throw new OfflineManifestError("expired");
    }
    const subject = offlineRollCallSubject(input);
    if (!subject) throw new OfflineManifestError("not_allowed");
    const allowed =
      subject.kind === "crew"
        ? canRecordOfflineCrewStatus(
            envelope.snapshot,
            subject.crewPersonId,
            input.status,
            input.checkpoint,
          )
        : canRecordOfflineStatus(
            envelope.snapshot,
            subject.bookingId,
            input.status,
            input.checkpoint,
          );
    if (!allowed) {
      throw new OfflineManifestError("not_allowed");
    }
    envelope.events.push({
      ...input,
      clientEventId: eventIdentity,
      snapshotId: input.snapshotId ?? envelope.snapshot.snapshotId,
      snapshotSavedAt: input.snapshotSavedAt ?? envelope.snapshot.savedAt,
      erasureEpochToken: input.snapshotId
        ? input.erasureEpochToken
        : envelope.snapshot.erasureEpochToken,
      tripId,
      occurredAt: capturedAt,
      syncStatus: "pending",
    });
    const db = await openDatabase();
    try {
      await persistEnvelope(db, envelope, loadedVersion(envelope), undefined, "record");
    } finally {
      db.close();
    }
    return envelope;
  });
}

/**
 * Queue one tap against one checklist item — `appendOfflineRollCall`'s
 * sibling, narrowed to the simpler subject `OfflineChecklistEvent` carries
 * (see that type's doc comment for why this is a second array rather than a
 * widened roll-call event).
 */
export async function appendOfflineChecklistCheck(
  tripId: string,
  input: Pick<
    OfflineChecklistEvent,
    "checklistItemId" | "status" | "note" | "retractsClientEventId"
  >,
): Promise<OfflineManifestEnvelope> {
  return withManifestLock(tripId, async () => {
    const envelope = await loadOfflineManifest(tripId);
    if (!envelope) throw new OfflineManifestError("unavailable");
    if (isOfflineManifestExpired(envelope.snapshot)) {
      throw new OfflineManifestError("expired");
    }
    if (!canRecordOfflineChecklistCheck(envelope.snapshot, input.checklistItemId)) {
      throw new OfflineManifestError("not_allowed");
    }
    envelope.checklistEvents.push({
      ...input,
      clientEventId: crypto.randomUUID(),
      snapshotId: envelope.snapshot.snapshotId,
      snapshotSavedAt: envelope.snapshot.savedAt,
      erasureEpochToken: envelope.snapshot.erasureEpochToken,
      tripId,
      occurredAt: nowDate().toISOString(),
      syncStatus: "pending",
    });
    const db = await openDatabase();
    try {
      await persistEnvelope(db, envelope, loadedVersion(envelope), undefined, "record");
    } finally {
      db.close();
    }
    return envelope;
  });
}

/**
 * Queue one tap at the counter on this device — `appendOfflineChecklistCheck`'s
 * sibling, narrowed to a seat (ADR 20260907-the-counter-survives-offline).
 *
 * The same expiry rule the two recorders beside it apply: a copy kept alive
 * past its retention window only because it still holds unsynced evidence is
 * readable so that evidence can reconcile, and records nothing new.
 *
 * `retractsClientEventId` rides along on a `cleared` and names the arrival it
 * takes back. Nothing is validated about it here, for the same reason roll
 * call validates nothing about its own: the only honest check is against the
 * newest statement the *server* holds, and this function runs where there is
 * no server.
 */
export async function appendOfflineArrival(
  tripId: string,
  input: Pick<OfflineArrivalEvent, "bookingId" | "status" | "retractsClientEventId">,
): Promise<OfflineManifestEnvelope> {
  return withManifestLock(tripId, async () => {
    const envelope = await loadOfflineManifest(tripId);
    if (!envelope) throw new OfflineManifestError("unavailable");
    if (isOfflineManifestExpired(envelope.snapshot)) {
      throw new OfflineManifestError("expired");
    }
    if (!canRecordOfflineArrival(envelope.snapshot, input.bookingId, input.status)) {
      throw new OfflineManifestError("not_allowed");
    }
    envelope.arrivalEvents = offlineArrivalEvents(envelope);
    envelope.arrivalEvents.push({
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
      await persistEnvelope(db, envelope, loadedVersion(envelope), undefined, "record");
    } finally {
      db.close();
    }
    return envelope;
  });
}

/**
 * How long one sync waits for the server before it gives up and leaves the
 * events for the next pass. Dock Wi-Fi can show full bars and carry nothing,
 * and on that network a request neither answers nor fails: it waits, and
 * every later reconcile on the page used to wait behind it until a reload.
 * Ten seconds is long enough for a cold database and a full boat's batch.
 */
export const SYNC_TIMEOUT_MS = 10_000;

/** Do not merge a receipt that can name a different or missing queued event. */
function completeOfflineSyncReceipt(
  posted: readonly { clientEventId: string }[],
  body: unknown,
): body is OfflineSyncResponse {
  const ids = posted.map((event) => event.clientEventId.toLowerCase());
  const expected = new Set(ids);
  const original = new Map(
    posted.map((event) => [event.clientEventId.toLowerCase(), event.clientEventId]),
  );
  if (expected.size !== ids.length || !body || typeof body !== "object") return false;
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length !== expected.size) return false;
  const seen = new Set<string>();
  for (const result of results) {
    if (!result || typeof result !== "object" || typeof result.clientEventId !== "string")
      return false;
    const id = result.clientEventId.toLowerCase();
    if (
      !expected.has(id) ||
      original.get(id) !== result.clientEventId ||
      seen.has(id) ||
      !["applied", "duplicate", "rejected", "unresolved"].includes(result.status)
    )
      return false;
    if (
      result.status === "unresolved" &&
      ![
        "booking_unavailable",
        "meeting_identity_unverified",
        "unresolved_predecessor",
        "client_event_conflict",
      ].includes(result.reason)
    )
      return false;
    if (
      result.noteDisposition !== undefined &&
      !["discarded_erasure_cutoff", "discarded_unverified_snapshot"].includes(
        result.noteDisposition,
      )
    )
      return false;
    seen.add(id);
  }
  return true;
}

/**
 * The one round trip, under a deadline that covers the reply's body as well
 * as its headers. Every way it can fail — no answer, an error status, a body
 * that stops halfway, a body that is not JSON — is the same
 * `sync_unreachable`, and every one of them leaves the device's events
 * exactly as they were: still `pending`, same `clientEventId`.
 *
 * Giving up does not mean the server never got it. A request abandoned here
 * may still have landed, or still be running, which is safe only because the
 * next pass resends the same ids and the server dedupes on
 * `(shop_id, client_event_id)` (the unique indexes in
 * `src/db/schema/dive-day.ts`): each writer asks again under its lock, so a
 * resend that overlaps the abandoned request is answered as a duplicate
 * instead of a second row, a 500, or a refusal (`roll-call.postgres.test.ts`).
 */
async function postPendingEvents(batch: {
  /** Client's server-verified tenant at sync start; comparison only, never authority. */
  expectedShopSlug?: string;
  events: OfflineRollCallEvent[];
  checklistEvents: OfflineChecklistEvent[];
  arrivalEvents: OfflineArrivalEvent[];
  refusedEvidenceIds: string[];
  refreshTripId: string;
}): Promise<OfflineSyncResponse> {
  const posted = [...batch.events, ...batch.checklistEvents, ...batch.arrivalEvents];
  if (new Set(posted.map((event) => event.clientEventId.toLowerCase())).size !== posted.length)
    throw new OfflineManifestError("sync_unreachable");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OfflineManifestError("sync_unreachable"));
    }, SYNC_TIMEOUT_MS);
  });
  const roundTrip = (async () => {
    const response = await fetch("/api/offline-manifests/sync", {
      method: "POST",
      headers: {
        ...ROLL_CALL_CAUSAL_HEADERS,
        [OFFLINE_UNRESOLVED_HEADER]: OFFLINE_UNRESOLVED_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...batch, includeStoredInstants: true, includeCausalSnapshots: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === "shop_changed") throw new OfflineManifestError("shop_changed");
      }
      throw new OfflineManifestError("sync_unreachable");
    }
    const body: unknown = await response.json();
    if (!completeOfflineSyncReceipt(posted, body))
      throw new OfflineManifestError("sync_unreachable");
    const rollIds = new Set(batch.events.map((event) => event.clientEventId));
    const arrivalIds = new Set(batch.arrivalEvents.map((event) => event.clientEventId));
    if (
      body.results.some(
        (result) =>
          (result.status === "unresolved" && !rollIds.has(result.clientEventId)) ||
          (result.noteDisposition && arrivalIds.has(result.clientEventId)),
      )
    )
      throw new OfflineManifestError("sync_unreachable");
    return body;
  })();
  try {
    // Raced as well as aborted: a fetch (or a body stream) that ignores its
    // signal still cannot hold this past the deadline.
    return await Promise.race([roundTrip, deadline]);
  } catch (error) {
    if (error instanceof OfflineManifestError && error.code === "shop_changed") throw error;
    throw new OfflineManifestError("sync_unreachable");
  } finally {
    clearTimeout(timer);
    roundTrip.catch(() => undefined);
  }
}

/** Privacy disposal is independent of accepting a new causal snapshot. */
async function persistSyncReceiptWarnings(
  tripId: string,
  shopSlug: string,
  tenantRound: number,
  posted: PostedOfflineEvents,
  results: OfflineSyncResult[],
) {
  const postedIds = new Set(
    [...posted.events, ...posted.checklistEvents, ...posted.arrivalEvents].map(
      (event) => event.clientEventId,
    ),
  );
  const discarded = new Map(
    results
      .filter(
        (result) =>
          postedIds.has(result.clientEventId) &&
          (result.noteDisposition === "discarded_erasure_cutoff" ||
            (result.status !== "unresolved" &&
              result.noteDisposition === "discarded_unverified_snapshot")),
      )
      .map((result) => [result.clientEventId, result.noteDisposition]),
  );
  const unresolved = new Map(
    results
      .filter(
        (result) =>
          postedIds.has(result.clientEventId) &&
          result.status === "unresolved" &&
          (result.reason === "booking_unavailable" ||
            result.reason === "meeting_identity_unverified" ||
            result.reason === "unresolved_predecessor" ||
            result.reason === "client_event_conflict"),
      )
      .map((result) => [result.clientEventId, result.reason]),
  );
  if (!discarded.size && !unresolved.size) return;
  await withManifestLock(tripId, async () => {
    const current = await loadOfflineManifest(tripId);
    if (!current || current.snapshot.shop.slug !== shopSlug) return;
    if (!receiptStillNamesCurrentEvents(current, posted))
      throw new OfflineManifestError("sync_unreachable");
    const clear = <T extends OfflineRollCallEvent | OfflineChecklistEvent>(event: T): T => {
      const disposition = discarded.get(event.clientEventId);
      return disposition ? { ...event, note: null, noteDisposition: disposition } : event;
    };
    current.events = current.events.map((event) => {
      const cleared = clear(event);
      const reason = unresolved.get(event.clientEventId);
      return reason && event.syncStatus === "pending"
        ? { ...cleared, unresolvedReason: reason }
        : cleared;
    });
    current.checklistEvents = current.checklistEvents.map(clear);
    const db = await openDatabase();
    try {
      if (!(await persistEnvelope(db, current, loadedVersion(current), tenantRound, "sync")))
        throw new OfflineManifestError("shop_changed");
    } finally {
      db.close();
    }
  });
}

export async function syncOfflineManifest(
  tripId: string,
  expectedShopSlug?: string,
  requestTenantRound?: number,
  options: { refreshWhenQuiet?: boolean } = {},
): Promise<OfflineManifestEnvelope | null> {
  const envelope = await loadOfflineManifest(tripId);
  if (!envelope) return null;
  const pending = envelope.events.filter((event) => event.syncStatus === "pending");
  const pendingChecklist = envelope.checklistEvents.filter(
    (event) => event.syncStatus === "pending",
  );
  const pendingArrivals = offlineArrivalEvents(envelope).filter(
    (event) => event.syncStatus === "pending",
  );
  const refused = new Set(
    envelope.events
      .filter((event) => event.syncStatus === "rejected")
      .map((event) => clientRollCallEvidenceId(event.clientEventId)),
  );
  const refusedEvidenceIds = [
    ...new Set(
      pending
        .flatMap((event) => [
          ...(event.observedEvidenceIds ?? []),
          ...(event.retractsClientEventId
            ? [clientRollCallEvidenceId(event.retractsClientEventId)]
            : []),
        ])
        .filter((id) => refused.has(id)),
    ),
  ];
  if ((!options.refreshWhenQuiet && pendingOfflineEventCount(envelope) === 0) || !navigator.onLine)
    return envelope;
  const tenantRound = requestTenantRound ?? (await beginOfflineTenantVerificationRound());
  const posted = {
    events: pending,
    checklistEvents: pendingChecklist,
    arrivalEvents: pendingArrivals,
  };
  const body = await postPendingEvents({
    ...(expectedShopSlug ? { expectedShopSlug } : {}),
    events: pending,
    checklistEvents: pendingChecklist,
    arrivalEvents: pendingArrivals,
    refusedEvidenceIds,
    refreshTripId: tripId,
  });
  await persistSyncReceiptWarnings(
    tripId,
    envelope.snapshot.shop.slug,
    tenantRound,
    posted,
    body.results,
  );
  const refreshed = body.refreshedManifests;
  const payload = offlineManifestPayloads(refreshed).find(
    (item) => item.manifests[0]?.trip.id === tripId,
  );
  if (!refreshed || !payload) throw new OfflineManifestError("sync_unreachable");
  if (
    offlineManifestShopSlug(refreshed) !== envelope.snapshot.shop.slug ||
    payload.shop?.slug !== envelope.snapshot.shop.slug
  )
    throw new OfflineManifestError("shop_changed");
  if (!payload.snapshotId || !payload.manifests.every((item) => item.trip.id === tripId))
    throw new OfflineManifestError("sync_unreachable");
  const beforeClaims = offlineSnapshotTokenClaims(envelope.snapshot.erasureEpochToken);
  const receivedClaims = offlineSnapshotTokenClaims(payload.erasureEpochToken);
  if (
    !receivedClaims ||
    (beforeClaims &&
      (receivedClaims.epoch < beforeClaims.epoch ||
        (receivedClaims.epoch === beforeClaims.epoch &&
          receivedClaims.revision <= beforeClaims.revision)))
  ) {
    throw new OfflineManifestError("sync_unreachable");
  }
  // Never settle success against an old frontier. Saving uses the existing
  // locked merge and erasure/medical-viewer gates, preserving concurrent taps.
  const inventoryFence = await wipeMedicalAlerts(
    offlineManifestViewerPersonId(refreshed) ?? undefined,
    tenantRound,
    { tripId, shopSlug: envelope.snapshot.shop.slug },
  );
  const disposed = new Map(
    body.results
      .filter(
        (result) =>
          result.noteDisposition === "discarded_erasure_cutoff" ||
          (result.status !== "unresolved" && result.noteDisposition),
      )
      .map((result) => [result.clientEventId, result.noteDisposition as string]),
  );
  await saveOfflineManifest(payload, {
    keepMedicalAlertWords: offlineManifestMayHoldMedicalAlertWords(refreshed, tripId),
    tenantRound,
    receiptGuard: { posted, disposed },
    expectedInventory: inventoryFence,
  });
  // The receipt is one-to-one with the posted events; check that the current
  // envelope still contains those same events before applying this map.
  const byId = new Map(body.results.map((result) => [result.clientEventId, result]));
  // Re-read and merge under the lock instead of writing back the envelope
  // read before the network round-trip: a concurrent appendOfflineRollCall
  // (this tab or another) could have recorded a new pending event while the
  // request was in flight, and writing the pre-fetch snapshot would discard it.
  return withManifestLock(tripId, async () => {
    const current = await loadOfflineManifest(tripId);
    if (!current) return null;
    if (!receiptStillNamesCurrentEvents(current, posted, disposed))
      throw new OfflineManifestError("sync_unreachable");
    const revision = body.snapshotRevisions?.[tripId];
    const syncedAtRevision =
      typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
        ? revision
        : undefined;
    const applyResult = <T extends { clientEventId: string; syncedAtRevision?: number }>(
      event: T,
    ) => {
      const result = byId.get(event.clientEventId);
      if (!result) return event;
      if (result.status === "unresolved") return { ...event, unresolvedReason: result.reason };
      return {
        ...event,
        unresolvedReason: undefined,
        ...(result.noteDisposition ? { note: null } : {}),
        syncStatus: result.status === "rejected" ? "rejected" : "applied",
        rejectionReason: result.reason,
        ...(result.status !== "rejected" && result.storedOccurredAt
          ? { storedOccurredAt: result.storedOccurredAt }
          : {}),
        // The revision DiveDay held this event by (`offlineEventInCopy`). A
        // replayed answer keeps the first one, which was already true.
        ...(result.status !== "rejected" && syncedAtRevision !== undefined
          ? { syncedAtRevision: event.syncedAtRevision ?? syncedAtRevision }
          : {}),
        ...(result.noteDisposition ? { noteDisposition: result.noteDisposition } : {}),
      };
    };
    current.events = current.events.map(applyResult);
    current.checklistEvents = current.checklistEvents.map(applyResult);
    current.arrivalEvents = offlineArrivalEvents(current).map(applyResult);
    const db = await openDatabase();
    try {
      const persisted = await persistEnvelope(
        db,
        current,
        loadedVersion(current),
        tenantRound,
        "sync",
        inventoryFence,
      );
      if (!persisted) throw new OfflineManifestError("shop_changed");
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

const SHELL_VERSION_ACK_TIMEOUT_MS = 3_000;

/**
 * Asks the currently active service worker (if any) which shell version it
 * last installed — see `OFFLINE_MANIFEST_SHELL_VERSION` in
 * `offline-manifests.ts` for why this comparison exists. Resolves `null`
 * (not an error) when service workers aren't supported, no worker is active
 * yet, or it doesn't answer in time: those are all "nothing to warn about"
 * for the caller, not evidence of a stale shell.
 */
export async function getActiveOfflineShellVersion(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const active = registration?.active;
  if (!active) return null;
  return new Promise<string | null>((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, SHELL_VERSION_ACK_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(typeof event.data?.version === "string" ? event.data.version : null);
    };
    active.postMessage({ type: "GET_SHELL_VERSION" }, [channel.port2]);
  });
}

/** Keep the crew's explicit meeting-day choice across reloads without recording a mark. */
export async function selectOfflineRollCallDay(
  tripId: string,
  day: number,
): Promise<OfflineManifestEnvelope> {
  return withManifestLock(tripId, async () => {
    const envelope = await loadOfflineManifest(tripId);
    if (!envelope) throw new OfflineManifestError("unavailable");
    const total = envelope.snapshot.rollCallMeetingDays?.length ?? 1;
    if (!Number.isInteger(day) || day < 0 || day >= total)
      throw new OfflineManifestError("not_allowed");
    envelope.selectedRollCallMeetingDay = day;
    const db = await openDatabase();
    try {
      await persistEnvelope(db, envelope, loadedVersion(envelope), undefined, "record");
    } finally {
      db.close();
    }
    return envelope;
  });
}
