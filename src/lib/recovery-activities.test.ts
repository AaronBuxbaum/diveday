import { expect, it } from "vitest";
import { validRecoveryActivity } from "./recovery-activities";

it("requires bounded whole places, a future complete time range and usable meeting facts", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  const valid = {
    title: "Reef photography",
    location: "Shop classroom",
    startsAt: new Date("2030-01-02T10:00:00Z"),
    endsAt: new Date("2030-01-02T11:00:00Z"),
    capacity: 8,
  };
  expect(validRecoveryActivity(valid, now)).toBe(true);
  for (const capacity of [0, -1, 1.5, 501, NaN, Infinity])
    expect(validRecoveryActivity({ ...valid, capacity }, now)).toBe(false);
  expect(validRecoveryActivity({ ...valid, startsAt: now }, now)).toBe(false);
  expect(validRecoveryActivity({ ...valid, endsAt: valid.startsAt }, now)).toBe(false);
  expect(validRecoveryActivity({ ...valid, startsAt: new Date("bad") }, now)).toBe(false);
  expect(validRecoveryActivity({ ...valid, title: "  " }, now)).toBe(false);
  expect(validRecoveryActivity({ ...valid, location: "  " }, now)).toBe(false);
});
