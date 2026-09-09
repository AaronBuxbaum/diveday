import { describe, expect, it } from "vitest";
import { keptSheets } from "./kept-sheets";

/**
 * **One departure going missing must not cost the day its paper.**
 *
 * The race: a manager taps Delete on one of today's departures from the
 * schedule board while a captain's request to `/shop/<slug>/print` is in
 * flight, after the day's list of trip ids has been read and before that
 * trip's own readers run. The manifest page's reply to a trip that is gone is
 * `notFound()`, which throws — and inside a `Promise.all` beside eleven other
 * boats, that throw is the *document's* answer. The captain reaches for the
 * printer and gets a 404.
 *
 * That window cannot be staged in a browser, so the rule is a pure function
 * and this is its test.
 */
describe("keptSheets", () => {
  const ids = ["trip-a", "trip-b", "trip-c"];

  it("keeps every departure that resolved", () => {
    const results: PromiseSettledResult<string | null>[] = [
      { status: "fulfilled", value: "a" },
      { status: "fulfilled", value: "b" },
      { status: "fulfilled", value: "c" },
    ];
    expect(keptSheets(results, ids)).toEqual([
      { id: "trip-a", packet: "a" },
      { id: "trip-b", packet: "b" },
      { id: "trip-c", packet: "c" },
    ]);
  });

  it("drops a departure whose readers threw, and keeps the rest", () => {
    // `notFound()` from the composed manifest page — the deleted-mid-flight case.
    const results: PromiseSettledResult<string | null>[] = [
      { status: "fulfilled", value: "a" },
      { status: "rejected", reason: new Error("NEXT_HTTP_ERROR_FALLBACK;404") },
      { status: "fulfilled", value: "c" },
    ];
    expect(keptSheets(results, ids)).toEqual([
      { id: "trip-a", packet: "a" },
      { id: "trip-c", packet: "c" },
    ]);
  });

  it("drops a departure the packet itself declined to build", () => {
    // `TripPacket` returns null when its own overview read finds nothing —
    // the same absence, caught one step earlier.
    const results: PromiseSettledResult<string | null>[] = [
      { status: "fulfilled", value: null },
      { status: "fulfilled", value: "b" },
      { status: "fulfilled", value: "c" },
    ];
    expect(keptSheets(results, ids).map((sheet) => sheet.id)).toEqual(["trip-b", "trip-c"]);
  });

  it("keeps each sheet paired with its own departure after a gap", () => {
    // The id is read by index, so a dropped result must not shift the ones
    // after it onto the wrong departure's key.
    const results: PromiseSettledResult<string | null>[] = [
      { status: "rejected", reason: new Error("gone") },
      { status: "fulfilled", value: "b" },
      { status: "fulfilled", value: "c" },
    ];
    expect(keptSheets(results, ids)).toEqual([
      { id: "trip-b", packet: "b" },
      { id: "trip-c", packet: "c" },
    ]);
  });

  it("holds nothing when every departure is gone", () => {
    const results: PromiseSettledResult<string | null>[] = [
      { status: "rejected", reason: new Error("gone") },
      { status: "rejected", reason: new Error("gone") },
      { status: "rejected", reason: new Error("gone") },
    ];
    // The count in the sheet's header is this length, which is what tells a
    // captain holding page seven that a boat is missing from the stack.
    expect(keptSheets(results, ids)).toEqual([]);
  });
});
