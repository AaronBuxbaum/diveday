/**
 * Inert test experiment: keys are deliberately retained alongside ciphertext.
 * This does not authenticate a caller, verify an original meeting, implement
 * erasure or recovery, survive device loss, or acknowledge a product tap.
 * Tenant and event IDs are plaintext metadata. Never wire this into runtime.
 */
type Stored = { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("transaction error"));
  });
}
function aad(tenant: string, id: string) {
  return new TextEncoder().encode(JSON.stringify(["per-event-test-v1", tenant, id]));
}
function validText(text: string): boolean {
  return new TextDecoder().decode(new TextEncoder().encode(text)) === text;
}
function validKey(key: unknown): key is CryptoKey {
  return (
    key instanceof CryptoKey &&
    key.type === "secret" &&
    !key.extractable &&
    key.algorithm.name === "AES-GCM" &&
    (key.algorithm as AesKeyAlgorithm).length === 256 &&
    key.usages.includes("encrypt") &&
    key.usages.includes("decrypt")
  );
}
export async function openPerEventKeyExperiment(name: string) {
  if (!name.startsWith("test-evidence-per-event-")) throw new Error("test database required");
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => request.result.createObjectStore("events");
  const db = await result(request);
  return {
    close: () => db.close(),
    async append(
      tenant: string,
      id: string,
      text: string,
    ): Promise<"committed" | "conflict" | "unavailable"> {
      if (
        typeof tenant !== "string" ||
        !tenant ||
        typeof id !== "string" ||
        !id ||
        typeof text !== "string" ||
        !validText(tenant) ||
        !validText(id) ||
        !validText(text)
      )
        return "unavailable";
      try {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
          "encrypt",
          "decrypt",
        ]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: aad(tenant, id) },
          key,
          new TextEncoder().encode(text),
        );
        const tx = db.transaction("events", "readwrite");
        const completed = done(tx);
        const store = tx.objectStore("events");
        const get = store.get([tenant, id]);
        let outcome: "committed" | "conflict" = "conflict";
        get.onsuccess = () => {
          if (get.result !== undefined) return;
          store.add({ key, iv, ciphertext } satisfies Stored, [tenant, id]);
          outcome = "committed";
        };
        await completed;
        return outcome;
      } catch {
        return "unavailable";
      }
    },
    async readForTest(
      tenant: string,
      id: string,
    ): Promise<{ status: "missing" | "unavailable" } | { status: "readable"; text: string }> {
      try {
        const tx = db.transaction("events", "readonly");
        const completed = done(tx);
        const row: Stored | undefined = await result(tx.objectStore("events").get([tenant, id]));
        await completed;
        if (row === undefined) return { status: "missing" };
        if (!validKey(row.key)) return { status: "unavailable" };
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: row.iv, additionalData: aad(tenant, id) },
          row.key,
          row.ciphertext,
        );
        return {
          status: "readable",
          text: new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
        };
      } catch {
        return { status: "unavailable" };
      }
    },
    /** A historical read observation, never a retry acknowledgment or authorization. */
    async observeRetryForTest(
      tenant: string,
      id: string,
      expected: string,
    ): Promise<"observed_match" | "observed_mismatch" | "missing" | "unavailable"> {
      if (typeof expected !== "string" || !validText(expected)) return "unavailable";
      const observed = await this.readForTest(tenant, id);
      if (observed.status !== "readable") return observed.status;
      return observed.text === expected ? "observed_match" : "observed_mismatch";
    },
  };
}
