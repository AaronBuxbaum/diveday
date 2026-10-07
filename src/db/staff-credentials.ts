import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type { RatingCredential } from "@/lib/crew-roles";
import { type DbExecutor, isUniqueConstraintViolation } from "./client";
import { people, personRoles, staffCredentialKind, staffCredentials } from "./schema";

/**
 * Every kind a staff credential can be filed as, read from the column itself
 * so the save form's validation cannot fall a kind behind the picker that
 * offers it (issue #1850: a hand-written list would have rendered "Assistant
 * Instructor rating" and refused to save it).
 */
export const STAFF_CREDENTIAL_KINDS = staffCredentialKind.enumValues;

/**
 * The shop's live staff credentials.
 *
 * `people.deleted_at` is filtered here and not only on the credential: a
 * staffer who leaves is deleted, not scrubbed, so without it their expiring
 * credentials went on being listed on `/staffing` and went on raising a row in
 * the Today queue for a person who no longer works there -- with no way to
 * clear it short of deleting each credential by hand.
 */
export async function listStaffCredentials(db: DbExecutor, shopId: string) {
  return db
    .select({ credential: staffCredentials, person: people })
    .from(staffCredentials)
    .innerJoin(people, eq(people.id, staffCredentials.personId))
    .where(
      and(
        eq(staffCredentials.shopId, shopId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(staffCredentials.deletedAt),
      ),
    )
    .orderBy(asc(people.fullName), asc(staffCredentials.renewsAt), asc(staffCredentials.name));
}

/**
 * Each person's live ratings, as much of each as currency needs — the input
 * `lapsedRungs` (src/lib/crew-roles.ts) reads to decide whether somebody on a
 * crew is still worth what their role says to the supervision ratio
 * (issue #1853).
 *
 * Every kind is returned and `lapsedRungs` picks the ratings out, so the one
 * list of which kind evidences which rung lives beside the rule that uses it.
 * A person absent from the map has nothing recorded, which is not a lapse.
 *
 * Read only by the supervision claim. The booking gate and the crew editor's
 * refusals never call this (H-59, docs/product/human-decisions.md).
 */
export async function ratingCredentialsByPerson(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Map<string, RatingCredential[]>> {
  const byPerson = new Map<string, RatingCredential[]>();
  if (personIds.length === 0) return byPerson;
  const rows = await db
    .select({
      personId: staffCredentials.personId,
      kind: staffCredentials.kind,
      renewsAt: staffCredentials.renewsAt,
    })
    .from(staffCredentials)
    .where(
      and(
        eq(staffCredentials.shopId, shopId),
        inArray(staffCredentials.personId, [...new Set(personIds)]),
        isNull(staffCredentials.deletedAt),
      ),
    );
  for (const row of rows) {
    const list = byPerson.get(row.personId) ?? [];
    list.push({ kind: row.kind, renewsAt: row.renewsAt });
    byPerson.set(row.personId, list);
  }
  return byPerson;
}

export async function createStaffCredential(
  db: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    kind: (typeof staffCredentials.$inferInsert)["kind"];
    name: string;
    issuingBody?: string | null;
    identifier?: string | null;
    issuedAt?: string | null;
    renewsAt?: string | null;
  },
) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shopId),
        isNull(people.deletedAt),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .limit(1);
  if (!person || (input.renewsAt && input.issuedAt && input.renewsAt < input.issuedAt)) return null;
  try {
    const [row] = await db
      .insert(staffCredentials)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        kind: input.kind,
        name: input.name,
        issuingBody: input.issuingBody ?? null,
        identifier: input.identifier ?? null,
        issuedAt: input.issuedAt ?? null,
        renewsAt: input.renewsAt ?? null,
        status: "pending",
        updatedAt: nowDate(),
      })
      .returning();
    return row ?? null;
  } catch (error) {
    // `staff_credentials_live_identity_unique` covers (shop, person, kind,
    // lower(identifier)) over live rows. Entering the same card number twice --
    // a double-submit, or a second staffer filing what is already on file --
    // used to escape as a 500 on the staffing page. A refusal, like every
    // other write in this repo: caught, never pre-checked, so two concurrent
    // submits cannot both pass a lookup and race the insert.
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

export async function reviewStaffCredential(
  db: DbExecutor,
  input: {
    shopId: string;
    credentialId: string;
    status: "pending" | "verified";
    reviewNote?: string | null;
    reviewedByPersonId: string;
  },
) {
  const [row] = await db
    .update(staffCredentials)
    .set({
      status: input.status,
      reviewNote: input.reviewNote ?? null,
      reviewedAt: nowDate(),
      reviewedByPersonId: input.reviewedByPersonId,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(staffCredentials.id, input.credentialId),
        eq(staffCredentials.shopId, input.shopId),
        isNull(staffCredentials.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteStaffCredential(
  db: DbExecutor,
  shopId: string,
  credentialId: string,
  deletedByPersonId: string,
) {
  const [row] = await db
    .update(staffCredentials)
    .set({
      deletedAt: nowDate(),
      deletedByPersonId,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(staffCredentials.id, credentialId),
        eq(staffCredentials.shopId, shopId),
        isNull(staffCredentials.deletedAt),
      ),
    )
    .returning({ id: staffCredentials.id });
  return Boolean(row);
}
