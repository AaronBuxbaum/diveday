// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_RECENTS } from "@/lib/recent-refs";
import {
  forgetAllRecents,
  readRecents,
  recentsStorageKey,
  type StoredRecent,
  withRecent,
} from "./palette-recents";

const record = (id: string): StoredRecent => ({ key: `diver:${id}`, kind: "diver", id });

describe("withRecent", () => {
  it("puts the newest first, once, and keeps five", () => {
    let recents: StoredRecent[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f"]) recents = withRecent(recents, record(id));
    recents = withRecent(recents, record("c"));
    expect(recents.map((row) => row.id)).toEqual(["c", "f", "e", "d", "b"]);
    expect(recents).toHaveLength(MAX_RECENTS);
  });
});

describe("readRecents", () => {
  it("keeps only a kind and an id, so an older row with a name and contact line is dropped", () => {
    const key = recentsStorageKey("blue-mantis", "p-1");
    window.localStorage.setItem(
      key,
      JSON.stringify([
        { key: "diver:a", kind: "diver", label: "Ana", detail: "ana@x.example", href: "/shop/x" },
        { key: "diver:b", kind: "diver", id: "b" },
        { key: "diver:c", kind: "person", id: "c" },
      ]),
    );
    expect(readRecents(key)).toEqual([{ key: "diver:b", kind: "diver", id: "b" }]);
  });

  it("rewrites the stored value without the rows it dropped", () => {
    const key = recentsStorageKey("blue-mantis", "p-2");
    window.localStorage.setItem(
      key,
      JSON.stringify([
        { key: "diver:a", kind: "diver", label: "Ana", detail: "ana@x.example", href: "/shop/x" },
        { key: "diver:b", kind: "diver", id: "b" },
      ]),
    );
    readRecents(key);
    expect(window.localStorage.getItem(key)).toBe(
      JSON.stringify([{ key: "diver:b", kind: "diver", id: "b" }]),
    );
  });
});

describe("recentsStorageKey", () => {
  it("is one key per shop and per staffer", () => {
    expect(recentsStorageKey("blue-mantis", "p-1")).not.toBe(
      recentsStorageKey("blue-mantis", "p-2"),
    );
    expect(recentsStorageKey("a", "p-1")).not.toBe(recentsStorageKey("b", "p-1"));
  });
});

describe("forgetAllRecents", () => {
  it("clears every staffer's recents on the device and nothing else", () => {
    window.localStorage.setItem(recentsStorageKey("blue-mantis", "a"), "[]");
    window.localStorage.setItem(recentsStorageKey("reef-shop", "b"), "[]");
    window.localStorage.setItem("diveday.something-else", "kept");
    forgetAllRecents();
    expect(window.localStorage.getItem(recentsStorageKey("blue-mantis", "a"))).toBeNull();
    expect(window.localStorage.getItem(recentsStorageKey("reef-shop", "b"))).toBeNull();
    expect(window.localStorage.getItem("diveday.something-else")).toBe("kept");
  });
});
