// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { prototypeSidecarKey, prototypeWriteWithSidecar } from "./offline-sidecar-prototype";

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`sidecar-prototype-${crypto.randomUUID()}`, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
      request.result.createObjectStore("manifests", { keyPath: "tripId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function get<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

it("retains the candidate key and pending bytes after an old writer changes the global key", async () => {
  const db = await openDb();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode("trip");
    const plaintext = new TextEncoder().encode('{"pending":["event-1"]}');
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      plaintext,
    );
    await prototypeWriteWithSidecar(db, "write-1", {
      tripId: "trip",
      ciphertext,
      iv: iv.buffer,
      aad: aad.buffer,
      candidateKey: key,
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    const replacement = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(replacement, "manifest-aes-gcm-v1");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const saved = await get<{
      iv: ArrayBuffer;
      aad: ArrayBuffer;
      candidateKey: CryptoKey;
      ciphertext: ArrayBuffer;
    }>(db, "keys", prototypeSidecarKey("write-1"));
    const recovered = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: saved.iv, additionalData: saved.aad },
      saved.candidateKey,
      saved.ciphertext,
    );
    expect(new TextDecoder().decode(recovered)).toBe('{"pending":["event-1"]}');
  } finally {
    db.close();
  }
});

it("keeps earlier bytes and their original expiry across simulated legacy signout and rollback writes", async () => {
  const db = await openDb();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const base = {
      tripId: "trip",
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array(12).buffer,
      aad: new Uint8Array([2]).buffer,
      candidateKey: key,
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    await prototypeWriteWithSidecar(db, "first", base);
    await prototypeWriteWithSidecar(db, "second", {
      ...base,
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["keys", "manifests"], "readwrite");
      tx.objectStore("keys").delete("manifest-aes-gcm-v1");
      tx.objectStore("manifests").put({ tripId: "trip", ciphertext: new Uint8Array([9]).buffer });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const first = await get<typeof base>(db, "keys", prototypeSidecarKey("first"));
    expect(first.expiresAt).toBe("2026-01-01T00:00:00.000Z");
    expect(new Uint8Array(first.ciphertext)[0]).toBe(1);
    expect(await get(db, "keys", prototypeSidecarKey("second"))).toBeDefined();
  } finally {
    db.close();
  }
});

it("aborts the active write on a duplicate sidecar identity or a full sidecar store", async () => {
  const db = await openDb();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const base = {
      tripId: "trip",
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array(12).buffer,
      aad: new Uint8Array([2]).buffer,
      candidateKey: key,
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    await prototypeWriteWithSidecar(db, "first", base);
    const changed = { ...base, ciphertext: new Uint8Array([9]).buffer };
    await expect(prototypeWriteWithSidecar(db, "first", changed)).rejects.toThrow();
    expect(
      new Uint8Array(
        (await get<{ ciphertext: ArrayBuffer }>(db, "manifests", "trip")).ciphertext,
      )[0],
    ).toBe(1);
    for (let index = 1; index < 64; index += 1)
      await prototypeWriteWithSidecar(db, `write-${index}`, base);
    await expect(prototypeWriteWithSidecar(db, "over-limit", changed)).rejects.toThrow();
    expect(
      new Uint8Array(
        (await get<{ ciphertext: ArrayBuffer }>(db, "manifests", "trip")).ciphertext,
      )[0],
    ).toBe(1);
    expect(await get(db, "keys", prototypeSidecarKey("first"))).toBeDefined();
  } finally {
    db.close();
  }
});

it("leaves the active record unchanged when writing the sidecar hits quota", async () => {
  const db = await openDb();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const base = {
      tripId: "trip",
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array(12).buffer,
      aad: new Uint8Array([2]).buffer,
      candidateKey: key,
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    await prototypeWriteWithSidecar(db, "first", base);
    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      await expect(
        prototypeWriteWithSidecar(db, "second", {
          ...base,
          ciphertext: new Uint8Array([9]).buffer,
        }),
      ).rejects.toThrow();
    } finally {
      add.mockRestore();
    }
    expect(
      new Uint8Array(
        (await get<{ ciphertext: ArrayBuffer }>(db, "manifests", "trip")).ciphertext,
      )[0],
    ).toBe(1);
    expect(await get(db, "keys", prototypeSidecarKey("first"))).toBeDefined();
    expect(await get(db, "keys", prototypeSidecarKey("second"))).toBeUndefined();
  } finally {
    db.close();
  }
});

it("exposes that a legacy whole-key-store purge also removes the sidecar", async () => {
  const db = await openDb();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await prototypeWriteWithSidecar(db, "first", {
      tripId: "trip",
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array(12).buffer,
      aad: new Uint8Array([2]).buffer,
      candidateKey: key,
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    expect(await get(db, "keys", prototypeSidecarKey("first"))).toBeUndefined();
    expect(await get(db, "manifests", "trip")).toBeDefined();
  } finally {
    db.close();
  }
});
