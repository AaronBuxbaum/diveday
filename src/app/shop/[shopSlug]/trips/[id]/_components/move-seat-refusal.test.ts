import { describe, expect, it } from "vitest";
import { moveSeatRefusalFor } from "./move-seat-refusal";
import type { SeatMove } from "./roster-model";
import { entry } from "./roster-test-fixtures";

const bookingId = "11111111-1111-4111-8111-111111111111";
const seat = entry(bookingId, "Guest");
const moveSeat: SeatMove = {
  action: () => {},
  departed: false,
  started: false,
  targets: [
    {
      id: "target",
      label: "Reef",
      seatsLeft: 0,
      startsAt: "2026-10-27T12:00:00Z",
      localDay: "2026-10-27",
      dayLabel: "Oct 27",
      timeLabel: "8:00 AM EDT",
    },
  ],
};
const input = {
  origin: bookingId,
  notice: { form: "roster", tone: "danger" as const, text: "Destination is now full" },
  roster: [seat],
  moveSeat,
  record: false,
};

describe("move refusal attribution", () => {
  it("keeps a stale-capacity refusal beside an editor still rendered for the actual seat", () => {
    expect(moveSeatRefusalFor(input)).toEqual({ bookingId, text: input.notice.text });
  });
  it.each([undefined, "not-an-id", "22222222-2222-4222-8222-222222222222"])(
    "keeps a global fallback for a missing, wrong or foreign origin %s",
    (origin) => {
      expect(moveSeatRefusalFor({ ...input, origin })).toBeUndefined();
    },
  );
  it("keeps the fallback when the seat or its editor no longer exists", () => {
    expect(moveSeatRefusalFor({ ...input, roster: [] })).toBeUndefined();
    expect(moveSeatRefusalFor({ ...input, moveSeat: undefined })).toBeUndefined();
    expect(
      moveSeatRefusalFor({ ...input, moveSeat: { ...moveSeat, targets: [] } }),
    ).toBeUndefined();
    expect(
      moveSeatRefusalFor({ ...input, moveSeat: { ...moveSeat, departed: true } }),
    ).toBeUndefined();
    expect(moveSeatRefusalFor({ ...input, record: true })).toBeUndefined();
  });
  it("keeps a fallback for held, checked-in and possibly aboard seats", () => {
    expect(
      moveSeatRefusalFor({
        ...input,
        roster: [
          {
            ...seat,
            booking: { ...seat.booking, identityUnconfirmedAt: new Date("2026-10-26T12:00:00Z") },
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      moveSeatRefusalFor({
        ...input,
        roster: [{ ...seat, booking: { ...seat.booking, status: "checked_in" } }],
      }),
    ).toBeUndefined();
    expect(
      moveSeatRefusalFor({ ...input, aboardAtSea: new Map([[bookingId, "aboard"]]) }),
    ).toBeUndefined();
  });
});
