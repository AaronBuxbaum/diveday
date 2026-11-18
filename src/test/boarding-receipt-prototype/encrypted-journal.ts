/**
 * Isolated storage experiment, not a production queue. The caller's tenant and
 * observation are unverified. No startup path imports this file. In particular,
 * this does not provide erasure, old-client coordination, device recovery or a
 * server receipt, and must not be used to announce a tap saved in the product.
 */
type Candidate = { tenant: string; id: string; original: unknown };
type KeyRecord = { key: CryptoKey; generation: string };
type CipherRecord = { generation: string; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function validKey(value: unknown): value is KeyRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<KeyRecord>;
  const key = record.key;
  return (
    typeof record.generation === "string" &&
    record.generation.length > 0 &&
    key instanceof CryptoKey &&
    key.type === "secret" &&
    !key.extractable &&
    key.algorithm.name === "AES-GCM" &&
    (key.algorithm as AesKeyAlgorithm).length === 256 &&
    key.usages.includes("encrypt") &&
    key.usages.includes("decrypt")
  );
}
function aad(tenant: string, id: string, generation: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(["test-journal-v1", generation, tenant, id]));
}

// Reject values JSON would silently change or omit. This is not a canonical
// event schema and does not validate the truth of an observation.
function losslessJson(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== "object" || seen.has(value) || seen.size >= 50) return false;
  if (Array.isArray(value) && value.length > 10000) return false;
  const proto = Object.getPrototypeOf(value);
  if (
    Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null
  )
    return false;
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return false;
  if (
    Array.isArray(value) &&
    (keys.length !== value.length + 1 ||
      !keys.includes("length") ||
      !Array.from({ length: value.length }, (_, i) => String(i)).every((key) => keys.includes(key)))
  )
    return false;
  for (const key of keys) {
    if (key === "length" && Array.isArray(value)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !losslessJson(descriptor.value, seen)
    )
      return false;
  }
  seen.delete(value);
  return true;
}

export async function openExperimentalJournal(databaseName: string) {
  if (!databaseName.startsWith("test-evidence-journal-")) throw new Error("test database required");
  const request = indexedDB.open(databaseName, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("keys");
    request.result.createObjectStore("events");
  };
  const db = await result(request);
  try {
    const candidate: KeyRecord = {
      key: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]),
      generation: crypto.randomUUID(),
    };
    const tx = db.transaction(["keys", "events"], "readwrite");
    const completed = done(tx);
    const keys = tx.objectStore("keys");
    const get = keys.get("current");
    let elected: KeyRecord | undefined;
    get.onsuccess = () => {
      if (validKey(get.result)) {
        elected = get.result;
        return;
      }
      if (get.result !== undefined) {
        tx.abort();
        return;
      }
      const count = tx.objectStore("events").count();
      count.onsuccess = () => {
        if (count.result !== 0) {
          tx.abort();
          return;
        }
        keys.add(candidate, "current");
        elected = candidate;
      };
    };
    await completed;
    if (!elected) throw new Error("key unavailable");
    const selected = elected;
    return {
      close: () => db.close(),
      async append(entry: Candidate): Promise<"committed" | "conflict" | "unavailable"> {
        try {
          if (
            !losslessJson(entry) ||
            !Object.hasOwn(entry, "original") ||
            typeof entry.tenant !== "string" ||
            !entry.tenant ||
            typeof entry.id !== "string" ||
            !entry.id
          )
            return "unavailable";
          const tenant = entry.tenant;
          const id = entry.id;
          const text = JSON.stringify(entry);
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ciphertext = await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv,
              additionalData: aad(tenant, id, selected.generation),
            },
            selected.key,
            new TextEncoder().encode(text),
          );
          const write = db.transaction(["keys", "events"], "readwrite");
          const finished = done(write);
          const events = write.objectStore("events");
          const current = write.objectStore("keys").get("current");
          const existing = events.get([tenant, id]);
          let haveKey = false,
            haveEvent = false;
          let answer: "committed" | "conflict" | "unavailable" = "unavailable";
          const check = () => {
            if (!haveKey || !haveEvent) return;
            if (!validKey(current.result) || current.result.generation !== selected.generation)
              return;
            if (existing.result !== undefined) {
              answer = "conflict";
              return;
            }
            events.add({ generation: selected.generation, iv, ciphertext } satisfies CipherRecord, [
              tenant,
              id,
            ]);
            answer = "committed";
          };
          current.onsuccess = () => {
            haveKey = true;
            check();
          };
          existing.onsuccess = () => {
            haveEvent = true;
            check();
          };
          await finished;
          return answer;
        } catch {
          return "unavailable";
        }
      },
      async inspectForTest(tenant: string, id: string): Promise<unknown | null> {
        const read = db.transaction("events", "readonly");
        const completedRead = done(read);
        const row: CipherRecord | undefined = await result(
          read.objectStore("events").get([tenant, id]),
        );
        await completedRead;
        if (!row) return null;
        if (row.generation !== selected.generation) throw new Error("key generation changed");
        const bytes = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: row.iv, additionalData: aad(tenant, id, row.generation) },
          selected.key,
          row.ciphertext,
        );
        return JSON.parse(new TextDecoder().decode(bytes));
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
