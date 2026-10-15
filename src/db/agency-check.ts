import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import {
  AGENCY_CHECKS,
  type AgencyCheckQuery,
  type AgencyListedKind,
  agencyCheckOffered,
  agencyCheckQuery,
  isAgencyCheckableLevel,
  isCheckableAgency,
} from "@/lib/agency-check";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import { needsImportConfirm } from "@/lib/certification-cards";
import { nowDate } from "@/lib/clock";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEventsForPerson } from "./manifest-events";
import { isUniqueConstraintViolation, queryAll } from "./query-helpers";
import { reverseCertificationReview } from "./readiness";
import {
  certifications,
  nitroxCertifications,
  people,
  shops,
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
      padiChecksEnabled: shops.padiChecksEnabled,
    })
    .from(certifications)
    .innerJoin(people, eq(people.id, certifications.personId))
    .innerJoin(shops, eq(shops.id, certifications.shopId))
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
  padiChecksEnabled: boolean;
}): AgencyCheckQuery | null {
  // PADI waits for the shop's own switch (H-121).
  if (!agencyCheckOffered(row.agency, row)) return null;
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
      padiChecksEnabled: shops.padiChecksEnabled,
    })
    .from(certifications)
    .innerJoin(people, eq(people.id, certifications.personId))
    .innerJoin(shops, eq(shops.id, certifications.shopId))
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
 * again. A deleted card is not on file, and nor is an unsighted nitrox
 * self-declaration: the diver's tick on a join form names no agency and no
 * number, so the card the page lists replaces it (`addAgencyListedCards`).
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
            // The diver's own unsighted "nitrox certified?" is a claim, not a
            // card: the agency's page may answer it (D6).
            or(
              isNull(nitroxCertifications.selfDeclaredAt),
              ne(nitroxCertifications.status, "pending"),
            ),
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
      padiChecksEnabled: shops.padiChecksEnabled,
    })
    .from(certifications)
    .innerJoin(people, eq(people.id, certifications.personId))
    .innerJoin(shops, eq(shops.id, certifications.shopId))
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
  if (!agencyCheckOffered(row.agency, row)) return null;
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
 * opens a site, so each waits for a staffer's confirm, which keeps the
 * agency's words as its review note. Each row is stamped with the level card
 * whose check listed it (`listedFromCertificationId`): that stamp is what says
 * the note is the agency's words, and what the check's Undo takes back.
 *
 * The number: where the agency numbers the diver, the one the shop already
 * holds for them (the confirm is the ordinary one tap); where it numbers each
 * card, the one printed on the card's own line, or none, and the confirm is
 * the card sighting.
 *
 * The caller has already judged the page; this writes, and re-reads the two
 * things the page cannot vouch for, under the diver's lock: that the level
 * card is still certified by an agency check (an Undo between the offer and
 * the tick leaves nothing to file), and what is on file. It writes all of them
 * or none: a kind that is on file by now (another tab, another staffer) or a
 * number already on another card refuses the lot. A nitrox card retires the
 * diver's own unsighted nitrox claim, as any card the shop holds outranks it.
 */
export async function addAgencyListedCards(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    /** The level card the check certified, whose page listed these. */
    certificationId: string;
    /** The staffer who ticked them: the one who retires a claim they replace. */
    filedByPersonId: string;
    cards: readonly {
      kind: AgencyListedKind;
      evidence: string;
      cardNumber: string | null;
    }[];
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
        .for("no key update")
        .limit(1);
      if (!person) return { ok: false } as const;
      // The level card, read again under a share lock so the check's Undo
      // (which updates it) waits for this to commit, or this sees it undone.
      const [matched] = await tx
        .select({ agency: certifications.agency, identifier: certifications.identifier })
        .from(certifications)
        .where(
          and(
            eq(certifications.id, input.certificationId),
            eq(certifications.shopId, input.shopId),
            eq(certifications.personId, input.personId),
            eq(certifications.status, "verified"),
            isNotNull(certifications.agencyCheckedAt),
            isNull(certifications.deletedAt),
          ),
        )
        .for("share")
        .limit(1);
      const identifier = matched?.identifier?.trim();
      if (!matched || !identifier || !isCheckableAgency(matched.agency)) {
        return { ok: false } as const;
      }
      const held = await agencyListedKindsHeld(tx, input);
      if (input.cards.some((card) => held.has(card.kind))) return { ok: false } as const;
      const numbersTheDiver = AGENCY_CHECKS[matched.agency].numbersTheDiver;
      if (input.cards.some((card) => card.kind === "nitrox")) {
        await tx
          .update(nitroxCertifications)
          .set({ deletedAt: nowDate(), deletedByPersonId: input.filedByPersonId })
          .where(
            and(
              eq(nitroxCertifications.shopId, input.shopId),
              eq(nitroxCertifications.personId, input.personId),
              isNotNull(nitroxCertifications.selfDeclaredAt),
              eq(nitroxCertifications.status, "pending"),
              isNull(nitroxCertifications.deletedAt),
            ),
          );
      }
      for (const card of input.cards) {
        const values = {
          shopId: input.shopId,
          personId: input.personId,
          agency: matched.agency,
          identifier: numbersTheDiver ? identifier : card.cardNumber,
          status: "pending" as const,
          reviewNote: card.evidence,
          listedFromCertificationId: input.certificationId,
        };
        if (card.kind === "nitrox") {
          await tx.insert(nitroxCertifications).values(values);
        } else {
          await tx.insert(specialtyCertifications).values({ ...values, specialty: card.kind });
        }
      }
      return { ok: true, added: input.cards.map((card) => card.kind) } as const;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return { ok: false };
    throw error;
  }
}

/**
 * **The agency check's own Undo** (H-105): the level card's review goes back,
 * and so do the cards its page listed that are still pending (layer 3, D1).
 * A listed card a staffer has since certified is theirs and stays. One
 * transaction, so a tick posted meanwhile either lands first and is archived
 * here, or finds the card undone and files nothing (`addAgencyListedCards`).
 *
 * Only a review a check made, on this diver at this shop: never a sighting or
 * a one-tap review, which have their own Undo.
 */
export async function undoAgencyCheck(
  db: AppDb,
  input: { shopId: string; personId: string; certificationId: string; undoneByPersonId: string },
): Promise<{ ok: true; archived: number } | { ok: false }> {
  const outcome = await db.transaction(async (tx) => {
    const [card] = await tx
      .select({ id: certifications.id, reviewedAt: certifications.reviewedAt })
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
      .for("update")
      .limit(1);
    if (!card?.reviewedAt) return { ok: false } as const;
    const undone = await reverseCertificationReview(tx, {
      shopId: input.shopId,
      certificationId: input.certificationId,
      // The row is locked and was just read: this Undo reverses the review it
      // finds, which is an agency check's by the filter above.
      reviewedAt: card.reviewedAt,
      reversingAgencyCheck: true,
    });
    if (!undone.ok) return { ok: false } as const;
    const archive = {
      deletedAt: nowDate(),
      deletedByPersonId: input.undoneByPersonId,
    };
    const nitrox = await tx
      .update(nitroxCertifications)
      .set(archive)
      .where(
        and(
          eq(nitroxCertifications.shopId, input.shopId),
          eq(nitroxCertifications.listedFromCertificationId, input.certificationId),
          eq(nitroxCertifications.status, "pending"),
          isNull(nitroxCertifications.deletedAt),
        ),
      )
      .returning({ id: nitroxCertifications.id });
    const specialties = await tx
      .update(specialtyCertifications)
      .set(archive)
      .where(
        and(
          eq(specialtyCertifications.shopId, input.shopId),
          eq(specialtyCertifications.listedFromCertificationId, input.certificationId),
          eq(specialtyCertifications.status, "pending"),
          isNull(specialtyCertifications.deletedAt),
        ),
      )
      .returning({ id: specialtyCertifications.id });
    return { ok: true, archived: nitrox.length + specialties.length } as const;
  });
  // After the commit, so a device that re-reads sees the review gone
  // (issue #2613).
  if (outcome.ok) await publishManifestEventsForPerson(db, input.shopId, input.personId);
  return outcome;
}
