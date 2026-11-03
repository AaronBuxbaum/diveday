import { and, eq, sql } from "drizzle-orm";
import type { AppTransaction, DbExecutor } from "./client";
import {
  premergeCertifications,
  premergeNitroxCertifications,
  premergeSpecialtyCertifications,
} from "./schema-retired/premerge-cards";

/**
 * Deletes a shop's rows from the three card tables the ledger replaced (issue
 * #2722). They keep foreign keys to the shop's people for one release, so a
 * demo reset that deletes people has to clear them first. Specialty and nitrox
 * first: they point at the level card an agency check listed them from.
 */
export async function deletePremergeCards(db: DbExecutor, shopId: string): Promise<void> {
  await db
    .delete(premergeSpecialtyCertifications)
    .where(eq(premergeSpecialtyCertifications.shopId, shopId));
  await db
    .delete(premergeNitroxCertifications)
    .where(eq(premergeNitroxCertifications.shopId, shopId));
  await db.delete(premergeCertifications).where(eq(premergeCertifications.shopId, shopId));
}

/**
 * Erasure's reach into the same three tables: while they stay, they hold a copy
 * of every card, and a card number left there would outlive the request in a
 * table no screen reads. Redacts the number and notes and archives each row,
 * as erasure does on the ledger.
 */
export async function forgetPremergeCards(
  tx: AppTransaction,
  shopId: string,
  personId: string,
  now: Date,
): Promise<void> {
  const redacted = sql<string>`'redacted-' || gen_random_uuid()::text`;
  const shared = { identifier: redacted, reviewNote: null, importedFromLabel: null };
  await tx
    .update(premergeCertifications)
    .set({
      ...shared,
      declaredIdentifier: null,
      juniorStatus: null,
      juniorStatusVerifiedAt: null,
      juniorStatusVerifiedByPersonId: null,
      deletedAt: sql`coalesce(${premergeCertifications.deletedAt}, ${now})`,
    })
    .where(
      and(eq(premergeCertifications.shopId, shopId), eq(premergeCertifications.personId, personId)),
    );
  for (const table of [premergeSpecialtyCertifications, premergeNitroxCertifications]) {
    await tx
      .update(table)
      .set({ ...shared, deletedAt: sql`coalesce(${table.deletedAt}, ${now})` })
      .where(and(eq(table.shopId, shopId), eq(table.personId, personId)));
  }
}
