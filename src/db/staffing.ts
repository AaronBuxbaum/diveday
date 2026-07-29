import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import type { AppDb } from "./client";
import { courses, people, personRoles, staffShifts, tripAssignments, trips } from "./schema";
import { listStaff } from "./trips";

export type StaffCapability = "teach" | "crew" | "captain";

export function capabilitiesForRoles(roles: readonly string[]): StaffCapability[] {
  const capabilities: StaffCapability[] = [];
  if (roles.includes("instructor")) capabilities.push("teach");
  if (roles.some((role) => ["instructor", "divemaster", "captain", "crew"].includes(role))) {
    capabilities.push("crew");
  }
  if (roles.includes("captain")) capabilities.push("captain");
  return capabilities;
}

export type StaffingView = {
  from: Date;
  to: Date;
  staff: {
    person: typeof people.$inferSelect;
    roles: string[];
    capabilities: StaffCapability[];
    shifts: (typeof staffShifts.$inferSelect)[];
  }[];
  trips: {
    trip: typeof trips.$inferSelect;
    courseTitle: string | null;
    crew: { personId: string; name: string; roles: string[] }[];
    coveredByShift: boolean;
    gaps: string[];
  }[];
};

export async function getStaffingView(
  db: AppDb,
  shopId: string,
  from: Date,
  to: Date,
): Promise<StaffingView> {
  const [staffRows, shiftRows, tripRows] = await Promise.all([
    listStaff(db, shopId),
    db
      .select({ shift: staffShifts })
      .from(staffShifts)
      .innerJoin(people, eq(people.id, staffShifts.personId))
      .where(
        and(
          eq(staffShifts.shopId, shopId),
          lt(staffShifts.startsAt, to),
          gt(staffShifts.endsAt, from),
        ),
      )
      .orderBy(asc(staffShifts.startsAt)),
    db
      .select({
        trip: trips,
        courseTitle: courses.title,
        personId: tripAssignments.personId,
        personName: people.fullName,
        role: personRoles.role,
      })
      .from(trips)
      .leftJoin(courses, eq(courses.id, trips.courseId))
      .leftJoin(tripAssignments, eq(tripAssignments.tripId, trips.id))
      .leftJoin(people, eq(people.id, tripAssignments.personId))
      .leftJoin(personRoles, eq(personRoles.personId, tripAssignments.personId))
      .where(
        and(
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          lt(trips.startsAt, to),
          gt(trips.endsAt, from),
          isNull(people.deletedAt),
        ),
      )
      .orderBy(asc(trips.startsAt), asc(people.fullName)),
  ]);

  // `people.deleted_at is null` needs an explicit SQL predicate; keeping it out
  // of the nullable left join would turn an unassigned trip into no row.
  const activeTripRows = tripRows.filter((row) => row.personId === null || row.personName !== null);
  const shiftsByPerson = new Map<string, (typeof staffShifts.$inferSelect)[]>();
  for (const row of shiftRows) {
    const shifts = shiftsByPerson.get(row.shift.personId) ?? [];
    shifts.push(row.shift);
    shiftsByPerson.set(row.shift.personId, shifts);
  }
  const staff = staffRows.map((entry) => ({
    ...entry,
    capabilities: capabilitiesForRoles(entry.roles),
    shifts: shiftsByPerson.get(entry.person.id) ?? [],
  }));

  const tripMap = new Map<string, StaffingView["trips"][number]>();
  for (const row of activeTripRows) {
    const existing = tripMap.get(row.trip.id) ?? {
      trip: row.trip,
      courseTitle: row.courseTitle,
      crew: [],
      coveredByShift: false,
      gaps: [],
    };
    if (row.personId && row.personName) {
      const crew = existing.crew.find((member) => member.personId === row.personId);
      if (crew) {
        if (row.role && !crew.roles.includes(row.role)) crew.roles.push(row.role);
      } else {
        existing.crew.push({
          personId: row.personId,
          name: row.personName,
          roles: row.role ? [row.role] : [],
        });
      }
    }
    tripMap.set(row.trip.id, existing);
  }

  const tripsView = [...tripMap.values()].map((entry) => {
    const hasInstructor = entry.crew.some((member) => member.roles.includes("instructor"));
    const crewShifted = entry.crew.some((member) =>
      (shiftsByPerson.get(member.personId) ?? []).some(
        (shift) => shift.startsAt < entry.trip.endsAt && shift.endsAt > entry.trip.startsAt,
      ),
    );
    const gaps = [
      ...(entry.crew.length === 0 ? ["No crew assigned"] : []),
      ...(entry.courseTitle && !hasInstructor ? ["Course needs an instructor"] : []),
      ...(!crewShifted ? ["No working shift covers this trip"] : []),
    ];
    return { ...entry, coveredByShift: crewShifted, gaps };
  });

  return { from, to, staff, trips: tripsView };
}

export type CreateStaffShiftOutcome =
  | { ok: true; shift: typeof staffShifts.$inferSelect }
  | { ok: false; reason: "staff_not_found" | "overlap" | "invalid" };

export async function createStaffShift(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    startsAt: Date;
    endsAt: Date;
    note?: string | null;
    createdByPersonId?: string | null;
  },
): Promise<CreateStaffShiftOutcome> {
  if (input.endsAt <= input.startsAt) return { ok: false, reason: "invalid" };
  return db.transaction(async (tx) => {
    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };
    const [overlap] = await tx
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.shopId, input.shopId),
          eq(staffShifts.personId, input.personId),
          lt(staffShifts.startsAt, input.endsAt),
          gt(staffShifts.endsAt, input.startsAt),
        ),
      )
      .limit(1);
    if (overlap) return { ok: false, reason: "overlap" };
    const [shift] = await tx
      .insert(staffShifts)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note?.trim() || null,
        createdByPersonId: input.createdByPersonId ?? null,
      })
      .returning();
    if (!shift) return { ok: false, reason: "invalid" };
    return { ok: true, shift };
  });
}

export async function deleteStaffShift(
  db: AppDb,
  shopId: string,
  shiftId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(staffShifts)
    .where(and(eq(staffShifts.id, shiftId), eq(staffShifts.shopId, shopId)))
    .returning({ id: staffShifts.id });
  return deleted.length > 0;
}
