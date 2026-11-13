"use client";

import { nowMs } from "@/lib/clock";
import { OFFLINE_MANIFEST_MAX_RETENTION_MS } from "@/lib/offline-manifests";

// WIP: storage fencing only. Not an authorization boundary and not wired to
// the manifest. The caller must validate server provenance, expiry, current
// session, erasure and pending writes before this can be shown or confirmed.
// This separate database never changes the offline event ledger or its schema.
const DB_NAME = "diveday-live-manifest-cache";
const STORE = "records";
const KEY = "key-v1";
const PRUNE_CURSOR = "prune-cursor-v1";
const PRUNE_BATCH = 64;

export type LiveManifestCacheScope = {
  shop: string;
  trip: string;
  checkpoint: string;
  session: string;
};
type Scope = LiveManifestCacheScope;
type Fence = { shop: string; session: string; request: string; key: string; writes: string };
type StoredKey = { id: string; key: CryptoKey };
type Writes = { generation: string; pending: string[] };
type Tombstone = { revoked: string; reason: "erasure" | "purge" | "session" };
type Recovery = { tombstone: string; session: string; nonce: string };
type Ciphertext = {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  fence: Fence;
  id: string;
  createdAt: number;
  expiresAt: number;
};

const shopKey = (shop: string) => JSON.stringify(["shop", shop]);
const sessionKey = (session: string) => JSON.stringify(["session", session]);
const recoveryKey = (scope: Pick<Scope, "shop" | "session">) =>
  JSON.stringify(["recovery", scope.shop, scope.session]);
const requestKey = (scope: Scope) =>
  JSON.stringify(["request", scope.shop, scope.trip, scope.checkpoint, scope.session]);
const writesKey = (scope: Pick<Scope, "shop" | "trip">) =>
  JSON.stringify(["writes", scope.shop, scope.trip]);
const projectionKey = (scope: Scope) =>
  JSON.stringify(["projection", scope.shop, scope.trip, scope.checkpoint, scope.session]);
const aad = (scope: Scope, fence: Fence, createdAt: number, expiresAt: number) =>
  new TextEncoder().encode(
    JSON.stringify([
      "live-manifest-v1",
      scope.shop,
      scope.trip,
      scope.checkpoint,
      scope.session,
      fence.shop,
      fence.session,
      fence.request,
      fence.key,
      fence.writes,
      createdAt,
      expiresAt,
    ]),
  );

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

async function open(): Promise<IDBDatabase> {
  const opening = indexedDB.open(DB_NAME, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
  return request(opening);
}

/** Remove one bounded batch of expired projection records on each activation. */
async function pruneExpired(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  const complete = done(tx);
  const store = tx.objectStore(STORE);
  const last = await request(store.get(PRUNE_CURSOR));
  const cursor = store.openCursor(
    typeof last === "string" ? IDBKeyRange.lowerBound(last, true) : undefined,
  );
  const cutoff = nowMs();
  let scanned = 0;
  cursor.onsuccess = () => {
    const entry = cursor.result;
    if (!entry) {
      store.delete(PRUNE_CURSOR);
      return;
    }
    scanned++;
    try {
      const parts: unknown = JSON.parse(String(entry.key));
      if (Array.isArray(parts) && parts[0] === "projection") {
        const record = entry.value as Partial<Ciphertext> | null;
        if (
          !record ||
          !Number.isSafeInteger(record.createdAt) ||
          !Number.isSafeInteger(record.expiresAt) ||
          (record.createdAt as number) > cutoff ||
          (record.expiresAt as number) <= cutoff ||
          (record.expiresAt as number) <= (record.createdAt as number) ||
          (record.expiresAt as number) - (record.createdAt as number) >
            OFFLINE_MANIFEST_MAX_RETENTION_MS
        )
          entry.delete();
      }
    } catch {
      // Non-projection keys do not carry retention dates.
    }
    if (scanned >= PRUNE_BATCH) store.put(String(entry.key), PRUNE_CURSOR);
    else entry.continue();
  };
  await complete;
}

function validFence(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isTombstone(value: unknown): value is Tombstone {
  return (
    typeof value === "object" &&
    value !== null &&
    "revoked" in value &&
    validFence(value.revoked) &&
    "reason" in value &&
    (value.reason === "erasure" || value.reason === "purge" || value.reason === "session")
  );
}

function validWrites(value: unknown): value is Writes {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Writes>;
  return (
    validFence(candidate.generation) &&
    Array.isArray(candidate.pending) &&
    candidate.pending.every(validFence)
  );
}

/** Capture before starting an authorized read, never after it completes. */
export async function captureLiveManifestFence(scope: Scope): Promise<Fence> {
  scope = { ...scope };
  const candidateKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const candidateShop = crypto.randomUUID();
  const candidateSession = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const candidateKeyId = crypto.randomUUID();
  const candidateWrites = crypto.randomUUID();
  const db = await open();
  try {
    await pruneExpired(db);
    const tx = db.transaction(STORE, "readwrite");
    const complete = done(tx);
    const store = tx.objectStore(STORE);
    const [key, shop, session, existingWrites] = await Promise.all([
      request(store.get(KEY)),
      request(store.get(shopKey(scope.shop))),
      request(store.get(sessionKey(scope.session))),
      request(store.get(writesKey(scope))),
    ]);
    if (isTombstone(shop) || isTombstone(session)) {
      await complete;
      throw new Error("live-manifest-cache-invalidated");
    }
    if (
      (shop !== undefined && !validFence(shop)) ||
      (session !== undefined && !validFence(session))
    ) {
      await complete;
      throw new Error("live-manifest-cache-invalid-fence");
    }
    const storedKey = key as StoredKey | undefined;
    if (storedKey !== undefined && (!validFence(storedKey.id) || !storedKey.key)) {
      await complete;
      throw new Error("live-manifest-cache-invalid-key");
    }
    if (existingWrites !== undefined && !validWrites(existingWrites)) {
      await complete;
      throw new Error("live-manifest-cache-invalid-writes");
    }
    const writes = existingWrites as Writes | undefined;
    if (storedKey === undefined)
      store.put({ id: candidateKeyId, key: candidateKey } satisfies StoredKey, KEY);
    if (shop === undefined) store.put(candidateShop, shopKey(scope.shop));
    if (session === undefined) store.put(candidateSession, sessionKey(scope.session));
    if (writes === undefined)
      store.put({ generation: candidateWrites, pending: [] } satisfies Writes, writesKey(scope));
    store.put(requestId, requestKey(scope));
    await complete;
    return {
      shop: validFence(shop) ? shop : candidateShop,
      session: validFence(session) ? session : candidateSession,
      request: requestId,
      key: storedKey?.id ?? candidateKeyId,
      writes: writes?.generation ?? candidateWrites,
    };
  } finally {
    db.close();
  }
}

async function invalidate(
  key: string,
  part: "shop" | "session",
  id: string,
  reason: Tombstone["reason"],
): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const complete = done(tx);
    const store = tx.objectStore(STORE);
    const previous = await request(store.get(key));
    const effectiveReason =
      reason === "erasure" && isTombstone(previous) && previous.reason === "purge"
        ? "purge"
        : reason;
    store.put({ revoked: crypto.randomUUID(), reason: effectiveReason } satisfies Tombstone, key);
    const cursor = store.openKeyCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      try {
        const parts: unknown = JSON.parse(String(entry.key));
        if (
          Array.isArray(parts) &&
          parts[0] === "projection" &&
          parts[part === "shop" ? 1 : 4] === id
        )
          store.delete(entry.primaryKey);
      } catch {
        // Other keys are not projection records.
      }
      entry.continue();
    };
    await complete;
  } finally {
    db.close();
  }
}

export const invalidateLiveManifestSession = (session: string) =>
  invalidate(sessionKey(session), "session", session, "session");
export const invalidateLiveManifestShop = (shop: string) =>
  invalidate(shopKey(shop), "shop", shop, "erasure");
export const purgeLiveManifestShop = (shop: string) =>
  invalidate(shopKey(shop), "shop", shop, "purge");

/** Captures an erasure tombstone before a new server-authorized recovery request. */
export async function beginLiveManifestShopRecovery(
  scope: Pick<Scope, "shop" | "session">,
): Promise<Recovery> {
  scope = { ...scope };
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const complete = done(tx);
    const store = tx.objectStore(STORE);
    const [shop, session] = await Promise.all([
      request(store.get(shopKey(scope.shop))),
      request(store.get(sessionKey(scope.session))),
    ]);
    if (
      !isTombstone(shop) ||
      shop.reason !== "erasure" ||
      (session !== undefined && !validFence(session))
    ) {
      await complete;
      throw new Error("live-manifest-cache-invalidated");
    }
    const sessionFence = validFence(session) ? session : crypto.randomUUID();
    if (session === undefined) store.put(sessionFence, sessionKey(scope.session));
    const recovery = { tombstone: shop.revoked, session: sessionFence, nonce: crypto.randomUUID() };
    store.put(recovery, recoveryKey(scope));
    await complete;
    return recovery;
  } finally {
    db.close();
  }
}

/**
 * WIP: the verifier must authenticate this exact shop, current session and
 * erasure epoch on the server. No production verifier is wired yet.
 */
export async function completeLiveManifestShopRecovery(
  scope: Pick<Scope, "shop" | "session">,
  recovery: Recovery,
  verify: (challenge: {
    shop: string;
    session: string;
    tombstone: string;
    nonce: string;
  }) => Promise<boolean>,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  const { shop, session } = scope;
  const { tombstone, session: sessionFence, nonce } = recovery;
  if (
    !shop ||
    !session ||
    !validFence(tombstone) ||
    !validFence(sessionFence) ||
    !validFence(nonce)
  )
    return false;
  let verified = false;
  try {
    verified = await verify({ shop, session, tombstone, nonce });
  } catch {
    return false;
  }
  if (!verified || !isCurrent()) return false;
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const complete = done(tx);
    const store = tx.objectStore(STORE);
    const [storedShop, storedSession, active] = await Promise.all([
      request(store.get(shopKey(shop))),
      request(store.get(sessionKey(session))),
      request(store.get(recoveryKey({ shop, session }))),
    ]);
    const current = active as Recovery | undefined;
    const accepted =
      isCurrent() &&
      isTombstone(storedShop) &&
      storedShop.reason === "erasure" &&
      storedShop.revoked === tombstone &&
      storedSession === sessionFence &&
      current?.tombstone === tombstone &&
      current.session === sessionFence &&
      current.nonce === nonce;
    if (accepted) {
      store.put(crypto.randomUUID(), shopKey(shop));
      store.delete(recoveryKey({ shop, session }));
    }
    await complete;
    return accepted;
  } finally {
    db.close();
  }
}

/** Record before issuing a mutation; a lost response leaves the barrier pending. */
export async function beginLiveManifestWrite(scope: Pick<Scope, "shop" | "trip">): Promise<string> {
  scope = { ...scope };
  const operation = crypto.randomUUID();
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const complete = done(tx);
    const store = tx.objectStore(STORE);
    const current = await request(store.get(writesKey(scope)));
    if (current !== undefined && !validWrites(current)) {
      await complete;
      throw new Error("live-manifest-cache-invalid-writes");
    }
    store.put(
      {
        generation: crypto.randomUUID(),
        pending: [...(validWrites(current) ? current.pending : []), operation],
      } satisfies Writes,
      writesKey(scope),
    );
    await complete;
    return operation;
  } finally {
    db.close();
  }
}

/** Only call after the server or an authoritative reconciliation establishes the outcome. */
export async function settleLiveManifestWrite(
  scope: Pick<Scope, "shop" | "trip">,
  operation: string,
): Promise<boolean> {
  scope = { ...scope };
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const complete = done(tx);
    const store = tx.objectStore(STORE);
    const current = (await request(store.get(writesKey(scope)))) as Writes | undefined;
    const found =
      !!current &&
      validFence(current.generation) &&
      Array.isArray(current.pending) &&
      current.pending.every(validFence) &&
      current.pending.includes(operation);
    if (found && current)
      store.put(
        {
          generation: crypto.randomUUID(),
          pending: current.pending.filter((id) => id !== operation),
        } satisfies Writes,
        writesKey(scope),
      );
    await complete;
    return found;
  } finally {
    db.close();
  }
}

/** Encrypt outside the transaction, then compare fences and write atomically. */
export async function writeLiveManifestCache(
  scope: Scope,
  fence: Fence,
  value: unknown,
  expiresAt: number,
): Promise<boolean> {
  scope = { ...scope };
  fence = { ...fence };
  if (
    !validFence(fence.shop) ||
    !validFence(fence.session) ||
    !validFence(fence.request) ||
    !validFence(fence.key) ||
    !validFence(fence.writes)
  )
    return false;
  const json = JSON.stringify(value);
  if (json === undefined) return false;
  const db = await open();
  try {
    const keyTx = db.transaction(STORE, "readonly");
    const key = (await request(keyTx.objectStore(STORE).get(KEY))) as StoredKey | undefined;
    if (!key || key.id !== fence.key || !key.key) return false;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const createdAt = nowMs();
    if (
      !Number.isSafeInteger(createdAt) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= createdAt ||
      expiresAt - createdAt > OFFLINE_MANIFEST_MAX_RETENTION_MS
    )
      return false;
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(scope, fence, createdAt, expiresAt) },
      key.key,
      new TextEncoder().encode(json),
    );
    const tx = db.transaction(STORE, "readwrite");
    const complete = done(tx);
    const store = tx.objectStore(STORE);
    const [shop, session, currentKey, currentRequest, currentWrites] = await Promise.all([
      request(store.get(shopKey(scope.shop))),
      request(store.get(sessionKey(scope.session))),
      request(store.get(KEY)),
      request(store.get(requestKey(scope))),
      request(store.get(writesKey(scope))),
    ]);
    const accepted =
      shop === fence.shop &&
      session === fence.session &&
      (currentKey as StoredKey | undefined)?.id === fence.key &&
      currentRequest === fence.request &&
      (currentWrites as Writes | undefined)?.generation === fence.writes &&
      Array.isArray((currentWrites as Writes | undefined)?.pending) &&
      (currentWrites as Writes).pending.length === 0;
    if (accepted)
      store.put(
        {
          iv,
          ciphertext,
          fence,
          id: crypto.randomUUID(),
          createdAt,
          expiresAt,
        } satisfies Ciphertext,
        projectionKey(scope),
      );
    await complete;
    return accepted;
  } finally {
    db.close();
  }
}

/** A cache hit is unconfirmed; the caller still needs authoritative validation. */
export async function readLiveManifestCache(
  scope: Scope,
): Promise<{ view: unknown; pendingWrites: boolean; changedSinceCache: boolean } | null> {
  scope = { ...scope };
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const [record, shop, session, key, initialWrites] = (await Promise.all([
      request(store.get(projectionKey(scope))),
      request(store.get(shopKey(scope.shop))),
      request(store.get(sessionKey(scope.session))),
      request(store.get(KEY)),
      request(store.get(writesKey(scope))),
    ])) as [Ciphertext | undefined, unknown, unknown, StoredKey | undefined, unknown];
    if (!record) return null;
    if (
      !Number.isSafeInteger(record.createdAt) ||
      !Number.isSafeInteger(record.expiresAt) ||
      record.expiresAt <= record.createdAt ||
      record.expiresAt - record.createdAt > OFFLINE_MANIFEST_MAX_RETENTION_MS ||
      nowMs() < record.createdAt ||
      nowMs() >= record.expiresAt
    ) {
      const cleanup = db.transaction(STORE, "readwrite");
      const complete = done(cleanup);
      const records = cleanup.objectStore(STORE);
      const current = (await request(records.get(projectionKey(scope)))) as Ciphertext | undefined;
      if (current?.id === record.id) records.delete(projectionKey(scope));
      await complete;
      return null;
    }
    if (
      !key ||
      !validWrites(initialWrites) ||
      key.id !== record.fence?.key ||
      !validFence(shop) ||
      !validFence(session) ||
      record.fence?.shop !== shop ||
      record.fence?.session !== session
    )
      return null;
    let value: unknown;
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: record.iv,
          additionalData: aad(scope, record.fence, record.createdAt, record.expiresAt),
        },
        key.key,
        record.ciphertext,
      );
      value = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      return null;
    }
    const check = db.transaction(STORE, "readonly").objectStore(STORE);
    const [newShop, newSession, current, newKey, newWrites] = (await Promise.all([
      request(check.get(shopKey(scope.shop))),
      request(check.get(sessionKey(scope.session))),
      request(check.get(projectionKey(scope))),
      request(check.get(KEY)),
      request(check.get(writesKey(scope))),
    ])) as [unknown, unknown, Ciphertext | undefined, StoredKey | undefined, unknown];
    return newShop === shop &&
      newSession === session &&
      current?.id === record.id &&
      newKey?.id === key.id &&
      validWrites(newWrites) &&
      newWrites.generation === initialWrites.generation &&
      nowMs() >= record.createdAt &&
      nowMs() < record.expiresAt
      ? {
          view: value,
          pendingWrites: newWrites.pending.length > 0,
          changedSinceCache: newWrites.generation !== record.fence.writes,
        }
      : null;
  } finally {
    db.close();
  }
}
