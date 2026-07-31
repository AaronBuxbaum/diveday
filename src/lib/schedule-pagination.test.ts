import { describe, expect, it } from "vitest";
import { decodeCursorStack, encodeCursorStack, popCursor, pushCursor } from "./schedule-pagination";

describe("schedule-pagination", () => {
  it("round-trips a stack through encode/decode", () => {
    const stack = ["cursorA", "", "cursorB"];
    expect(decodeCursorStack(encodeCursorStack(stack))).toEqual(stack);
  });

  it("decodes absent, empty, or malformed input to an empty stack", () => {
    expect(decodeCursorStack(undefined)).toEqual([]);
    expect(decodeCursorStack(null)).toEqual([]);
    expect(decodeCursorStack("")).toEqual([]);
    expect(decodeCursorStack("not-json")).toEqual([]);
    expect(decodeCursorStack(encodeURIComponent(JSON.stringify({ not: "an array" })))).toEqual([]);
    expect(decodeCursorStack(encodeURIComponent(JSON.stringify([1, 2])))).toEqual([]);
  });

  it("pushes the first page's cursor (undefined) as an empty-string marker", () => {
    expect(pushCursor([], undefined)).toEqual([""]);
    expect(pushCursor([""], "cursorA")).toEqual(["", "cursorA"]);
  });

  it("pops back to no previous page once the stack is empty", () => {
    expect(popCursor([])).toBeNull();
  });

  it("pops the most recent cursor and leaves the rest of the stack", () => {
    expect(popCursor(["", "cursorA"])).toEqual({ after: "cursorA", stack: [""] });
    expect(popCursor([""])).toEqual({ after: undefined, stack: [] });
  });

  it("round-trips forward then back to the same page", () => {
    let stack: string[] = [];
    // Page 1 (no cursor) -> page 2 (cursorA)
    stack = pushCursor(stack, undefined);
    // Page 2 (cursorA) -> page 3 (cursorB)
    stack = pushCursor(stack, "cursorA");
    expect(stack).toEqual(["", "cursorA"]);

    // Back from page 3 to page 2.
    const back1 = popCursor(stack);
    expect(back1).toEqual({ after: "cursorA", stack: [""] });

    // Back from page 2 to page 1.
    const back2 = popCursor(back1?.stack ?? []);
    expect(back2).toEqual({ after: undefined, stack: [] });

    // No page before page 1.
    expect(popCursor(back2?.stack ?? [])).toBeNull();
  });
});
