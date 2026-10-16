import { describe, expect, it } from "vitest";
import { MAX_RECENTS, parseRecentParam, recentParam } from "./recent-refs";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("parseRecentParam", () => {
  it("reads back what the palette writes", () => {
    const refs = [
      { kind: "diver", id: id(1) },
      { kind: "order", id: id(2) },
    ] as const;
    expect(parseRecentParam(recentParam(refs))).toEqual(refs);
  });

  it("skips anything that is not a known kind and a uuid, and stops at the cap", () => {
    expect(parseRecentParam(`diver:x,person:${id(1)},trip:${id(2)}:extra,gear:${id(3)}`)).toEqual([
      { kind: "gear", id: id(3) },
    ]);
    const many = Array.from({ length: 9 }, (_, n) => `trip:${id(n)}`).join(",");
    expect(parseRecentParam(many)).toHaveLength(MAX_RECENTS);
    expect(parseRecentParam(null)).toEqual([]);
  });
});
