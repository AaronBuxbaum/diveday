import { and, eq, inArray, isNull } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DrillKind } from "@/lib/safety-drills";
import type { DbExecutor } from "./client";
import { people, personRoles, safetyDrillParticipants, safetyDrills, shops } from "./schema";

const PRACTICES = [
  {
    kind: "oxygen",
    daysAgo: 1,
    note: "Crew practiced assembling the oxygen kit and handing over to emergency services.",
  },
  {
    kind: "missing_diver",
    daysAgo: 7,
    note: "Crew rehearsed the missing-diver response and radio call at the dock.",
  },
  {
    kind: "overboard",
    daysAgo: 14,
    note: "Crew practiced lookout, throw-line recovery and ladder assistance with a training float.",
  },
  {
    kind: "fire",
    daysAgo: 28,
    note: "Crew walked through alarm, isolation and evacuation roles using training equipment.",
  },
] as const satisfies readonly { kind: DrillKind; daysAgo: number; note: string }[];

/** Fictional routine practice only; no incidents, readiness or boarding facts are invented. */
export async function seedSafetyDrills(db: DbExecutor, shopId: string) {
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (!shop) return;
  const staff = await db
    .select({ id: people.id, role: personRoles.role })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    );
  const recorder = staff.find((member) => member.role === "owner")?.id;
  if (!recorder) return;
  const participants = [...new Set(staff.map((member) => member.id))];
  const today = calendarDateInTimezone(nowDate(), shop.timezone);
  for (const practice of PRACTICES) {
    const note = `Fictional demo drill. ${practice.note}`;
    const [existing] = await db
      .select({ id: safetyDrills.id })
      .from(safetyDrills)
      .where(
        and(
          eq(safetyDrills.shopId, shopId),
          eq(safetyDrills.kind, practice.kind),
          eq(safetyDrills.note, note),
        ),
      )
      .limit(1);
    if (existing) continue;
    const [drill] = await db
      .insert(safetyDrills)
      .values({
        shopId,
        kind: practice.kind,
        heldOn: shiftCalendarDate(today, -practice.daysAgo),
        note,
        recordedByPersonId: recorder,
        recordedAt: nowDate(),
      })
      .returning({ id: safetyDrills.id });
    if (!drill) throw new Error("demo drill insert returned no row");
    await db
      .insert(safetyDrillParticipants)
      .values(participants.map((personId) => ({ shopId, drillId: drill.id, personId })));
  }
}
