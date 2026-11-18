// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openExperimentalJournal } from "./encrypted-journal";

const databases: string[] = [];
function name() {
  const value = `test-evidence-journal-${crypto.randomUUID()}`;
  databases.push(value);
  return value;
}

async function mutateKey(dbName: string, change: (store: IDBObjectStore) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      change(tx.objectStore("keys"));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    databases.splice(0).map(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(db);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("database remains open"));
        }),
    ),
  );
});

describe("inert encrypted journal experiment", () => {
  it("elects one key for concurrent first writers and retains two distinct observations after reopen", async () => {
    const db = name();
    const [a, b] = await Promise.all([openExperimentalJournal(db), openExperimentalJournal(db)]);
    try {
      const [one, two] = await Promise.all([
        a.append({
          tenant: "shop-a",
          id: "tap-1",
          original: { snapshot: "before-reset", note: "first" },
        }),
        b.append({
          tenant: "shop-a",
          id: "tap-2",
          original: { snapshot: "before-reset", note: "second" },
        }),
      ]);
      expect(one).toBe("committed");
      expect(two).toBe("committed");
    } finally {
      a.close();
      b.close();
    }
    const reopened = await openExperimentalJournal(db);
    try {
      expect(await reopened.inspectForTest("shop-a", "tap-1")).toMatchObject({
        original: { snapshot: "before-reset", note: "first" },
      });
      expect(await reopened.inspectForTest("shop-a", "tap-2")).toMatchObject({
        original: { snapshot: "before-reset", note: "second" },
      });
      expect(await reopened.inspectForTest("shop-b", "tap-1")).toBeNull();
    } finally {
      reopened.close();
    }
  });

  it("rejects reused IDs without replacing the first intent", async () => {
    const journal = await openExperimentalJournal(name());
    try {
      expect(
        await journal.append({ tenant: "shop-a", id: "tap-1", original: { status: "aboard" } }),
      ).toBe("committed");
      expect(
        await journal.append({ tenant: "shop-a", id: "tap-1", original: { status: "missing" } }),
      ).toBe("conflict");
      expect(await journal.inspectForTest("shop-a", "tap-1")).toMatchObject({
        original: { status: "aboard" },
      });
    } finally {
      journal.close();
    }
  });

  it("does not create a replacement key when ciphertext exists without its key", async () => {
    const db = name();
    const journal = await openExperimentalJournal(db);
    expect(
      await journal.append({ tenant: "shop-a", id: "tap-1", original: { status: "aboard" } }),
    ).toBe("committed");
    journal.close();
    await mutateKey(db, (keys) => keys.delete("current"));
    await expect(openExperimentalJournal(db)).rejects.toThrow();
  });

  it("refuses an append by a stale key generation", async () => {
    const db = name();
    const journal = await openExperimentalJournal(db);
    try {
      await mutateKey(db, (keys) => {
        const get = keys.get("current");
        get.onsuccess = () => keys.put({ ...get.result, generation: "replaced" }, "current");
      });
      expect(
        await journal.append({ tenant: "shop-a", id: "tap-1", original: { status: "aboard" } }),
      ).toBe("unavailable");
      expect(await journal.inspectForTest("shop-a", "tap-1")).toBeNull();
    } finally {
      journal.close();
    }
  });

  it("does not acknowledge an add whose transaction subsequently aborts", async () => {
    const journal = await openExperimentalJournal(name());
    try {
      const add = IDBObjectStore.prototype.add;
      const intercepted = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (
        this: IDBObjectStore,
        ...args
      ) {
        const request = add.apply(this, args);
        if (this.name === "events")
          request.addEventListener("success", () => this.transaction.abort());
        return request;
      });
      expect(
        await journal.append({ tenant: "shop-a", id: "tap-1", original: { status: "aboard" } }),
      ).toBe("unavailable");
      intercepted.mockRestore();
      expect(await journal.inspectForTest("shop-a", "tap-1")).toBeNull();
    } finally {
      journal.close();
    }
  });

  it("reports encryption failure without changing a previously committed event", async () => {
    const journal = await openExperimentalJournal(name());
    try {
      expect(
        await journal.append({ tenant: "shop-a", id: "tap-1", original: { status: "aboard" } }),
      ).toBe("committed");
      const encrypt = vi
        .spyOn(crypto.subtle, "encrypt")
        .mockRejectedValueOnce(new Error("encryption failed"));
      expect(
        await journal.append({ tenant: "shop-a", id: "tap-2", original: { status: "missing" } }),
      ).toBe("unavailable");
      encrypt.mockRestore();
      expect(await journal.inspectForTest("shop-a", "tap-1")).toMatchObject({
        original: { status: "aboard" },
      });
      expect(await journal.inspectForTest("shop-a", "tap-2")).toBeNull();
    } finally {
      journal.close();
    }
  });

  it("uses capture-time tenant, event ID and evidence when the caller mutates during encryption", async () => {
    const journal = await openExperimentalJournal(name());
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      started = resolve;
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(async (...args) => {
      started();
      await gate;
      return encrypt(...args);
    });
    const entry = { tenant: "shop-a", id: "tap-1", original: { status: "aboard" } };
    const pending = journal.append(entry);
    try {
      await blocked;
      entry.tenant = "shop-b";
      entry.id = "tap-2";
      entry.original.status = "missing";
      release();
      expect(await pending).toBe("committed");
      spy.mockRestore();
      expect(await journal.inspectForTest("shop-a", "tap-1")).toMatchObject({
        original: { status: "aboard" },
      });
      expect(await journal.inspectForTest("shop-b", "tap-2")).toBeNull();
    } finally {
      release();
      await pending;
      journal.close();
    }
  });

  it.each([undefined, NaN, Infinity, -0, { absent: undefined }, [1, undefined]])(
    "refuses a lossy JSON observation",
    async (original) => {
      const journal = await openExperimentalJournal(name());
      try {
        expect(await journal.append({ tenant: "shop-a", id: "tap-1", original })).toBe(
          "unavailable",
        );
        expect(await journal.inspectForTest("shop-a", "tap-1")).toBeNull();
      } finally {
        journal.close();
      }
    },
  );
});
