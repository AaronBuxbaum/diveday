import { describe, expect, it } from "vitest";
import { CARD_UNDO_WINDOW_MS, cardUndoCutoff, cardUndoRefusal } from "./card-undo";

const now = new Date("2031-06-14T09:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

/** Issue #3701: only a staffer's own delete, and only for 15 minutes. */
describe("cardUndoRefusal", () => {
  it("allows a staff delete up to and including the window's edge", () => {
    expect(cardUndoRefusal({ deletedAt: ago(0), deletionKind: "staff" }, now)).toBeNull();
    expect(
      cardUndoRefusal({ deletedAt: ago(CARD_UNDO_WINDOW_MS), deletionKind: "staff" }, now),
    ).toBeNull();
  });

  it("refuses a staff delete one millisecond past the window", () => {
    expect(
      cardUndoRefusal({ deletedAt: ago(CARD_UNDO_WINDOW_MS + 1), deletionKind: "staff" }, now),
    ).toBe("undo_expired");
  });

  it("refuses a system archive, and a row that does not say, however recent", () => {
    for (const deletionKind of ["system", null] as const) {
      expect(cardUndoRefusal({ deletedAt: ago(0), deletionKind }, now)).toBe("system_archived");
    }
  });

  it("puts the write's guard at the same edge as the rule", () => {
    expect(cardUndoCutoff(now)).toEqual(ago(CARD_UNDO_WINDOW_MS));
    expect(CARD_UNDO_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
