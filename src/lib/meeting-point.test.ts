import { describe, expect, it } from "vitest";
import {
  meetingPointForMessage,
  meetingPointLine,
  meetingPointMoved,
  meetingPointOf,
} from "./meeting-point";

const shopAddress = {
  street: "1 Harbor Rd",
  locality: "Key Largo",
  region: "FL",
  postalCode: "33037",
  country: "US",
};

const none = {
  meetingPointLabel: null,
  meetingPointAddress: null,
  arrivalLandmark: null,
  arrivalParkingNote: null,
};

describe("meetingPointOf (ux review 2026-10-11, items 4 and 27)", () => {
  it("falls back to the shop's own name and address when the departure names none", () => {
    expect(meetingPointOf({ shopName: "Blue Mantis", shopAddress, ...none })).toEqual({
      label: "Blue Mantis",
      address: "1 Harbor Rd, Key Largo, FL 33037, US",
      landmark: null,
      parking: null,
      mapQuery: "Blue Mantis, 1 Harbor Rd, Key Largo, FL 33037, US",
    });
  });

  it("uses the departure's own meeting point, landmark and parking when it has them", () => {
    expect(
      meetingPointOf({
        shopName: "Blue Mantis",
        shopAddress,
        meetingPointLabel: " Pennekamp Marina ",
        meetingPointAddress: "102601 Overseas Hwy",
        arrivalLandmark: "The blue awning",
        arrivalParkingNote: "Lot B, free before 8",
      }),
    ).toEqual({
      label: "Pennekamp Marina",
      address: "102601 Overseas Hwy",
      landmark: "The blue awning",
      parking: "Lot B, free before 8",
      mapQuery: "Pennekamp Marina, 102601 Overseas Hwy",
    });
  });

  it("builds no map query it cannot make honest", () => {
    const point = meetingPointOf({
      shopName: "Blue Mantis",
      shopAddress: { street: null, locality: null, region: null, postalCode: null, country: null },
      ...none,
      meetingPointLabel: "Dock 4",
    });
    expect(point.mapQuery).toBeNull();
    expect(point.address).toBeNull();
  });
});

describe("meetingPointMoved", () => {
  it("is the label or the address, never the help finding them", () => {
    const before = meetingPointOf({ shopName: "Blue Mantis", shopAddress, ...none });
    expect(meetingPointMoved(before, { ...before, landmark: "Flag" })).toBe(false);
    expect(meetingPointMoved(before, { ...before, label: "Dock 4" })).toBe(true);
    expect(meetingPointMoved(before, { ...before, address: "2 Harbor Rd" })).toBe(true);
  });
});

describe("meetingPointForMessage", () => {
  it("clips a long note rather than letting it fail the message", () => {
    const point = meetingPointForMessage({
      label: "Dock",
      address: null,
      landmark: null,
      parking: "x".repeat(2_000),
      mapQuery: null,
    });
    expect(point.parking).toHaveLength(600);
  });
});

describe("meetingPointLine", () => {
  const point = (label: string, address: string | null) => ({
    label,
    address,
    landmark: null,
    parking: null,
    mapQuery: null,
  });

  it("names the place, then its address", () => {
    expect(meetingPointLine(point("Slip 4, the east dock", "12 Ocean Way"))).toBe(
      "Slip 4, the east dock · 12 Ocean Way",
    );
  });

  it("names the place alone when there is no address to give", () => {
    expect(meetingPointLine(point("North Jetty", null))).toBe("North Jetty");
  });
});
