import { and, eq, isNull } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb } from "./client";
import { publishManifestEventsForPerson } from "./manifest-events";
import { certificationJuniorReviews, certifications, people } from "./schema";

/** A staff sighting of the actual card wording, never an inference from a lookup or age. */
export async function recordJuniorCardStatus(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    certificationId: string;
    byPersonId: string;
    juniorStatus: "junior" | "full";
  },
): Promise<
  { ok: true } | { ok: false; reason: "not_found" | "not_authorized" | "not_verified" | "invalid" }
> {
  if (input.juniorStatus !== "junior" && input.juniorStatus !== "full")
    return { ok: false, reason: "invalid" };
  const result = await db.transaction(async (tx) => {
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.byPersonId);
    if (!roles || !isStaff(roles) || input.byPersonId === input.personId)
      return { ok: false, reason: "not_authorized" } as const;
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      )
      .for("no key update");
    if (!person) return { ok: false, reason: "not_found" } as const;
    const [card] = await tx
      .select({ id: certifications.id, status: certifications.status })
      .from(certifications)
      .where(
        and(
          eq(certifications.id, input.certificationId),
          eq(certifications.shopId, input.shopId),
          eq(certifications.personId, input.personId),
          isNull(certifications.deletedAt),
        ),
      )
      .for("no key update");
    if (!card) return { ok: false, reason: "not_found" } as const;
    if (card.status !== "verified") return { ok: false, reason: "not_verified" } as const;
    const at = nowDate();
    await tx
      .update(certifications)
      .set({
        juniorStatus: input.juniorStatus,
        juniorStatusVerifiedAt: at,
        juniorStatusVerifiedByPersonId: input.byPersonId,
      })
      .where(and(eq(certifications.id, card.id), eq(certifications.shopId, input.shopId)));
    await tx.insert(certificationJuniorReviews).values({
      shopId: input.shopId,
      personId: input.personId,
      certificationId: card.id,
      recordedByPersonId: input.byPersonId,
      juniorStatus: input.juniorStatus,
      recordedAt: at,
    });
    return { ok: true } as const;
  });
  if (result.ok) await publishManifestEventsForPerson(db, input.shopId, input.personId);
  return result;
}
