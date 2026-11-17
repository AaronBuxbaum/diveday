import { describe, expect, it } from "vitest";
import { findNumberedLists } from "./check-numbered-lists.mjs";

describe("check:numbered-lists", () => {
  it("refuses browser numbering", () => {
    const hits = findNumberedLists("a.tsx", '<ol className="list-decimal ps-5">');
    expect(hits).toHaveLength(1);
  });
  it("lets a bullet list and a plain ol through", () => {
    expect(
      findNumberedLists("a.tsx", '<ul className="list-disc ps-5"><ol className="grid">'),
    ).toEqual([]);
  });
  it("ignores a comment", () => {
    expect(findNumberedLists("a.tsx", " * never list-decimal")).toEqual([]);
  });
});
