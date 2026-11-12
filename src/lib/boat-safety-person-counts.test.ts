import { expect, it } from "vitest";
import { boatSafetyNotices } from "./boat-safety";

it("uses unique physical totals without exempting booked crew from passenger limits", () => {
  const notices = boatSafetyNotices({
    boat: {
      certifiedPassengers: 1,
      certifiedTotalPersons: 2,
      coiExpiresOn: null,
      inspectionDueOn: null,
      registrationExpiresOn: null,
      insuranceExpiresOn: null,
    },
    kit: [],
    kindsOnRegister: new Set(),
    passengers: { booked: 2, boarded: 2 },
    crew: { assigned: 1, boarded: 1 },
    persons: { booked: 2, boarded: 2 },
    onDate: "2026-07-21",
  });
  expect(notices.filter((notice) => notice.code === "over_total_persons")).toEqual([]);
  expect(notices).toContainEqual({
    code: "over_certificate",
    passengers: 2,
    limit: 1,
    counted: true,
  });
});
