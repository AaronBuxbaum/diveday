"use client";
import { nowDate } from "./clock";
import { log } from "./log";
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
  type OfflineMedicalAlertsSavedBy,
  type OfflineRollCallEvent,
  offlineArrivalEvents,
  offlineManifestExpiresAt,
  offlineRollCallSubject,
  pendingOfflineEventCount,
  withMedicalAlertWords,
} from "./offline-manifests";

const DB_NAME = "diveday-offline-manifests";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const MANIFEST_STORE = "manifests";
const KEY_ID = "manifest-aes-gcm-v1";
const TENANT_ROUND_KEY = "tenant-verification-round-v1";
const MANIFEST_CHANGE_EVENT = "diveday-offline-manifest-change";
const MANIFEST_CHANGE_CHANNEL = "diveday-offline-manifest-changes-v1";

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
  source: "same-document" | "broadcast",
) => void;

function validTripChange(value: unknown): value is { tripId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "tripId" in value &&
    typeof value.tripId === "string" &&
    value.tripId.length > 0
  );
}

function announceManifestChange(tripId: string): void {
  const browserWindow = manifestBrowserWindow();
  if (browserWindow) {
    browserWindow.dispatchEvent(new CustomEvent(MANIFEST_CHANGE_EVENT, { detail: { tripId } }));
  }
  // Service workers have no `window`, but they share this origin's
  // BroadcastChannel namespace with open pages. The only payload is the
  // non-sensitive trip key; receivers reload the encrypted record from IDB.
  if (typeof BroadcastChannel !== "undefined") {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(MANIFEST_CHANGE_CHANNEL);
      channel.postMessage({ tripId });
    } catch {
      // IndexedDB remains authoritative; the next focus/visibility reload
      // picks up the mutation when cross-context messaging is unavailable.
    } finally {
      channel?.close();
    }
  }
}

/**
 * Subscribe to committed changes in another tab or in this document. The
 * message contains only the trip key; readers must reload the encrypted record
 * from IndexedDB rather than trusting cross-context payload data.
 */
export function subscribeOfflineManifestChanges(listener: OfflineManifestChangeListener) {
  const browserWindow = manifestBrowserWindow();
  if (!browserWindow) return () => {};
  const onLocalChange = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (validTripChange(detail)) listener(detail.tripId, "same-document");
  };
  browserWindow.addEventListener(MANIFEST_CHANGE_EVENT, onLocalChange);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(MANIFEST_CHANGE_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (validTripChange(event.data)) listener(event.data.tripId, "broadcast");
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

/**
 * The hard ceiling on the pending-event exception below: how long past a
 * record's own `expiresAt` it may be kept readable *because* it still holds an
 * unsynced roll-call event. Past this it is deleted regardless of what is
 * queued on it, and the loss is written to the discard notice this module
 * keeps (see {@link readDiscardedOfflineRecords}) instead of vanishing.
 *
 * **Why there has to be one at all** (security review, 2026-08-06, F3). The
 * exception was bounded by prose rather than by arithmetic: a foreign shop's
 * record survives "until the original shop's own session next runs a purge pass
 * and finds it resolved". That moment is not guaranteed to arrive. A pending
 * event can only reconcile under the shop that recorded it, so if that shop's
 * staff never sign into this tablet again — a freelance captain who moves on, a
 * boat sold, a tablet reassigned — the record is retained forever, past both its
 * 14-day and its 7-day window. `/offline-manifest` has no auth gate by design
 * (the shell must open with the radio off), so "forever" means anyone holding
 * the tablet can read that shop's diver names, emergency contacts and
 * readiness/medical blockers, with no session, indefinitely. An unbounded
 * exception to a retention rule is not a retention rule.
 *
 * **Why 28 days.** Twice {@link OFFLINE_MANIFEST_MAX_RETENTION_MS}, the longest
 * a copy of a roster is ever meant to live on a device, expressed as that
 * constant rather than as a fresh number so shortening the retention window
 * shortens this with it. Bracketed on both sides:
 *
 * - *Long enough that a real trip's events always get their chance.* A record
 *   only reaches this ceiling after it has already expired, which is at most 7
 *   days after the boat came home (`OFFLINE_MANIFEST_POST_TRIP_RETENTION_MS`).
 *   Four further weeks of any signal, any sign-in by the shop that recorded it,
 *   any push the worker wakes on, is longer than a liveaboard charter, a crew
 *   rotation, or a tablet away for repair. Nothing plausible about a dive
 *   operation makes 35 days from the trip ending "too soon to have tried".
 * - *Short enough that "indefinitely" stops being true.* The worst case is
 *   `savedAt + 14 + 28` = 42 days, and measured from the trip itself
 *   `endsAt + 7 + 28` = 35. That lands the grace period itself just under the 30
 *   days `RETENTION_DAYS.push_subscriptions` (`src/lib/retention.ts`) gives the
 *   closest analogue in the server-side table — a *device* credential, kept only
 *   while its trip is near, "pure blast radius" afterwards. The reasoning there
 *   applies with more force here, not less: this is a shared boat tablet holding
 *   emergency contacts and medical blockers, not a row in a managed database.
 *
 * `offline-manifest-store.test.ts` asserts both bounds rather than trusting this
 * comment, the same way `retentionWindowsOutlastStripeRetries` does for Stripe.
 *
 * It lives here rather than beside the other windows in `offline-manifests.ts`
 * because it is a rule about *this store's* deletion behaviour — nothing that
 * merely reads a snapshot has any use for it.
 */
export const OFFLINE_MANIFEST_PENDING_GRACE_MS = 2 * OFFLINE_MANIFEST_MAX_RETENTION_MS;

/**
 * What this device gave up when the ceiling above fired: enough for a human to
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

export type OfflineSyncResult = {
  clientEventId: string;
  status: "applied" | "duplicate" | "rejected";
  reason?: string;
  noteDisposition?: "discarded_erasure_cutoff" | "discarded_unverified_snapshot";
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
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    if (!db.objectStoreNames.contains(MANIFEST_STORE))
      db.createObjectStore(MANIFEST_STORE, { keyPath: "tripId" });
  };
  return requestResult(request);
}

function serverSnapshotClaims(
  token: string | undefined,
): { epoch: number; revision: number } | null {
  if (!token) return null;
  const match = /^(\d{1,16})\.(\d{1,16})\.[A-Za-z0-9_-]{43}$/.exec(token);
  if (!match) return null;
  const epoch = Number(match[1]);
  const revision = Number(match[2]);
  if (
    !Number.isSafeInteger(epoch) ||
    epoch < 0 ||
    String(epoch) !== match[1] ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    String(revision) !== match[2]
  ) {
    return null;
  }
  return { epoch, revision };
}

function dispositionForSnapshotRefresh(
  previousToken: string | undefined,
  currentToken: string | undefined,
): OfflineSyncResult["noteDisposition"] {
  const current = serverSnapshotClaims(currentToken);
  if (!current) return undefined;
  const previous = serverSnapshotClaims(previousToken);
  if (!previous) return "discarded_unverified_snapshot";
  return current.epoch > previous.epoch ? "discarded_erasure_cutoff" : undefined;
}

function clearSavedNotes<T extends OfflineRollCallEvent | OfflineChecklistEvent>(
  events: T[],
  disposition: NonNullable<OfflineSyncResult["noteDisposition"]>,
): T[] {
  return events.map((event) =>
    event.note?.trim() ? { ...event, note: null, noteDisposition: disposition } : event,
  );
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

async function persistEnvelope(
  db: IDBDatabase,
  envelope: OfflineManifestEnvelope,
  tenantRound?: number,
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
  const manifestStore = transaction.objectStore(MANIFEST_STORE);
  const write = () => {
    manifestStore.put({
      tripId,
      expiresAt: envelope.snapshot.expiresAt,
      shopSlug: envelope.snapshot.shop.slug,
      pendingEvents: pendingOfflineEventCount(envelope),
      iv,
      ciphertext,
    } satisfies StoredRecord);
    persisted = true;
  };
  if (tenantRound === undefined) {
    write();
  } else {
    transaction.objectStore(KEY_STORE).get(TENANT_ROUND_KEY).onsuccess = (event) => {
      if ((event.target as IDBRequest<unknown>).result === tenantRound) write();
    };
  }
  await done;
  if (persisted) announceManifestChange(tripId);
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

/**
 * Serializes the read-modify-write on the discard notice, which several trips'
 * reads can hit at once (`listOfflineManifests` loads every record in parallel,
 * and each one can discard). Its own lock name, never taken while holding it —
 * `withManifestLock` → this, never the reverse — so the pair cannot deadlock.
 */
function withNoticeLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request("diveday-offline-manifest-discards", fn);
}

async function readNotices(db: IDBDatabase): Promise<DiscardedOfflineRecord[]> {
  const transaction = db.transaction(KEY_STORE, "readonly");
  const stored = await requestResult(transaction.objectStore(KEY_STORE).get(DISCARD_NOTICE_KEY));
  await transactionDone(transaction);
  return Array.isArray(stored) ? (stored as DiscardedOfflineRecord[]) : [];
}

/**
 * Appends the loss so a screen can report it later. **Never a throw path**: the
 * caller is mid-delete on a record that must go regardless (see
 * {@link OFFLINE_MANIFEST_PENDING_GRACE_MS}), and failing here would either
 * abort a retention deletion to preserve a footnote about it, or — worse —
 * delete the record and then propagate an error to a caller that treats it as
 * "storage is broken". Losing the notice is bad; keeping a foreign shop's
 * roster because the notice could not be written is the finding.
 */
async function noteDiscardedRecord(
  db: IDBDatabase,
  envelope: OfflineManifestEnvelope,
  pendingEvents: number,
): Promise<void> {
  const trip = envelope.snapshot.manifests[0]?.trip;
  try {
    await withNoticeLock(async () => {
      const existing = await readNotices(db);
      const next = [
        ...existing,
        {
          noticeId: crypto.randomUUID(),
          tripId: trip?.id ?? "",
          tripTitle: trip?.title ?? "",
          shopName: envelope.snapshot.shop.name,
          shopSlug: envelope.snapshot.shop.slug,
          pendingEvents,
          discardedAt: nowDate().toISOString(),
        } satisfies DiscardedOfflineRecord,
      ].slice(-DISCARD_NOTICE_LIMIT);
      const transaction = db.transaction(KEY_STORE, "readwrite");
      transaction.objectStore(KEY_STORE).put(next, DISCARD_NOTICE_KEY);
      await transactionDone(transaction);
    });
  } catch (error) {
    // Deliberately not rethrown — see the docblock above: the deletion must
    // win over its own footnote. But leave a trace, or a device that can
    // never write the notice looks identical to one with nothing to say.
    log("offline_manifest.discard_notice_failed", "error", {
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return;
  }
}

/**
 * Every unsynced roll-call record this device has thrown away at the retention
 * ceiling and not had acknowledged yet — the offline shell reads this and says
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
    await withNoticeLock(async () => {
      const acknowledgedIds = new Set(acknowledged.map(({ noticeId }) => noticeId));
      const remaining = (await readNotices(db)).filter(
        (notice) => !acknowledgedIds.has(notice.noticeId),
      );
      const transaction = db.transaction(KEY_STORE, "readwrite");
      const notices = transaction.objectStore(KEY_STORE);
      if (remaining.length === 0) notices.delete(DISCARD_NOTICE_KEY);
      else notices.put(remaining, DISCARD_NOTICE_KEY);
      await transactionDone(transaction);
    });
  } finally {
    db.close();
  }
}

/**
 * True once a record is far enough past its own `expiresAt` that the
 * pending-event exception stops applying — see
 * {@link OFFLINE_MANIFEST_PENDING_GRACE_MS} for the window and why it is bounded
 * at all. Reads the *stored* (plaintext) expiry, the same field
 * `isOfflineManifestExpired` is given here, so the two answers can never be
 * computed from different copies of the same date.
 */
function isPastPendingGrace(
  record: Pick<StoredRecord, "expiresAt">,
  now: Date = nowDate(),
): boolean {
  return new Date(record.expiresAt).getTime() + OFFLINE_MANIFEST_PENDING_GRACE_MS <= now.getTime();
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
      //
      // **Until the ceiling.** That exception used to have no end (security
      // review, 2026-08-06, F3): an event can only reconcile under the shop
      // that recorded it, so a record whose shop never signs into this device
      // again was kept — decryptable, listed, and openable with no session on
      // a shell that has no auth gate — forever. Past
      // OFFLINE_MANIFEST_PENDING_GRACE_MS the record goes regardless of what
      // is queued on it, and the loss is written down (readDiscardedOfflineRecords)
      // rather than dropped in silence, because unsynced evidence of who came
      // back from a dive is not something to delete quietly.
      //
      // The rule lives here, in the one function that decrypts a record and
      // decides whether it still exists, so `listOfflineManifests` and
      // `purgeOfflineManifestsExceptShop` inherit it instead of re-deriving
      // it — the same chokepoint discipline the purge's own slug guard
      // follows. It is enforced lazily, on read: IndexedDB has no background
      // expiry, so the guarantee is "no read after the ceiling ever returns
      // it", exactly as the ordinary retention window has always worked.
      const pendingEvents = pendingOfflineEventCount(envelope);
      if (pendingEvents === 0 || isPastPendingGrace(record)) {
        if (pendingEvents > 0) await noteDiscardedRecord(db, envelope, pendingEvents);
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
 * holds an unsynced roll-call event, and only until
 * OFFLINE_MANIFEST_PENDING_GRACE_MS past its expiry) apply exactly once, in
 * one place, instead of being re-implemented here and risking drift. That is
 * also what makes simply *opening the shell* enough to clear a record past the
 * ceiling — no session, no network, no purge pass required.
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
 * **That reprieve is bounded, and not by this function.** It lasts until the
 * original shop's own session next reconciles it, or until
 * OFFLINE_MANIFEST_PENDING_GRACE_MS past the record's expiry, whichever comes
 * first — and the ceiling is enforced inside `loadOfflineManifest`, which this
 * function reads every candidate through. So a past-ceiling record is already
 * gone by the time the pending check below looks at it (`current` is null), and
 * there is deliberately no second copy of the rule here to drift from the
 * first. Before that ceiling existed, "until the original shop signs in again"
 * was the only bound on record that never had to arrive at all — see
 * OFFLINE_MANIFEST_PENDING_GRACE_MS for why that is a finding rather than a
 * tradeoff (security review, 2026-08-06, F3).
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
        const deleted = await deletePurgeCandidate(tripId, currentShopSlug, tenantRound, isCurrent);
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
 * Atomically compare the shared verification round and plaintext safety
 * metadata with the delete. A different context can start a newer tenant
 * request between any preceding await and this transaction; IDB serializes
 * this read/write transaction against that round allocation. Missing metadata
 * is treated as unknown and retained, never guessed to be safe to delete.
 */
async function deletePurgeCandidate(
  tripId: string,
  currentShopSlug: string,
  tenantRound: number,
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
    let latestRound: unknown;
    let record: StoredRecord | undefined;
    let deleted = false;
    const maybeDelete = () => {
      if (!roundReady || !recordReady || (isCurrent && !isCurrent())) return;
      if (latestRound !== tenantRound || !record) return;
      if (typeof record.shopSlug !== "string" || record.shopSlug.length === 0) return;
      if (record.shopSlug === currentShopSlug) return;
      if (
        typeof record.pendingEvents !== "number" ||
        !Number.isSafeInteger(record.pendingEvents) ||
        record.pendingEvents < 0 ||
        record.pendingEvents > 0
      )
        return;
      manifestStore.delete(tripId);
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
    await done;
    if (deleted) announceManifestChange(tripId);
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
  } = {},
): Promise<OfflineManifestEnvelope> {
  const keepMedicalAlertWords = options.keepMedicalAlertWords ?? true;
  const trip = payload.manifests[0]?.trip;
  if (!trip || payload.manifests.length === 0) throw new Error("Manifest payload is empty");
  return withManifestLock(trip.id, async () => {
    // A corrupt or undecryptable existing record (storage corruption, a stale
    // key, a version/AAD mismatch) must not abort the save — there's no delete
    // button anymore, so failing here would brick this device's offline copy
    // for good instead of just losing that record's own queued events.
    const existing = await loadOfflineManifest(trip.id).catch(() => null);
    const savedAt = nowDate();
    // Snapshot tokens carry a server-authenticated epoch. This local comparison
    // only removes retained text from this device; every sync writer still
    // verifies the token MAC and compares the epoch server-side before accepting
    // note text. A changed snapshot id at the same epoch is an ordinary refresh
    // and must not erase notes staff added after the last deletion.
    const previousClaims = serverSnapshotClaims(existing?.snapshot.erasureEpochToken);
    const currentClaims = serverSnapshotClaims(payload.erasureEpochToken);
    if (
      existing &&
      previousClaims &&
      (!currentClaims ||
        currentClaims.epoch < previousClaims.epoch ||
        (currentClaims.epoch === previousClaims.epoch &&
          currentClaims.revision <= previousClaims.revision))
    ) {
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
        const persisted = await persistEnvelope(db, revoked, options.tenantRound);
        if (!persisted && options.tenantRound !== undefined)
          throw new OfflineManifestError("shop_changed");
      } finally {
        db.close();
      }
      return revoked;
    }
    const noteDisposition = existing
      ? dispositionForSnapshotRefresh(
          existing.snapshot.erasureEpochToken,
          payload.erasureEpochToken,
        )
      : undefined;
    // **The medical alerts' words** (H-153 amendment). A payload from the
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
      snapshot: {
        ...payload,
        manifests,
        version: OFFLINE_MANIFEST_RECORD_VERSION,
        snapshotId: payload.snapshotId ?? crypto.randomUUID(),
        savedAt: savedAt.toISOString(),
        expiresAt: offlineManifestExpiresAt(savedAt, new Date(trip.endsAt)).toISOString(),
      },
      events:
        existing?.events && noteDisposition
          ? clearSavedNotes(existing.events, noteDisposition)
          : (existing?.events ?? []),
      checklistEvents:
        existing?.checklistEvents && noteDisposition
          ? clearSavedNotes(existing.checklistEvents, noteDisposition)
          : (existing?.checklistEvents ?? []),
      arrivalEvents: existing?.arrivalEvents ?? [],
      ...(carriesWords && existing?.medicalAlertsSavedBy
        ? { medicalAlertsSavedBy: existing.medicalAlertsSavedBy }
        : {}),
    };
    const db = await openDatabase();
    try {
      const persisted = await persistEnvelope(db, envelope, options.tenantRound);
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
 * (H-153 amendment), after a permitted reader tapped save-for-offline and
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
    const existing = await loadOfflineManifest(tripId).catch(() => null);
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
      const persisted = await persistEnvelope(db, envelope, tenantRound);
      if (!persisted && tenantRound !== undefined) throw new OfflineManifestError("shop_changed");
    } finally {
      db.close();
    }
    return envelope;
  });
}

/**
 * **Takes the medical alerts' words off every copy on this device** (H-153
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
  const saved = await listOfflineManifests();
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
          const current = await loadOfflineManifest(tripId).catch(() => null);
          if (!current?.medicalAlertsSavedBy) return;
          if (keepSavedBy && current.medicalAlertsSavedBy.personId === keepSavedBy) return;
          const { medicalAlertsSavedBy: _wiped, ...rest } = current;
          const db = await openDatabase();
          try {
            await persistEnvelope(
              db,
              {
                ...rest,
                snapshot: {
                  ...current.snapshot,
                  manifests: withMedicalAlertWords(current.snapshot.manifests, {}),
                },
              },
              tenantRound,
            );
          } finally {
            db.close();
          }
        });
      }),
  );
}

export async function deleteOfflineManifest(
  tripId: string,
  existingDb?: IDBDatabase,
  isCurrent?: () => boolean,
): Promise<boolean> {
  const ownsDb = existingDb === undefined;
  const db = existingDb ?? (await openDatabase());
  try {
    // The purge may have waited for openDatabase after its locked record
    // reread. Recheck at the last synchronous point before queuing the delete
    // request so a newer tenant round cannot be crossed by that await.
    if (isCurrent && !isCurrent()) return false;
    const transaction = db.transaction(MANIFEST_STORE, "readwrite");
    transaction.objectStore(MANIFEST_STORE).delete(tripId);
    await transactionDone(transaction);
    announceManifestChange(tripId);
    return true;
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
 * `retractsClientEventId` rides along on a `cleared` and names the statement it
 * takes back, which is what makes the retraction a compare-and-set on the server
 * rather than a blind newest-wins write (ADR
 * 20260815-an-offline-retraction-names-its-target). Nothing is validated about
 * it here: the only honest check is against the newest event the *server* holds,
 * and this function runs where there is no server.
 */
export async function appendOfflineRollCall(
  tripId: string,
  input: Pick<
    OfflineRollCallEvent,
    "bookingId" | "crewPersonId" | "checkpoint" | "status" | "retractsClientEventId" | "note"
  >,
): Promise<OfflineManifestEnvelope> {
  return withManifestLock(tripId, async () => {
    const envelope = await loadOfflineManifest(tripId);
    if (!envelope) throw new OfflineManifestError("unavailable");
    // A snapshot kept alive past its retention window (loadOfflineManifest
    // preserves one that still has an unsynced event) is not a boarding
    // source — the H-05 stop rule treats expired the same as missing. It
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
      await persistEnvelope(db, envelope);
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
      await persistEnvelope(db, envelope);
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
    if (!canRecordOfflineArrival(envelope.snapshot, input.bookingId)) {
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
      await persistEnvelope(db, envelope);
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
}): Promise<{ results: OfflineSyncResult[] }> {
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === "shop_changed") throw new OfflineManifestError("shop_changed");
      }
      throw new OfflineManifestError("sync_unreachable");
    }
    return (await response.json()) as { results: OfflineSyncResult[] };
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

export async function syncOfflineManifest(
  tripId: string,
  expectedShopSlug?: string,
  requestTenantRound?: number,
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
  if (pendingOfflineEventCount(envelope) === 0 || !navigator.onLine) return envelope;
  const tenantRound = requestTenantRound ?? (await beginOfflineTenantVerificationRound());
  const body = await postPendingEvents({
    ...(expectedShopSlug ? { expectedShopSlug } : {}),
    events: pending,
    checklistEvents: pendingChecklist,
    arrivalEvents: pendingArrivals,
  });
  // One map for both arrays: a roll-call event id and a checklist event id are
  // both `crypto.randomUUID()`, so they never collide, and the sync route
  // returns one flat `results` list naming whichever kind each id belongs to.
  const byId = new Map(body.results.map((result) => [result.clientEventId, result]));
  // Re-read and merge under the lock instead of writing back the envelope
  // read before the network round-trip: a concurrent appendOfflineRollCall
  // (this tab or another) could have recorded a new pending event while the
  // request was in flight, and writing the pre-fetch snapshot would discard it.
  return withManifestLock(tripId, async () => {
    const current = await loadOfflineManifest(tripId);
    if (!current) return null;
    const applyResult = <T extends { clientEventId: string }>(event: T) => {
      const result = byId.get(event.clientEventId);
      if (!result) return event;
      return {
        ...event,
        ...(result.noteDisposition ? { note: null } : {}),
        syncStatus: result.status === "rejected" ? "rejected" : "applied",
        rejectionReason: result.reason,
        ...(result.noteDisposition ? { noteDisposition: result.noteDisposition } : {}),
      };
    };
    current.events = current.events.map(applyResult);
    current.checklistEvents = current.checklistEvents.map(applyResult);
    current.arrivalEvents = offlineArrivalEvents(current).map(applyResult);
    const db = await openDatabase();
    try {
      const persisted = await persistEnvelope(db, current, tenantRound);
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
