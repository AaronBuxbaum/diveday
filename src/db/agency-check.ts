import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { type AgencyCheckQuery, agencyCheckQuery } from "@/lib/agency-check";
import { needsImportConfirm } from "@/lib/certification-cards";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import type { AppDb } from "./client";
import { certifications, people } from "./schema";

/**
 * One level card the DiveDay browser extension may check with its agency
 * (H-105), and the lookup it would type: a live card on this live diver at
 * this shop that is still waiting for somebody to confirm it — pending, or an
 * import awaiting its confirm. An unsighted self-declaration is not one: its
 * agency is often unstated and its number is the diver's typing, so it keeps
 * the sighting form. Null for anything else, including a card that is not
 * this diver's.
 */
export async function certificationForAgencyCheck(
  db: AppDb,
  input: { shopId: string; personId: string; certificationId: string },
): Promise<{
  query: AgencyCheckQuery;
  level: (typeof certifications.$inferSelect)["level"];
} | null> {
  const [row] = await db
    .select({
      agency: certifications.agency,
      level: certifications.level,
      identifier: certifications.identifier,
      status: certifications.status,
      selfDeclaredAt: certifications.selfDeclaredAt,
      importedAt: certifications.importedAt,
      reviewedAt: certifications.reviewedAt,
      fullName: people.fullName,
      dateOfBirth: people.dateOfBirth,
    })
    .from(certifications)
    .innerJoin(people, eq(people.id, certifications.personId))
    .where(
      and(
        eq(certifications.id, input.certificationId),
        eq(certifications.shopId, input.shopId),
        eq(certifications.personId, input.personId),
        eq(people.shopId, input.shopId),
        isNull(certifications.deletedAt),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (isUnsightedSelfDeclaration(row)) return null;
  if (row.status !== "pending" && !needsImportConfirm(row)) return null;
  const query = agencyCheckQuery(row);
  return query ? { query, level: row.level } : null;
}

/**
 * Whether this card, on this diver at this shop, was certified by an agency
 * check: the one review the check's own Undo may take back.
 */
export async function isAgencyCheckedCard(
  db: AppDb,
  input: { shopId: string; personId: string; certificationId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: certifications.id })
    .from(certifications)
    .where(
      and(
        eq(certifications.id, input.certificationId),
        eq(certifications.shopId, input.shopId),
        eq(certifications.personId, input.personId),
        isNotNull(certifications.agencyCheckedAt),
        isNull(certifications.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
