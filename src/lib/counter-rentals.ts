import type { Certification, SpecialtyCertification } from "@/db/schema";
import { type CalendarDate, calendarDaysBetween, isValidCalendarDate } from "./calendar-date";
import type { CertificationLevel } from "./certification-levels";
import type { GearItemKind } from "./gear";
import { certificationRank, holdsSpecialtyCard, validVerifiedCertification } from "./readiness";
import {
  CORE_RENTAL_KINDS,
  offeredRentableItems,
  type RentableItemKind,
  type RentalPricing,
} from "./rentals";
import type { ShopWaiverStatus } from "./waivers";

/**
 * **A counter rental** — units from the register lent to a person who is not
 * on a boat that day, for a window of shop-local dates they chose at the
 * counter (ADR 20260815-minimal-gear-register, amended 2026-10-08). The rules
 * here are the ones that need no database: how long a window is, which windows
 * the counter may write, and what the shop's own price list suggests a unit
 * costs for it. Whether a unit is free is never decided here — the
 * `gear_reservations_no_overlap` exclusion constraint decides that.
 */

/**
 * The longest window a counter rental may hold, in days. A month covers a
 * liveaboard week or a long holiday with room to spare; past it, the likeliest
 * story is a mistyped year, and that would hold a unit off every picker until
 * somebody noticed.
 */
export const COUNTER_RENTAL_MAX_DAYS = 31;

/** Days in an inclusive window: a unit out and back the same day is one day. */
export function counterRentalDays(from: CalendarDate, until: CalendarDate): number {
  return calendarDaysBetween(from, until) + 1;
}

export type CounterRentalWindowRefusal = "invalid_window" | "starts_in_past" | "window_too_long";

/**
 * Whether the counter may write this window, as a refusal code or null.
 *
 * **A window may not start before today.** A rental is written when the unit
 * is handed over or booked ahead; one that started yesterday would land on the
 * register already lapsed, and the register would call a unit overdue that the
 * shop never lent on those days.
 */
export function checkCounterRentalWindow(input: {
  from: string;
  until: string;
  todayLocal: CalendarDate;
}): CounterRentalWindowRefusal | null {
  const { from, until, todayLocal } = input;
  if (!isValidCalendarDate(from) || !isValidCalendarDate(until) || until < from) {
    return "invalid_window";
  }
  if (from < todayLocal) return "starts_in_past";
  if (counterRentalDays(from, until) > COUNTER_RENTAL_MAX_DAYS) return "window_too_long";
  return null;
}

/**
 * The price-list entry a register unit is billed under, where there is one.
 *
 * The price list speaks rental-fit words (`RentableItemKind`), the register
 * speaks inventory words, and the two only partly overlap. **Fins carry the
 * mask-and-fins price and a mask carries none**: the list prices the pair as
 * one line, the same convention `sizedRentalKindOfGearKind` keeps, so a pair
 * handed over together is billed once. Every kind with no entry (a tank, a
 * reel, boots) is left for the staffer to price.
 */
function priceListKind(kind: GearItemKind): RentableItemKind | null {
  switch (kind) {
    case "bcd":
    case "regulator":
    case "wetsuit":
    case "weights":
    case "dive_computer":
    case "gopro":
    case "drysuit":
    case "hood":
    case "gloves":
    case "torch":
    case "smb":
      return kind;
    case "fins":
      return "mask_fins";
    default:
      return null;
  }
}

/** The shop's per-day price for a unit of this kind, or null when it has none. */
export function counterRentalDayRateCents(
  pricing: RentalPricing,
  kind: GearItemKind,
): number | null {
  const listKind = priceListKind(kind);
  if (!listKind) return null;
  return pricing.perItemCents[listKind] ?? null;
}

/**
 * The line a unit's price box opens with: the day rate times the days in the
 * window. A suggestion, never a charge — the staffer edits it before anything
 * is billed, and an unpriced kind stays null rather than reading as free.
 */
export function counterRentalLineCents(
  pricing: RentalPricing,
  kind: GearItemKind,
  days: number,
): number | null {
  const rate = counterRentalDayRateCents(pricing, kind);
  return rate === null ? null : rate * days;
}

// ---------------------------------------------------------------------------
// Safety at the counter (dive-domain review of PR #2256)
// ---------------------------------------------------------------------------

/**
 * **Life-support gear**: the kinds a person breathes from, floats on, or
 * decides depth and time by. Lending one to somebody with no card is handing
 * scuba to a non-diver, so these need a verified certification, the same
 * evidence boarding asks for. Everything else (a wetsuit, fins, a torch, a
 * camera, lead) is soft goods, lent to anyone: snorkelers and shore walkers
 * rent them, and none of them gets anybody into water they could not already
 * reach. Weights stay soft goods: lead does not take anyone under on its own.
 */
export const COUNTER_LIFE_SUPPORT_KINDS: ReadonlySet<GearItemKind> = new Set<GearItemKind>([
  "regulator",
  "bcd",
  "tank",
  "dive_computer",
  "drysuit",
  "dpv",
  "o2_kit",
  "nitrox_analyzer",
]);

export function isLifeSupportKind(kind: GearItemKind): boolean {
  return COUNTER_LIFE_SUPPORT_KINDS.has(kind);
}

export type CounterRentalCardRefusal = "not_certified" | "no_drysuit_card";

/**
 * Whether this person may take these kinds across the counter, as a refusal
 * code or null — read through the same predicates boarding reads
 * (`validVerifiedCertification`, `holdsSpecialtyCard`), so a card that would
 * not get them on a boat does not get them a regulator either. A pending card
 * and a self-declaration are somebody's word, and clear nothing here.
 *
 * A drysuit also wants the drysuit specialty: air in the suit expands on the
 * way up, and a diver who has never vented one rides it to the surface.
 */
export function counterRentalCardRefusal(
  kinds: readonly GearItemKind[],
  cards: {
    certifications: readonly Certification[];
    specialtyCertifications: readonly SpecialtyCertification[];
  },
): CounterRentalCardRefusal | null {
  if (!kinds.some(isLifeSupportKind)) return null;
  if (!cards.certifications.some(validVerifiedCertification)) return "not_certified";
  if (kinds.includes("drysuit") && !holdsSpecialtyCard(cards.specialtyCertifications, "drysuit")) {
    return "no_drysuit_card";
  }
  return null;
}

/**
 * What the counter shows about a person's cards before anything is picked:
 * the highest verified level (null when none clears), whether the drysuit
 * specialty clears, and how many cards are on file that do not count yet —
 * pending review or self-declared — so the staffer knows a card exists to
 * look at rather than reading "none" as "never dived".
 */
export function counterRentalCardSummary(cards: {
  certifications: readonly Certification[];
  specialtyCertifications: readonly SpecialtyCertification[];
}): { verifiedLevel: CertificationLevel | null; drysuit: boolean; unverified: number } {
  const verified = cards.certifications.filter(validVerifiedCertification);
  const verifiedLevel = verified.reduce<CertificationLevel | null>(
    (best, card) =>
      best === null || certificationRank(card.level) > certificationRank(best) ? card.level : best,
    null,
  );
  return {
    verifiedLevel,
    drysuit: holdsSpecialtyCard(cards.specialtyCertifications, "drysuit"),
    unverified: cards.certifications.length - verified.length,
  };
}

/**
 * The register kinds that make up the shop's core rental set, as the price
 * list names it (`CORE_RENTAL_KINDS`, restricted to what the shop offers):
 * each core price-list entry and the register kind that carries it. A mask
 * carries no price of its own (fins carry the pair), so it is not a set piece.
 */
export function counterRentalCoreKinds(rentalItems: readonly string[]): GearItemKind[] {
  const offered = new Set(offeredRentableItems(rentalItems).map((item) => item.kind));
  const byListKind: Partial<Record<RentableItemKind, GearItemKind>> = {
    bcd: "bcd",
    regulator: "regulator",
    wetsuit: "wetsuit",
    mask_fins: "fins",
    weights: "weights",
    dive_computer: "dive_computer",
  };
  return CORE_RENTAL_KINDS.filter((kind) => offered.has(kind)).flatMap((kind) => {
    const gearKind = byListKind[kind];
    return gearKind ? [gearKind] : [];
  });
}

/**
 * **The set price, when the picked units are one full set.** A shop that
 * prices its core kit as one cheaper bundle quotes a diver the set, and a
 * person renting that kit at the counter is the same customer. One unit of
 * each core kind exactly: two BCDs is two people's gear, and a set price on
 * it would undercharge whoever wrote the bundle. Null when the shop has no set
 * price or the picks are not one set, so the pieces price themselves.
 */
export function counterRentalSetCents(
  pricing: RentalPricing,
  coreKinds: readonly GearItemKind[],
  pickedKinds: readonly GearItemKind[],
  days: number,
): number | null {
  if (pricing.setCents === null) return null;
  return isOneCoreSet(coreKinds, pickedKinds) ? pricing.setCents * days : null;
}

/** Exactly one unit of every core kind among the picks (and at least one core kind). */
export function isOneCoreSet(
  coreKinds: readonly GearItemKind[],
  pickedKinds: readonly GearItemKind[],
): boolean {
  return (
    coreKinds.length > 0 &&
    coreKinds.every((core) => pickedKinds.filter((kind) => kind === core).length === 1)
  );
}

/**
 * **What a counter rental says about the person's waiver** (issue #2261,
 * decided by Aaron 2026-10-09, H-108): it informs and never blocks.
 *
 * The shop-wide release is the person's (`shopWaiverStatus`, src/lib/waivers.ts),
 * so a person who signed on any booking, or on a link sent from their record,
 * is covered here too. Anything short of a current signature is said on the
 * ticket and the Rentals list in the release's own word (`shopWaiverStatusText`),
 * so "Not signed" never reads two ways on two screens.
 *
 * - `null` — a current signature; the ticket says nothing.
 * - `offerLink: true` — never signed, lapsed, or a minor's solo signature: the
 *   fix is the person's waiver link, offered beside the word.
 * - `offerLink: false` — a medical hold or a refusal: another link fixes
 *   nothing, the review does (the diver record's own rule).
 *
 * Nothing here gates `createCounterRental`; the life-support gate stays the
 * card (`counterRentalCardRefusal`).
 */
export function counterRentalWaiverFlag(
  state: ShopWaiverStatus["state"],
): { offerLink: boolean } | null {
  switch (state) {
    case "current":
      return null;
    case "none":
    case "expired":
    case "guardian_missing":
      return { offerLink: true };
    case "medical_review":
    case "medical_not_cleared":
      return { offerLink: false };
  }
}
