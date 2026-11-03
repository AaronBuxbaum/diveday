import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
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
