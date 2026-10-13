import { describe, expect, it } from "vitest";
import { confirmationExtras } from "./confirmation-extras";

const shop = {
  name: "Blue Mantis",
  slug: "blue-mantis",
  currency: "usd",
  addressStreet: "100 Ocean Dr",
  addressLocality: "Key Largo",
  addressRegion: "FL",
  addressPostalCode: "33037",
  addressCountry: null,
};
const trip = {
  id: "4b1f6f5e-2c7d-4c47-9a35-0d5c1e3f7a21",
  startsAt: new Date("2026-09-01T13:00:00Z"),
  priceCents: 15_000,
  depositCents: 5_000,
  cancellationWindowHours: 48,
  meetingPointLabel: null,
  meetingPointAddress: null,
  arrivalLandmark: "  ",
  arrivalParkingNote: "Lot behind the shop",
};

/** Ux review 2026-10-11, items 4 and 5: one composer for both confirmation sends. */
describe("confirmationExtras", () => {
  it("carries where, the public calendar, the seat's money and the window", () => {
    expect(
      confirmationExtras({
        shop,
        trip,
        course: null,
        participantType: "diver",
        chargesOnline: true,
        origin: "https://diveday.example",
      }),
    ).toEqual({
      meetingPoint: {
        label: "Blue Mantis",
        address: "100 Ocean Dr, Key Largo, FL 33037",
        landmark: null,
        parking: "Lot behind the shop",
        mapQuery: expect.stringContaining("Blue Mantis"),
      },
      calendarUrl: `https://diveday.example/s/blue-mantis/trips/${trip.id}/calendar`,
      money: { due: "deposit", depositCents: 5_000, balanceCents: 10_000, currency: "usd" },
      freeCancellationUntil: new Date("2026-08-30T13:00:00Z"),
    });
  });

  it("carries what the party's card checkout settled, beside the seat's own line (#2447)", () => {
    expect(
      confirmationExtras({
        shop,
        trip,
        course: null,
        participantType: "diver",
        chargesOnline: true,
        origin: null,
        partyPaid: { amountCents: 63_180, currency: "usd", seats: 4 },
      }),
    ).toMatchObject({
      money: { due: "deposit" },
      partyPaid: { amountCents: 63_180, currency: "usd", seats: 4 },
    });
  });

  it("owes the whole seat at the shop when nothing went to a checkout", () => {
    expect(
      confirmationExtras({
        shop,
        trip,
        course: null,
        participantType: "diver",
        chargesOnline: false,
        origin: null,
      }),
    ).toMatchObject({ money: { due: "at_shop", amountCents: 15_000 } });
  });

  it("says nothing of money, window or calendar for a free seat with no policy and no origin", () => {
    const extras = confirmationExtras({
      shop,
      trip: { ...trip, priceCents: null, depositCents: null, cancellationWindowHours: null },
      course: null,
      participantType: "diver",
      chargesOnline: false,
      origin: null,
    });
    expect(Object.keys(extras)).toEqual(["meetingPoint"]);
  });
});
