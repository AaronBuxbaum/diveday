import { type AgencyListedKind, agencyCheckOffered, agencyCheckQuery } from "@/lib/agency-check";
import { needsImportConfirm } from "@/lib/certification-cards";
import { needsCardSighting } from "@/lib/readiness";
import { addAgencyListedCardsAction, agencyCheckAction } from "../agency-check-actions";
import type { Shop } from "./shared";

/** The agency check's two actions, bound to this diver: the check, and filing the page's other cards. */
export function agencyCheckActions(shopSlug: string, personId: string) {
  return {
    action: agencyCheckAction.bind(null, shopSlug, personId),
    addListed: addAgencyListedCardsAction.bind(null, shopSlug, personId),
  };
}

/**
 * The lookup the extension would type for this card, or null when there is
 * none to offer. PADI's waits for the shop's own switch (H-20261014-padi-divechek); off, the card
 * keeps its "(member sign-in)" link.
 */
function offeredCheckQuery(
  card: CheckedCard,
  person: { fullName: string; dateOfBirth: string | null },
  shop: Shop,
) {
  if (!agencyCheckOffered(card.agency, shop)) return null;
  return agencyCheckQuery({
    agency: card.agency,
    fullName: person.fullName,
    dateOfBirth: person.dateOfBirth,
    identifier: card.identifier,
  });
}

/**
 * A level card's check: the lookup, or null for a self-declared card or one
 * with none to offer, and whether the shop's switch is what keeps it off.
 */
export type CheckedCard = {
  agency: Parameters<typeof agencyCheckQuery>[0]["agency"];
  identifier: string | null;
};

export function levelCardCheck(
  card: CheckedCard,
  person: { fullName: string; dateOfBirth: string | null },
  shop: Shop,
  selfDeclared: boolean,
) {
  return {
    query: selfDeclared ? null : offeredCheckQuery(card, person, shop),
    switchedOff: !selfDeclared && !agencyCheckOffered(card.agency, shop),
  };
}

/**
 * A nitrox or specialty card's check (issue #2592): the lookup, or null for a
 * card that is confirmed through a card sighting instead (a diver's own tick,
 * a card the shop issued, a listed card with no number), where the page does
 * not stand in for the card in a staffer's hand. The same rule the action
 * judges by (`checkableListedQuery`, src/db/agency-check.ts).
 */
export function listedCardCheck(
  card: CheckedCard & {
    status: "pending" | "verified";
    selfDeclaredAt: Date | null;
    issuedByShopAt: Date | null;
    listedFromCertificationId: string | null;
    importedAt: Date | null;
    reviewedAt: Date | null;
  },
  person: { fullName: string; dateOfBirth: string | null },
  shop: Shop,
  kind: { id: string; type: "nitrox" | "specialty"; kind: AgencyListedKind },
  actions: ReturnType<typeof agencyCheckActions>,
) {
  const sightedFirst = needsCardSighting(card) || !card.identifier?.trim();
  return {
    certificationId: kind.id,
    card: { type: kind.type, kind: kind.kind },
    awaiting: card.status === "pending" || needsImportConfirm(card),
    query: sightedFirst ? null : offeredCheckQuery(card, person, shop),
    switchedOff: !sightedFirst && !agencyCheckOffered(card.agency, shop),
    ...actions,
  };
}

/** The listed-card check, bound to this diver and shop once, so a row names only its card and kind. */
export function listedChecks(
  person: { fullName: string; dateOfBirth: string | null },
  shop: Shop,
  actions: ReturnType<typeof agencyCheckActions>,
) {
  return (
    card: Parameters<typeof listedCardCheck>[0],
    kind: { id: string; type: "nitrox" | "specialty"; kind: AgencyListedKind },
  ) => listedCardCheck(card, person, shop, kind, actions);
}
