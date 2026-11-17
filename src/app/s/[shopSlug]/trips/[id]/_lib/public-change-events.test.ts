import { describe, expect, it } from "vitest";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { publicChangeEvents } from "./public-change-events";

const startsAt = new Date("2026-11-20T12:00:00Z");

function event(id: string, occurredAt: string): TripChangeEvent {
  return {
    id,
    tripId: "trip",
    kind: "meeting_point",
    source: "shop",
    beforeValue: null,
    afterValue: { meetingPoint: "Dock B" },
    occurredAt: new Date(occurredAt),
    seq: 1,
  } as TripChangeEvent;
}

const weekBefore = event("week", "2026-11-13T12:00:00Z");
const dayOf = event("day", "2026-11-20T06:00:00Z");

describe("publicChangeEvents", () => {
  it("shows a visitor with no booking nothing that changed days before the trip", () => {
    expect(publicChangeEvents([weekBefore], false, startsAt)).toEqual([]);
  });

  it("shows a visitor with no booking a change from the last 24 hours before departure", () => {
    expect(publicChangeEvents([weekBefore, dayOf], false, startsAt)).toEqual([dayOf]);
  });

  it("keeps the whole list for a diver the page knows has booked", () => {
    expect(publicChangeEvents([weekBefore, dayOf], true, startsAt)).toEqual([weekBefore, dayOf]);
  });
});
