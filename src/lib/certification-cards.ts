import { isUnsightedSelfDeclaration } from "./readiness";

/**
 * **What a certification card's row says about itself** — the predicates every
 * people surface reads a card through, and the one place the H-24 rule about
 * an imported card's gate is written down.
 *
 * These lived in the diver record's own `_components/shared.ts` until the
 * shared person-row vocabulary needed them (ADR 20260827-people-not-lists,
 * decision 6): `src/components` may not import `src/app`
 * (`pnpm check:architecture`), so a row component that speaks this vocabulary
 * needs it at or below the domain layer. The words and tones that go with each
 * value live in `src/i18n/card-labels.ts`, the same split
 * `readiness.ts`/`readiness-labels.ts` already uses.
 */

/**
 * The stored card status. Staff either certify a card or delete a bad one;
 * there is no "needs correction" state — a card the desk can't stand behind is
 * removed.
 */
export type CardStatus = "pending" | "verified";

/**
 * What the badge shows. **The same two values the column stores**, since
 * 2026-08-21: a certification does not expire, so there is no third display
 * state overlaid on top of the stored one
 * (ADR 20260821-a-card-does-not-expire).
 */
export type CardDisplayStatus = CardStatus;

/**
 * Import provenance shared by level, specialty, and nitrox cards
 * (ADR 20260724-import-verified-cards). A card brought in by the contact
 * importer lands `verified` with `importedAt` set and `reviewedAt` still null —
 * DiveDay trusts the card the shop's own system already checked, but keeps it
 * marked imported forever so it is never mistaken for one this shop carded on
 * sight. `needsImportConfirm` is the one-tap-confirm nudge: an imported card no
 * staff member here has confirmed yet. Confirming stamps `reviewedAt` through
 * the normal review path; the imported marker stays.
 */
export type ImportedCard = { importedAt?: Date | string | null; reviewedAt?: Date | string | null };

export function isImportedCard(card: ImportedCard): boolean {
  return Boolean(card.importedAt);
}

export function needsImportConfirm(card: ImportedCard): boolean {
  return Boolean(card.importedAt) && !card.reviewedAt;
}

/**
 * A level card issued by this shop's own instructor on a course session it
 * ran (issue #717, `certifications.issuedByShopAt`). Lands `verified`
 * immediately — a card the shop taught and signed off on, not a capture of
 * one somebody else issued — so unlike {@link needsImportConfirm} there is
 * no confirm nudge: the instructor's tap already was the confirmation.
 */
export type ShopIssuedCard = { issuedByShopAt?: Date | string | null };

export function isShopIssuedCard(card: ShopIssuedCard): boolean {
  return Boolean(card.issuedByShopAt);
}

/**
 * The badge for a card **whose gate is still shut** — an imported specialty card
 * (the dive it authorizes waits) or an imported nitrox card (the fill waits, and
 * gives plain air meanwhile). Neither may read the same as a hand-verified card,
 * which does clear: at a busy desk a green "certified" alone gets a diver told
 * they're fine for the 30 m wall, or gets them handed an EANx tank
 * (ADR 20260725-import-specialty-cards, 20260725-imported-card-sighting).
 *
 * A *level* card is deliberately not in this set: an imported level card is
 * genuinely valid on arrival (20260724-import-verified-cards), so green
 * "certified" is true of it and its confirm is only a nudge.
 */
export type HeldCardDisplayStatus = CardDisplayStatus | "confirm_to_clear";

export function heldCardDisplayStatus(
  card: { status: CardStatus } & ImportedCard,
): HeldCardDisplayStatus {
  return card.status === "verified" && needsImportConfirm(card) ? "confirm_to_clear" : card.status;
}

/** The three tables a card can be in. Each is a different gate. */
export type CertificationCardKind = "level" | "specialty" | "nitrox";

/**
 * **The one state a shared card row renders**, flattened from the two display
 * unions above so `CertificationCardRow` has one prop rather than a per-kind
 * branch of its own (ADR 20260827-people-not-lists, decision 6).
 *
 * Flattening is exactly where this rule is easiest to lose, so it is computed
 * once, here, by {@link certificationCardRowState} — never re-derived at a call
 * site and never re-derived inside the row component.
 */
export type CertificationCardRowState =
  | "verified"
  | "pending"
  | "self_declared"
  | "imported_unconfirmed";

/**
 * **Which of the four a card is, and the H-24 rule that decides it.**
 *
 * Read in the order the desk reads it:
 *
 * 1. **A claim nobody has looked at** is the weakest thing on the record — a
 *    diver's own typing on a public form, with no agency and no sighted number
 *    (ADR 20260814-self-declared-cards). It outranks everything below because
 *    the shop holds no evidence at all.
 * 2. **An imported specialty or nitrox card whose gate is still shut** —
 *    `confirm_to_clear` above. One tap opens it; until then the dive or the
 *    fill waits.
 * 3. Otherwise the stored status, which for an imported **level** card is
 *    `verified` and means it: that card cleared readiness on arrival, so its
 *    confirm is a nudge and not a gate, and this function must not invent one.
 *    That asymmetry is the whole reason `kind` is an argument.
 */
export function certificationCardRowState(
  kind: CertificationCardKind,
  card: { status: CardStatus; selfDeclaredAt?: Date | string | null } & ImportedCard,
): CertificationCardRowState {
  if (isUnsightedSelfDeclaration(card)) return "self_declared";
  if (kind !== "level" && heldCardDisplayStatus(card) === "confirm_to_clear") {
    return "imported_unconfirmed";
  }
  return card.status;
}
