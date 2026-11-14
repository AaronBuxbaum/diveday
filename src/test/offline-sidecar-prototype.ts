// Isolated experiment: no production imports. Retained copies have no lifecycle
// or authorized recovery, so this must not be attached to offline saves.
const prefix = "experimental-evidence-sidecar:";
const sidecarLimit = 64;

export type SidecarCandidate = {
  tripId: string;
  ciphertext: ArrayBuffer;
  iv: ArrayBuffer;
  aad: ArrayBuffer;
  candidateKey: CryptoKey;
  expiresAt: string;
};

/** Queue both writes in one readwrite transaction; failures abort both. */
export function prototypeWriteWithSidecar(
  db: IDBDatabase,
  id: string,
  candidate: SidecarCandidate,
): Promise<void> {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) return Promise.reject(new Error("invalid sidecar id"));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["keys", "manifests"], "readwrite");
    const keys = tx.objectStore("keys");
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const count = keys.count(range);
    count.onsuccess = () => {
      if (count.result >= sidecarLimit) {
        tx.abort();
        return;
      }
      try {
        const added = keys.add(candidate, `${prefix}${id}`);
        added.onsuccess = () => {
          try {
            tx.objectStore("manifests").put({
              tripId: candidate.tripId,
              ciphertext: candidate.ciphertext,
              iv: candidate.iv,
              expiresAt: candidate.expiresAt,
            });
          } catch {
            tx.abort();
          }
        };
      } catch {
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("sidecar transaction aborted"));
    tx.onerror = () => {};
  });
}

export function prototypeSidecarKey(id: string): string {
  return `${prefix}${id}`;
}
