import { describe, expect, it } from "vitest";
import {
  decodeEmbedChoice,
  EMBED_SET_MAX,
  encodeEmbedChoice,
  normalizeEmbedSetMembers,
} from "./embed-sets";

const uuid = "9f1d0c1e-5b7a-4f31-8d2e-2f6c1a0b7e44";

describe("the embed choice codec", () => {
  it("round-trips a list and a single thing", () => {
    expect(decodeEmbedChoice(encodeEmbedChoice({ show: null, set: "set-1" }))).toEqual({
      show: null,
      set: "set-1",
    });
    expect(decodeEmbedChoice(encodeEmbedChoice({ show: uuid, set: null }))).toEqual({
      show: uuid,
      set: null,
    });
  });

  it("decodes a bare id as a show and never as a set", () => {
    // Every option that exists today carries a bare trip id or course slug, and
    // every snippet a shop already pasted carries one in `data-show`. Nothing
    // about that value may start meaning something else.
    expect(decodeEmbedChoice(uuid)).toEqual({ show: uuid, set: null });
    expect(decodeEmbedChoice("open-water")).toEqual({ show: "open-water", set: null });
  });

  it("reads an empty value as everything", () => {
    expect(decodeEmbedChoice("")).toEqual({ show: null, set: null });
    expect(encodeEmbedChoice({ show: null, set: null })).toBe("");
  });

  it("prefers the list when a choice somehow carries both", () => {
    expect(encodeEmbedChoice({ show: uuid, set: "set-1" })).toBe("set:set-1");
  });
});

describe("normalizeEmbedSetMembers", () => {
  it("trims, drops empties, and collapses duplicates keeping the first", () => {
    expect(normalizeEmbedSetMembers([" a ", "b", "", "a", "  "])).toEqual({
      ok: true,
      ids: ["a", "b"],
    });
  });

  it("refuses an empty list rather than storing one", () => {
    expect(normalizeEmbedSetMembers([])).toEqual({ ok: false, reason: "empty" });
    expect(normalizeEmbedSetMembers(["", "   "])).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses a list over the cap by its own name, never truncating it", () => {
    // Two refusals rather than one, because they are two different sentences
    // on screen: a dropped 25th boat with nothing said would leave the shop
    // looking at a saved list missing one thing and no explanation of which.
    const tooMany = Array.from({ length: EMBED_SET_MAX + 1 }, (_, index) => `trip-${index}`);
    expect(normalizeEmbedSetMembers(tooMany)).toEqual({ ok: false, reason: "too_many" });
    const atCap = normalizeEmbedSetMembers(tooMany.slice(0, EMBED_SET_MAX));
    expect(atCap.ok && atCap.ids).toHaveLength(EMBED_SET_MAX);
  });

  it("counts a list after the duplicates collapse, not before", () => {
    const withDupes = [
      ...Array.from({ length: EMBED_SET_MAX }, (_, index) => `trip-${index}`),
      "trip-0",
    ];
    const result = normalizeEmbedSetMembers(withDupes);
    expect(result.ok && result.ids).toHaveLength(EMBED_SET_MAX);
  });
});
