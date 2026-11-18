// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPerEventKeyExperiment } from "./per-event-key";

const names: string[] = [];

async function updateRecord(dbName: string, change: (store: IDBObjectStore) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      change(tx.objectStore("events"));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
function name() {
  const value = `test-evidence-per-event-${crypto.randomUUID()}`;
  names.push(value);
  return value;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    names.splice(0).map(
      (value) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(value);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("open connection"));
        }),
    ),
  );
});

describe("isolated per-event key experiment", () => {
  it("preserves both independently encrypted observations across concurrent writers and reopen", async () => {
    const db = name();
    const [a, b] = await Promise.all([
      openPerEventKeyExperiment(db),
      openPerEventKeyExperiment(db),
    ]);
    try {
      expect(
        await Promise.all([
          a.append("tenant-a", "id-1", "original one"),
          b.append("tenant-a", "id-2", "original two"),
        ]),
      ).toEqual(["committed", "committed"]);
    } finally {
      a.close();
      b.close();
    }
    const reopened = await openPerEventKeyExperiment(db);
    try {
      expect(await reopened.readForTest("tenant-a", "id-1")).toEqual({
        status: "readable",
        text: "original one",
      });
      expect(await reopened.readForTest("tenant-a", "id-2")).toEqual({
        status: "readable",
        text: "original two",
      });
      expect(await reopened.readForTest("tenant-b", "id-1")).toEqual({ status: "missing" });
    } finally {
      reopened.close();
    }
  });
  it("treats both identical and changed reused IDs as conflict and preserves the original", async () => {
    const j = await openPerEventKeyExperiment(name());
    try {
      expect(await j.append("tenant-a", "id-1", "original")).toBe("committed");
      expect(await j.append("tenant-a", "id-1", "original")).toBe("conflict");
      expect(await j.append("tenant-a", "id-1", "changed")).toBe("conflict");
      expect(await j.observeRetryForTest("tenant-a", "id-1", "original")).toBe("observed_match");
      expect(await j.observeRetryForTest("tenant-a", "id-1", "changed")).toBe("observed_mismatch");
      expect(await j.observeRetryForTest("tenant-b", "id-1", "original")).toBe("missing");
      expect(await j.readForTest("tenant-a", "id-1")).toEqual({
        status: "readable",
        text: "original",
      });
    } finally {
      j.close();
    }
  });

  it("commits only one of two simultaneous claims for the same tenant and ID", async () => {
    const db = name();
    const [a, b] = await Promise.all([
      openPerEventKeyExperiment(db),
      openPerEventKeyExperiment(db),
    ]);
    try {
      const outcomes = await Promise.all([
        a.append("tenant-a", "id-1", "first"),
        b.append("tenant-a", "id-1", "second"),
      ]);
      expect(outcomes.filter((value) => value === "committed")).toHaveLength(1);
      expect(outcomes.filter((value) => value === "conflict")).toHaveLength(1);
      expect(await a.readForTest("tenant-a", "id-1")).toEqual({
        status: "readable",
        text: outcomes[0] === "committed" ? "first" : "second",
      });
      expect(await b.append("tenant-b", "id-1", "other tenant")).toBe("committed");
      expect(await b.readForTest("tenant-b", "id-1")).toEqual({
        status: "readable",
        text: "other tenant",
      });
    } finally {
      a.close();
      b.close();
    }
  });
  it("never reports a commit when the add is aborted", async () => {
    const j = await openPerEventKeyExperiment(name());
    try {
      const add = IDBObjectStore.prototype.add;
      const spy = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (
        this: IDBObjectStore,
        ...args
      ) {
        const request = add.apply(this, args);
        request.addEventListener("success", () => this.transaction.abort());
        return request;
      });
      expect(await j.append("tenant-a", "id-1", "original")).toBe("unavailable");
      spy.mockRestore();
      expect(await j.readForTest("tenant-a", "id-1")).toEqual({ status: "missing" });
    } finally {
      j.close();
    }
  });

  it("keeps an unreadable record occupied when its key is lost", async () => {
    const db = name();
    const j = await openPerEventKeyExperiment(db);
    try {
      expect(await j.append("tenant-a", "id-1", "original")).toBe("committed");
      await updateRecord(db, (store) => {
        const get = store.get(["tenant-a", "id-1"]);
        get.onsuccess = () => store.put({ ...get.result, key: null }, ["tenant-a", "id-1"]);
      });
      expect(await j.readForTest("tenant-a", "id-1")).toEqual({ status: "unavailable" });
      expect(await j.observeRetryForTest("tenant-a", "id-1", "original")).toBe("unavailable");
      expect(await j.append("tenant-a", "id-1", "replacement")).toBe("conflict");
      expect(await j.readForTest("tenant-a", "id-1")).toEqual({ status: "unavailable" });
    } finally {
      j.close();
    }
  });

  it("cannot decrypt a copied record under a different tenant or event ID", async () => {
    const db = name();
    const j = await openPerEventKeyExperiment(db);
    try {
      expect(await j.append("tenant-a", "id-1", "original")).toBe("committed");
      await updateRecord(db, (store) => {
        const get = store.get(["tenant-a", "id-1"]);
        get.onsuccess = () => store.put(get.result, ["tenant-b", "id-2"]);
      });
      expect(await j.readForTest("tenant-b", "id-2")).toEqual({ status: "unavailable" });
      expect(await j.readForTest("tenant-a", "id-1")).toEqual({
        status: "readable",
        text: "original",
      });
    } finally {
      j.close();
    }
  });

  it("rejects text that UTF-8 would silently change", async () => {
    const j = await openPerEventKeyExperiment(name());
    try {
      expect(await j.append("tenant-a", "id-1", "\ud800")).toBe("unavailable");
      expect(await j.readForTest("tenant-a", "id-1")).toEqual({ status: "missing" });
    } finally {
      j.close();
    }
  });

  it("labels a match as an observation even if the record is deleted after the read", async () => {
    const db = name();
    const j = await openPerEventKeyExperiment(db);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      started = resolve;
    });
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(async (...args) => {
      started();
      await gate;
      return decrypt(...args);
    });
    let observation: Promise<string> | undefined;
    try {
      expect(await j.append("tenant-a", "id-1", "original")).toBe("committed");
      observation = j.observeRetryForTest("tenant-a", "id-1", "original");
      await blocked;
      await updateRecord(db, (store) => {
        store.delete(["tenant-a", "id-1"]);
      });
      release();
      expect(await observation).toBe("observed_match");
      spy.mockRestore();
      expect(await j.readForTest("tenant-a", "id-1")).toEqual({ status: "missing" });
    } finally {
      release();
      await observation;
      j.close();
    }
  });
});
