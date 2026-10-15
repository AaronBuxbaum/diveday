import { describe, expect, it } from "vitest";
import { MAX_RECENTS, type RecentRecord, recentsStorageKey, withRecent } from "./palette-recents";

const record = (id: string): RecentRecord => ({
  key: `diver:${id}`,
  kind: "diver",
  label: id,
  href: `/shop/s/divers/${id}`,
});

describe("withRecent", () => {
  it("puts the newest first, once, and keeps five", () => {
    let recents: RecentRecord[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f"]) recents = withRecent(recents, record(id));
    recents = withRecent(recents, record("c"));
    expect(recents.map((row) => row.label)).toEqual(["c", "f", "e", "d", "b"]);
    expect(recents).toHaveLength(MAX_RECENTS);
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
