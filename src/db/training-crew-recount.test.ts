import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { charterContext } from "@/test/training-mark-context";
import { crewSubject } from "./roll-call-subject";
import { tripAssignments, tripScheduleDays } from "./schema";
import { seedRollCallEvidence } from "./seed-roll-call-evidence";
import { trustedCrewOfTrips } from "./training-mark-resolve";

const fileCtx = fileScopedShopContext();

it("does not count an instructor with an unresolved missing mark from an earlier day", async () => {
  const ctx = await charterContext(fileCtx);
  await ctx.db
    .delete(tripAssignments)
    .where(
      and(eq(tripAssignments.tripId, ctx.charter.id), eq(tripAssignments.personId, ctx.instructor)),
    );
  await ctx.db.insert(tripAssignments).values({
    tripId: ctx.charter.id,
    personId: ctx.instructor,
    tripRole: "instructor",
    assignedByPersonId: ctx.owner,
  });
  await ctx.db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, ctx.charter.id));
  const now = ctx.now.getTime();
  await ctx.db.insert(tripScheduleDays).values([
    {
      tripId: ctx.charter.id,
      dayNumber: 1,
      startsAt: new Date(now - 172_800_000),
      endsAt: new Date(now - 169_200_000),
    },
    {
      tripId: ctx.charter.id,
      dayNumber: 2,
      startsAt: new Date(now - 3_600_000),
      endsAt: new Date(now + 3_600_000),
    },
  ]);
  await seedRollCallEvidence(ctx.db, {
    shopId: ctx.shop.id,
    tripId: ctx.charter.id,
    ...crewSubject(ctx.instructor),
    recordedByPersonId: ctx.owner,
    status: "not_boarded",
    checkpoint: "after_dive_1",
    source: "offline",
    meetingDay: 0,
    occurredAt: new Date(now - 170_000_000),
  });
  vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1");
  try {
    const crew =
      (await trustedCrewOfTrips(ctx.db, ctx.shop.id, [ctx.charter.id])).get(ctx.charter.id) ?? [];
    expect(crew.some((member) => member.personId === ctx.instructor)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
