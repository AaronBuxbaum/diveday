import { and, asc, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { people, staffCredentials } from "./schema";

export async function listStaffCredentials(db: DbExecutor, shopId: string) {
  return db
    .select({ credential: staffCredentials, person: people })
    .from(staffCredentials)
    .innerJoin(people, eq(people.id, staffCredentials.personId))
    .where(
      and(
        eq(staffCredentials.shopId, shopId),
        eq(people.shopId, shopId),
        isNull(staffCredentials.deletedAt),
      ),
    )
    .orderBy(asc(people.fullName), asc(staffCredentials.renewsAt), asc(staffCredentials.name));
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
    .where(
      and(eq(people.id, input.personId), eq(people.shopId, input.shopId), isNull(people.deletedAt)),
    )
    .limit(1);
  if (!person || (input.renewsAt && input.issuedAt && input.renewsAt < input.issuedAt)) return null;
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
