import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { crewRollCallSchema, rollCallSchema } from "./roll-call-causal-fields";

const subjectId = "10000000-0000-4000-8000-000000000001";

it("accepts a delayed explicit individual physical observation and preserves its audit instant", () => {
  const observedAt = new Date(nowDate().getTime() - 60_000).toISOString();
  expect(
    rollCallSchema.parse({
      bookingId: subjectId,
      status: "boarded",
      observedAt,
      physicalPresenceOnly: "true",
      meetingDay: "0",
    }),
  ).toMatchObject({ observedAt, physicalPresenceOnly: true, meetingDay: 0 });
  expect(
    crewRollCallSchema.parse({ personId: subjectId, status: "boarded", observedAt }),
  ).toMatchObject({ observedAt });
});

it("refuses invalid and future selected observation times", () => {
  for (const observedAt of [
    "not-an-instant",
    new Date(nowDate().getTime() + 60_000).toISOString(),
  ]) {
    expect(
      rollCallSchema.safeParse({ bookingId: subjectId, status: "boarded", observedAt }).success,
    ).toBe(false);
    expect(
      crewRollCallSchema.safeParse({ personId: subjectId, status: "boarded", observedAt }).success,
    ).toBe(false);
  }
});
