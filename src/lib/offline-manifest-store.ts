"use client";
import { nowDate } from "./clock";

import {
  canRecordOfflineStatus,
  isOfflineManifestExpired,
  OFFLINE_MANIFEST_MAX_RETENTION_MS,
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
  tripId: string;
  tripTitle: string;
  shopName: string;
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
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

export type OfflineSyncResult = {
  clientEventId: string;
  status: "applied" | "duplicate" | "rejected";
  reason?: string;
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
          tripId: trip?.id ?? "",
          tripTitle: trip?.title ?? "",
          shopName: envelope.snapshot.shop.name,
          pendingEvents,
          discardedAt: nowDate().toISOString(),
        } satisfies DiscardedOfflineRecord,
      ].slice(-DISCARD_NOTICE_LIMIT);
      const transaction = db.transaction(KEY_STORE, "readwrite");
      transaction.objectStore(KEY_STORE).put(next, DISCARD_NOTICE_KEY);
      await transactionDone(transaction);
    });
  } catch {
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
export async function acknowledgeDiscardedOfflineRecords(): Promise<void> {
  const db = await openDatabase();
  try {
    await withNoticeLock(async () => {
      const transaction = db.transaction(KEY_STORE, "readwrite");
      transaction.objectStore(KEY_STORE).delete(DISCARD_NOTICE_KEY);
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
      const pendingEvents = envelope.events.filter(
        (event) => event.syncStatus === "pending",
      ).length;
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
export async function purgeOfflineManifestsExceptShop(currentShopSlug: string): Promise<void> {
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
  if (typeof currentShopSlug !== "string" || currentShopSlug.length === 0) return;
  const saved = await listOfflineManifests();
  const candidates = saved.filter((envelope) => envelope.snapshot.shop.slug !== currentShopSlug);
  await Promise.all(
    candidates.map((envelope) => {
      const tripId = envelope.snapshot.manifests[0]?.trip.id;
      if (!tripId) return Promise.resolve();
      return withManifestLock(tripId, async () => {
        const current = await loadOfflineManifest(tripId);
        if (!current) return;
        if (current.events.some((event) => event.syncStatus === "pending")) return;
        await deleteOfflineManifest(tripId);
      });
    }),
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
    if (!envelope) throw new OfflineManifestError("unavailable");
    // A snapshot kept alive past its retention window (loadOfflineManifest
    // preserves one that still has an unsynced event) is not a boarding
    // source — the H-05 stop rule treats expired the same as missing. It
    // stays readable so its pending evidence can still reconcile, but
    // records no new roll call.
    if (isOfflineManifestExpired(envelope.snapshot)) {
      throw new OfflineManifestError("expired");
    }
    if (
      !canRecordOfflineStatus(envelope.snapshot, input.bookingId, input.status, input.checkpoint)
    ) {
      throw new OfflineManifestError("not_allowed");
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
  if (!response.ok) throw new OfflineManifestError("sync_unreachable");
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
