import { expect, it } from "vitest";
import { readUndoOffer } from "../features/undo/rules";

const trip = "ad7edead-0000-4000-8000-000000000001";
const record = "ad7edead-0000-4000-8000-000000000002";
it("accepts id-only trip Undo offers and refuses forged revision or mismatched fields", () => {
  expect(
    readUndoOffer({
      undo: "trip-conservation",
      undoTrip: trip,
      undoRecord: record,
      undoRevision: "2",
    }),
  ).toEqual({ undo: "trip-conservation", undoTrip: trip, undoRecord: record, undoRevision: "2" });
  expect(
    readUndoOffer({ undo: "course-teaching-note", undoTrip: trip, undoRevision: "3" }),
  ).toEqual({ undo: "course-teaching-note", undoTrip: trip, undoRevision: "3" });
  for (const undoRevision of [
    "0",
    "-1",
    "1.5",
    "2147483648",
    "99999999999999999999999999",
    "Infinity",
  ]) {
    expect(
      readUndoOffer({
        undo: "trip-conservation",
        undoTrip: trip,
        undoRecord: record,
        undoRevision,
      }),
    ).toBeNull();
    expect(
      readUndoOffer({ undo: "course-teaching-note", undoTrip: trip, undoRevision }),
    ).toBeNull();
  }
  expect(
    readUndoOffer({
      undo: "course-teaching-note",
      undoTrip: trip,
      undoRevision: "3",
      undoNote: record,
    }),
  ).toBeNull();
  expect(
    readUndoOffer({
      undo: "trip-conservation",
      undoTrip: "other-shop",
      undoRecord: record,
      undoRevision: "2",
    }),
  ).toBeNull();
});
