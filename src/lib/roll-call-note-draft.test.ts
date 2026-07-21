// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { clearNoteDraft, readNoteDraft, writeNoteDraft } from "./roll-call-note-draft";

const BOOKING = "00000000-0000-4000-8000-000000000001";

afterEach(() => localStorage.clear());

describe("roll-call note draft store", () => {
  it("round-trips a pending draft per booking and checkpoint", () => {
    writeNoteDraft(BOOKING, "departure", { value: "kit issue", pending: true });
    writeNoteDraft(BOOKING, "after_dive_1", { value: "seasick", pending: false });

    expect(readNoteDraft(BOOKING, "departure")).toEqual({ value: "kit issue", pending: true });
    expect(readNoteDraft(BOOKING, "after_dive_1")).toEqual({ value: "seasick", pending: false });
    // A different checkpoint is a different slot, never crossed.
    expect(readNoteDraft(BOOKING, "after_dive_2")).toBeNull();
  });

  it("clears a draft once it has synced", () => {
    writeNoteDraft(BOOKING, "departure", { value: "kit issue", pending: true });
    clearNoteDraft(BOOKING, "departure");
    expect(readNoteDraft(BOOKING, "departure")).toBeNull();
  });

  it("treats malformed stored data as no draft rather than throwing", () => {
    localStorage.setItem(`diveday:roll-call-note:v1:${BOOKING}:departure`, "{not json");
    expect(readNoteDraft(BOOKING, "departure")).toBeNull();
  });
});
