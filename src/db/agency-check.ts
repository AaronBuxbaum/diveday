import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  type AgencyCheckQuery,
  type AgencyListedKind,
  agencyCheckQuery,
  isAgencyCheckableLevel,
} from "@/lib/agency-check";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import { needsImportConfirm } from "@/lib/certification-cards";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import type { AppDb, DbExecutor } from "./client";
import { isUniqueConstraintViolation, queryAll } from "./query-helpers";
import {
  type CertificationAgency,
  certifications,
  nitroxCertifications,
  people,
  specialtyCertifications,
} from "./schema";

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

/**
 * The nitrox and specialty kinds this diver has on file at this shop, in any
 * state and from any agency: what the agency's page is never asked to offer
 * again. A deleted card is not on file.
 */
export async function agencyListedKindsHeld(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<Set<AgencyListedKind>> {
  const [specialties, nitrox] = await queryAll(db, [
    () =>
      db
        .select({ specialty: specialtyCertifications.specialty })
        .from(specialtyCertifications)
        .where(
          and(
            eq(specialtyCertifications.shopId, input.shopId),
            eq(specialtyCertifications.personId, input.personId),
            isNull(specialtyCertifications.deletedAt),
          ),
        ),
    () =>
      db
        .select({ id: nitroxCertifications.id })
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.shopId, input.shopId),
            eq(nitroxCertifications.personId, input.personId),
            isNull(nitroxCertifications.deletedAt),
          ),
        )
        .limit(1),
  ]);
  const held = new Set<AgencyListedKind>(specialties.map((row) => row.specialty));
  if (nitrox.length > 0) held.add("nitrox");
  return held;
}

/**
 * **The card an agency check just matched, read again to offer the page's
 * other cards** (layer 3). A live level card on this live diver at this shop
 * that an agency check certified (`agencyCheckedAt`), with the lookup and the
 * identity the judge reads it by, the number the shop holds for the diver at
 * that agency, and the kinds already on file. Null for anything else: a card
 * certified by hand, another diver's, another shop's, or one the check's Undo
 * took back.
 */
export async function certificationForAgencyOffer(
  db: AppDb,
  input: { shopId: string; personId: string; certificationId: string },
): Promise<{
  query: AgencyCheckQuery;
  level: (typeof certifications.$inferSelect)["level"];
  identity: { birthDate: string | null; cardNumber: string | null };
  /** The agency's number for this diver, as the matched card holds it. */
  identifier: string;
  held: Set<AgencyListedKind>;
} | null> {
  const [row] = await db
    .select({
      agency: certifications.agency,
      level: certifications.level,
      identifier: certifications.identifier,
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
        eq(certifications.status, "verified"),
        isNotNull(certifications.agencyCheckedAt),
        eq(people.shopId, input.shopId),
        isNull(certifications.deletedAt),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  const identifier = row?.identifier?.trim();
  if (!row || !identifier || !isAgencyCheckableLevel(row.level)) return null;
  const query = agencyCheckQuery(row);
  if (!query) return null;
  return {
    query,
    level: row.level,
    identity: {
      birthDate:
        row.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth) ? row.dateOfBirth : null,
      cardNumber: identifier,
    },
    identifier,
    held: await agencyListedKindsHeld(db, input),
  };
}

/**
 * **File the cards an agency's page listed, as pending with its words**
 * (layer 3). Never verified: a nitrox card authorizes a fill and a specialty
 * opens a site, so each waits for a staffer's one-tap confirm, which keeps the
 * agency's words as its review note. Each card takes the agency's number the
 * shop already holds for this diver, so the confirm is the ordinary one tap.
 *
 * The caller has already judged the page; this only writes. It writes all of
 * them or none: a kind that is on file by now (another tab, another staffer)
 * or a number already on another card refuses the lot, and the staffer sees
 * the record as it stands.
 */
export async function addAgencyListedCards(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    agency: CertificationAgency;
    identifier: string;
    cards: readonly { kind: AgencyListedKind; evidence: string }[];
  },
): Promise<{ ok: true; added: AgencyListedKind[] } | { ok: false }> {
  if (input.cards.length === 0) return { ok: false };
  try {
    return await db.transaction(async (tx) => {
      // Lock the diver so two posts of the same offer serialize.
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
        .for("update")
        .limit(1);
      if (!person) return { ok: false } as const;
      const held = await agencyListedKindsHeld(tx, input);
      if (input.cards.some((card) => held.has(card.kind))) return { ok: false } as const;
      const base = {
        shopId: input.shopId,
        personId: input.personId,
        agency: input.agency,
        identifier: input.identifier,
        status: "pending" as const,
      };
      for (const card of input.cards) {
        if (card.kind === "nitrox") {
          await tx.insert(nitroxCertifications).values({ ...base, reviewNote: card.evidence });
        } else {
          await tx
            .insert(specialtyCertifications)
            .values({ ...base, specialty: card.kind, reviewNote: card.evidence });
        }
      }
      return { ok: true, added: input.cards.map((card) => card.kind) } as const;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return { ok: false };
    throw error;
  }
}
