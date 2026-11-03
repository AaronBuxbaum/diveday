import { describe, expect, it } from "vitest";
import { findRepeats, wordValues } from "./check-words.mjs";

const words = { busy: { saving: "Saving…" }, dismiss: { neverMind: "Never mind" } };

describe("check-words", () => {
  it("names a staff key that repeats a words value", () => {
    const repeats = findRepeats(words, { reviews: { saving: "Saving…", title: "Reviews" } });
    expect(repeats).toEqual([
      { id: "reviews:saving", value: "Saving…", owner: "words.busy.saving" },
    ]);
  });

  it("passes a bundle with no repeat, and nested keys count", () => {
    expect(findRepeats(words, { a: { b: { c: "Hello" } } })).toEqual([]);
    expect(findRepeats(words, { a: { b: { c: "Never mind" } } })).toHaveLength(1);
  });

  it("lets an exempt key keep its own spelling", () => {
    const exempt = new Map([["a:b", "agrees with its noun"]]);
    expect(findRepeats(words, { a: { b: "Saving…" } }, exempt)).toEqual([]);
  });

  it("indexes words by value", () => {
    expect(wordValues(words).get("Never mind")).toBe("words.dismiss.neverMind");
  });
});
