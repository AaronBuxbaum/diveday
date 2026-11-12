import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { recordCrewRollCall, recordRollCall } from "@/db/manifests";
import { listStaff } from "@/db/trips";
import { seedOperationalTrust } from "./operational-trust";

export const causalRollCallConflictArgs = z.object({ role: z.enum(["diver", "crew"]) }).strict();

/** Two independently observed statements, before either reporter saw the other. */
export async function seedCausalRollCallConflict(
  db: AppDb,
  shop: { id: string; timezone: string },
  { role }: z.output<typeof causalRollCallConflictArgs>,
  now: Date,
) {
  const fixture = await seedOperationalTrust(db, shop, "capacity", now);
  const [actor] = await listStaff(db, shop.id);
  const seat = fixture.seats[0];
  if (!actor || !seat) throw new Error("causal conflict fixture has no active recorder or seat");
  const evidenceIds: string[] = [];
  for (const status of ["boarded", "not_boarded"] as const) {
    const clientEventId = randomUUID();
    const common = {
      shopId: shop.id,
      tripId: fixture.tripId,
      recordedByPersonId: actor.person.id,
      checkpoint: "after_dive_1" as const,
      status,
      clientEventId,
      occurredAt: now,
      meetingDay: 0,
      observedEvidenceIds: [],
      note: status === "not_boarded" ? "Named missing evidence" : null,
    };
    const result =
      role === "diver"
        ? await recordRollCall(db, { ...common, bookingId: seat.bookingId })
        : await recordCrewRollCall(db, { ...common, personId: fixture.crewId });
    if (!result.ok) throw new Error(`causal conflict fixture refused: ${result.reason}`);
    evidenceIds.push(`client:${clientEventId}`);
  }
  return {
    role,
    tripId: fixture.tripId,
    bookingId: seat.bookingId,
    personId: role === "diver" ? seat.personId : fixture.crewId,
    fullName: role === "diver" ? seat.fullName : fixture.crewName,
    evidenceIds,
  };
}
