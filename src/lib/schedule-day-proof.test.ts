import { expect, it } from "vitest";
import { signDayWindows, verifyDayWindows } from "./schedule-day-proof";

it("binds a shop, departure, day, zone and every leg boundary", () => {
  const windows = [
    { startsAt: new Date("2035-08-04T08:00:00Z"), endsAt: new Date("2035-08-04T12:00:00Z") },
  ];
  const proof = signDayWindows("shop", "trip", "2035-08-04", "UTC", windows);
  expect(verifyDayWindows(proof, "shop", "trip", "2035-08-04", "UTC", windows)).toBe(true);
  expect(verifyDayWindows(proof, "other", "trip", "2035-08-04", "UTC", windows)).toBe(false);
  expect(
    verifyDayWindows(proof, "shop", "trip", "2035-08-04", "UTC", [
      { startsAt: new Date("2035-08-04T08:00:00Z"), endsAt: new Date("2035-08-04T13:00:00Z") },
    ]),
  ).toBe(false);
  expect(verifyDayWindows("forged", "shop", "trip", "2035-08-04", "UTC", windows)).toBe(false);
  const second = {
    startsAt: new Date("2035-08-05T08:00:00Z"),
    endsAt: new Date("2035-08-05T12:00:00Z"),
  };
  const multi = signDayWindows("shop", "trip", "2035-08-04", "UTC", [...windows, second]);
  expect(verifyDayWindows(multi, "shop", "trip", "2035-08-04", "UTC", [second, ...windows])).toBe(
    true,
  );
  expect(
    verifyDayWindows(multi, "shop", "trip", "2035-08-04", "UTC", [
      ...windows,
      { ...second, endsAt: new Date("2035-08-05T13:00:00Z") },
    ]),
  ).toBe(false);
});
