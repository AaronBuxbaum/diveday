import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client";
import { people, personRoles, trips } from "../../db/schema";
import { createStaffShift } from "../../features/staffing/store";

export const standingCrewShiftsArgs = z.object({ title: z.string().min(1).max(120) }).strict();

/** Private test shop: two dedicated staff with a real shift on each materialized series date. */
export async function standingCrewShifts(db: AppDb, shopId: string, title: string) {
  const dates = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt, seriesId: trips.seriesId })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, title), isNull(trips.deletedAt)))
    .orderBy(trips.startsAt);
  if (
    dates.length < 3 ||
    !dates[0]?.seriesId ||
    dates.some((day) => day.seriesId !== dates[0]?.seriesId)
  )
    throw new Error("standing crew fixture needs one materialized series of at least three dates");
  for (const fullName of ["Alex Series", "Sam Series"]) {
    const [person] = await db
      // diveday:allow-person-insert: isolated test shop's dedicated series crew
      .insert(people)
      .values({ shopId, fullName })
      .returning();
    if (!person) throw new Error("standing crew fixture person missing");
    await db.insert(personRoles).values({ personId: person.id, role: "divemaster" });
    for (const day of dates) {
      const result = await createStaffShift(db, {
        shopId,
        personId: person.id,
        startsAt: day.startsAt,
        endsAt: day.endsAt,
      });
      if (!result.ok) throw new Error(`standing crew shift refused: ${result.reason}`);
    }
  }
  return { dates: dates.length };
}
