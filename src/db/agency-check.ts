import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  type AgencyCheckQuery,
  agencyCheckQuery,
  isAgencyCheckableLevel,
} from "@/lib/agency-check";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
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
  /**
   * What the shop holds to tell this diver from a namesake, whichever the
   * lookup typed: DiveChek is searched by birth date, and the record must
   * carry the card's number too when it has one.
   */
  identity: { birthDate: string | null; cardNumber: string | null };
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
  const query = checkableQuery(row);
  if (!query) return null;
  return {
    query,
    level: row.level,
    identity: {
      birthDate:
        query.birthDate ??
        (row.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth) ? row.dateOfBirth : null),
      cardNumber: query.cardNumber ?? (row.identifier?.trim() || null),
    },
  };
}

/**
 * The one rule for "the extension may check this card", shared by the action
 * that judges a check and the lists that offer one, so a button is never drawn
 * for a card the action would refuse.
 */
function checkableQuery(row: {
  agency: (typeof certifications.$inferSelect)["agency"];
  level: (typeof certifications.$inferSelect)["level"];
  status: (typeof certifications.$inferSelect)["status"];
  identifier: string | null;
  selfDeclaredAt: Date | null;
  importedAt: Date | null;
  reviewedAt: Date | null;
  fullName: string;
  dateOfBirth: string | null;
}): AgencyCheckQuery | null {
  if (isUnsightedSelfDeclaration(row)) return null;
  // A pending divemaster or instructor card keeps its link: a pro rating is
  // checked on the agency's professional tool.
  if (!isAgencyCheckableLevel(row.level)) return null;
  if (row.status !== "pending" && !needsImportConfirm(row)) return null;
  return agencyCheckQuery(row);
}

/**
 * **Every card these divers hold that the extension could check**, keyed by
 * diver, oldest card first: the cards a departure's Divers tab and the Today
 * list offer to check, and the N of a departure's "Check all N". The same rule
 * as {@link certificationForAgencyCheck}, so nothing is offered that the
 * action would refuse. A diver with none is absent.
 */
export async function listAgencyCheckableCards(
  db: AppDb,
  input: { shopId: string; personIds: readonly string[] },
): Promise<Map<string, AgencyCheckableCard[]>> {
  const byPerson = new Map<string, AgencyCheckableCard[]>();
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) return byPerson;
  const rows = await db
    .select({
      certificationId: certifications.id,
      personId: certifications.personId,
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
        eq(certifications.shopId, input.shopId),
        inArray(certifications.personId, personIds),
        eq(people.shopId, input.shopId),
        isNull(certifications.deletedAt),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        // Narrowed again by `checkableQuery`; this only keeps settled cards out of the read.
        or(eq(certifications.status, "pending"), isNotNull(certifications.importedAt)),
      ),
    )
    .orderBy(
      asc(certifications.createdAt),
      asc(certifications.agency),
      asc(certifications.level),
      asc(certifications.id),
    );
  for (const row of rows) {
    const query = checkableQuery(row);
    if (!query) continue;
    const cards = byPerson.get(row.personId) ?? [];
    cards.push({
      certificationId: row.certificationId,
      personId: row.personId,
      fullName: row.fullName,
      agency: query.agency,
      query,
    });
    byPerson.set(row.personId, cards);
  }
  return byPerson;
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
