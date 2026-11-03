import type { Card, Certification, NitroxCertification, SpecialtyCertification } from "@/db/schema";

/**
 * **One ledger, three shapes** (issue #2722). Every diver card is a `cards` row
 * whose `kind` says what it is for, and the database's `cards_kind_shape` check
 * says which of `level` and `specialty` that kind carries. These guards are how
 * a row read from the ledger becomes the narrower card a rule takes: the ladder
 * reads a level card, the specialty gate a specialty card, the fill gate a
 * nitrox card, and none of them may be handed another kind's row.
 */

export function isLevelCard(card: Card): card is Certification {
  return card.kind === "level" && card.level !== null && card.specialty === null;
}

export function isSpecialtyCard(card: Card): card is SpecialtyCertification {
  return card.kind === "specialty" && card.specialty !== null && card.level === null;
}

export function isNitroxCard(card: Card): card is NitroxCertification {
  return card.kind === "nitrox" && card.level === null && card.specialty === null;
}

/**
 * A row a query read with `kind = 'level'`. Throws rather than passing on a row
 * of another kind, because a reader that forgot its kind filter would otherwise
 * judge a rung from a nitrox card.
 */
export function asLevelCard(card: Card): Certification {
  if (!isLevelCard(card))
    throw new Error(`Card ${card.id} is a ${card.kind} card, not a level card.`);
  return card;
}

/** A row a query read with `kind = 'specialty'`; throws on any other kind. */
export function asSpecialtyCard(card: Card): SpecialtyCertification {
  if (!isSpecialtyCard(card)) {
    throw new Error(`Card ${card.id} is a ${card.kind} card, not a specialty card.`);
  }
  return card;
}

/** A row a query read with `kind = 'nitrox'`; throws on any other kind. */
export function asNitroxCard(card: Card): NitroxCertification {
  if (!isNitroxCard(card)) {
    throw new Error(`Card ${card.id} is a ${card.kind} card, not a nitrox card.`);
  }
  return card;
}

export type CardsByKind = {
  certifications: Certification[];
  specialtyCertifications: SpecialtyCertification[];
  nitroxCertifications: NitroxCertification[];
};

/**
 * One read of the ledger, sorted into the three lists the gates take. A row
 * whose kind and columns disagree cannot exist (`cards_kind_shape`), and if one
 * ever did it would land in no list: evidence nobody can read clears nothing.
 */
export function splitCardsByKind(rows: readonly Card[]): CardsByKind {
  const split: CardsByKind = {
    certifications: [],
    specialtyCertifications: [],
    nitroxCertifications: [],
  };
  for (const row of rows) {
    if (isLevelCard(row)) split.certifications.push(row);
    else if (isSpecialtyCard(row)) split.specialtyCertifications.push(row);
    else if (isNitroxCard(row)) split.nitroxCertifications.push(row);
  }
  return split;
}
