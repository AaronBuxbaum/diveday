import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type { RatingCredential } from "@/lib/crew-roles";
import type { DbExecutor } from "./client";
import { isUniqueConstraintViolation } from "./query-helpers";
import {
  people,
  personRoles,
  staffCredentialHistory,
  staffCredentialKind,
  staffCredentials,
} from "./schema";

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
 * refusals never call this (H-59, docs/product/human-decisions/README.md).
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

/** Lock the person before their credentials, matching erasure's order. */
async function lockCredentialOwner(db: DbExecutor, shopId: string, personId: string) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .for("no key update");
  if (!person) return false;
  const [role] = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(and(eq(personRoles.personId, personId), inArray(personRoles.role, [...STAFF_ROLES])))
    .limit(1);
  return Boolean(role);
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
    // In its own savepoint (a transaction when `db` is not one), so a refusal
    // rolls back only this insert and a caller's transaction stays usable: a
    // bare 23505 there aborts it (issue #2295, the #1769 pattern).
    const [row] = await db.transaction(async (savepoint) => {
      if (!(await lockCredentialOwner(savepoint, input.shopId, input.personId))) return [];
      const inserted = await savepoint
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
      if (inserted[0]) await recordCredentialState(savepoint, inserted[0], "created");
      return inserted;
    });
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

type CredentialRow = typeof staffCredentials.$inferSelect;
type CredentialEvent = "created" | "baseline" | "renewed" | "corrected" | "deleted";

async function recordCredentialState(db: DbExecutor, row: CredentialRow, event: CredentialEvent) {
  await db.insert(staffCredentialHistory).values({
    shopId: row.shopId,
    credentialId: row.id,
    event,
    kind: row.kind,
    issuedAt: row.issuedAt,
    renewsAt: row.renewsAt,
    active: event !== "deleted",
    recordedAt: nowDate(),
  });
}

async function ensureCredentialBaseline(db: DbExecutor, row: CredentialRow) {
  const [existing] = await db
    .select({ seq: staffCredentialHistory.seq })
    .from(staffCredentialHistory)
    .where(
      and(
        eq(staffCredentialHistory.shopId, row.shopId),
        eq(staffCredentialHistory.credentialId, row.id),
      ),
    )
    .limit(1);
  if (!existing) await recordCredentialState(db, row, "baseline");
}

/** Renewal and correction preserve the previous recorded state under the same card number. */
export async function changeStaffCredential(
  db: DbExecutor,
  input: {
    shopId: string;
    credentialId: string;
    expectedRevision: number;
    personId: string;
    kind: CredentialRow["kind"];
    name: string;
    issuingBody: string | null;
    identifier: string | null;
    issuedAt: string | null;
    renewsAt: string | null;
    change: "renewed" | "corrected";
  },
) {
  if (input.issuedAt && input.renewsAt && input.renewsAt < input.issuedAt) return null;
  if (input.change === "renewed" && (!input.issuedAt || !input.renewsAt)) return null;
  try {
    return await db.transaction(async (tx) => {
      if (!(await lockCredentialOwner(tx, input.shopId, input.personId))) return null;
      const [previous] = await tx
        .select()
        .from(staffCredentials)
        .where(
          and(
            eq(staffCredentials.id, input.credentialId),
            eq(staffCredentials.shopId, input.shopId),
            eq(staffCredentials.personId, input.personId),
            isNull(staffCredentials.deletedAt),
          ),
        )
        .for("update");
      if (!previous || previous.kind !== input.kind || previous.revision !== input.expectedRevision)
        return null;
      if (
        input.change === "renewed" &&
        previous.issuedAt &&
        input.issuedAt &&
        input.issuedAt <= previous.issuedAt
      )
        return null;
      await ensureCredentialBaseline(tx, previous);
      const [updated] = await tx
        .update(staffCredentials)
        .set({
          name: input.name,
          revision: previous.revision + 1,
          issuingBody: input.issuingBody,
          identifier: input.identifier,
          issuedAt: input.issuedAt,
          renewsAt: input.renewsAt,
          status: "pending",
          reviewNote: null,
          reviewedAt: null,
          reviewedByPersonId: null,
          updatedAt: nowDate(),
        })
        .where(and(eq(staffCredentials.id, previous.id), eq(staffCredentials.shopId, input.shopId)))
        .returning();
      if (!updated) return null;
      await recordCredentialState(tx, updated, input.change);
      return updated;
    });
  } catch (error) {
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
    expectedRevision?: number;
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
      revision: sql`${staffCredentials.revision} + 1`,
    })
    .where(
      and(
        eq(staffCredentials.id, input.credentialId),
        input.expectedRevision === undefined
          ? undefined
          : eq(staffCredentials.revision, input.expectedRevision),
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
  expectedRevision?: number,
) {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ personId: staffCredentials.personId })
      .from(staffCredentials)
      .where(and(eq(staffCredentials.id, credentialId), eq(staffCredentials.shopId, shopId)))
      .limit(1);
    if (!owner || !(await lockCredentialOwner(tx, shopId, owner.personId))) return false;
    const [previous] = await tx
      .select()
      .from(staffCredentials)
      .where(
        and(
          eq(staffCredentials.id, credentialId),
          eq(staffCredentials.shopId, shopId),
          isNull(staffCredentials.deletedAt),
        ),
      )
      .for("update");
    if (!previous || (expectedRevision !== undefined && previous.revision !== expectedRevision))
      return false;
    await ensureCredentialBaseline(tx, previous);
    const [row] = await tx
      .update(staffCredentials)
      .set({
        deletedAt: nowDate(),
        deletedByPersonId,
        updatedAt: nowDate(),
      })
      .where(and(eq(staffCredentials.id, credentialId), eq(staffCredentials.shopId, shopId)))
      .returning();
    if (!row) return false;
    await recordCredentialState(tx, row, "deleted");
    return true;
  });
}
