import { describe, expect, it } from "vitest";
import { type CrewNoticeRow, netCrewNotices } from "./crew-notices";

const A = "trip-a";
const B = "trip-b";

function rows(...entries: [string, CrewNoticeRow["change"]][]): CrewNoticeRow[] {
  return entries.map(([tripId, change], index) => ({ tripId, change, seq: index + 1 }));
}

describe("netCrewNotices", () => {
  it("tells a person they are on a departure they were put on", () => {
    expect(netCrewNotices(rows([A, "assigned"]))).toEqual([{ tripId: A, change: "assigned" }]);
  });

  it("tells a person they are off a departure they were taken off", () => {
    expect(netCrewNotices(rows([A, "removed"]))).toEqual([{ tripId: A, change: "removed" }]);
  });

  it("says nothing about an assign that was undone before it settled", () => {
    expect(netCrewNotices(rows([A, "assigned"], [A, "removed"]))).toEqual([]);
  });

  it("says nothing about a remove that was undone before it settled", () => {
    expect(netCrewNotices(rows([A, "removed"], [A, "assigned"]))).toEqual([]);
  });

  it("reads the order from seq, not from the order rows arrive in", () => {
    const shuffled: CrewNoticeRow[] = [
      { tripId: A, change: "removed", seq: 2 },
      { tripId: A, change: "assigned", seq: 1 },
      { tripId: A, change: "assigned", seq: 3 },
    ];
    expect(netCrewNotices(shuffled)).toEqual([{ tripId: A, change: "assigned" }]);
  });

  it("keeps each departure's news apart, so a copied week is one list", () => {
    expect(netCrewNotices(rows([A, "assigned"], [B, "assigned"]))).toEqual([
      { tripId: A, change: "assigned" },
      { tripId: B, change: "assigned" },
    ]);
  });

  it("says an approved ask that put them on the boat as an approval, once", () => {
    expect(netCrewNotices(rows([A, "request_approved"], [A, "assigned"]))).toEqual([
      { tripId: A, change: "request_approved" },
    ]);
  });

  it("says nothing about a bare approval, because the assignment it ran says the rest", () => {
    expect(netCrewNotices(rows([A, "request_approved"]))).toEqual([]);
  });

  it("tells the asker when the boat refused the approval, not that it was approved", () => {
    expect(netCrewNotices(rows([A, "request_approved"], [A, "request_refused"]))).toEqual([
      { tripId: A, change: "request_refused" },
    ]);
  });

  it("says a role change to somebody who stayed aboard", () => {
    expect(netCrewNotices(rows([A, "role_changed"]))).toEqual([
      { tripId: A, change: "role_changed" },
    ]);
  });

  it("folds a role change into the assignment it followed", () => {
    expect(netCrewNotices(rows([A, "assigned"], [A, "role_changed"]))).toEqual([
      { tripId: A, change: "assigned" },
    ]);
  });

  it("says nothing about a role change on a departure they then left", () => {
    expect(netCrewNotices(rows([A, "role_changed"], [A, "removed"]))).toEqual([
      { tripId: A, change: "removed" },
    ]);
  });

  it("tells the crew a departure was called off, whatever came before it", () => {
    expect(netCrewNotices(rows([A, "assigned"], [A, "called_off"]))).toEqual([
      { tripId: A, change: "called_off" },
    ]);
    expect(netCrewNotices(rows([A, "role_changed"], [A, "called_off"]))).toEqual([
      { tripId: A, change: "called_off" },
    ]);
  });

  it("lets a later assignment on a reinstated departure outrank its call-off", () => {
    expect(netCrewNotices(rows([A, "called_off"], [A, "removed"], [A, "assigned"]))).toEqual([]);
  });

  it("tells a person their ask was declined", () => {
    expect(netCrewNotices(rows([A, "request_declined"]))).toEqual([
      { tripId: A, change: "request_declined" },
    ]);
  });

  it("lets a later assignment outrank a decline on the same departure", () => {
    expect(netCrewNotices(rows([A, "request_declined"], [A, "assigned"]))).toEqual([
      { tripId: A, change: "assigned" },
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(netCrewNotices([])).toEqual([]);
  });
});
