/**
 * Trip prep: what the shop lays out before a boat leaves, derived purely from
 * each diver's rental fit and the trip's planned dives. The shop tracks no
 * equipment inventory, so this is a checklist to pack against, never an
 * allocation — nothing here reserves a particular item.
 *
 * Safety invariants (docs/product/glossary.md — Rental fit, Nitrox):
 *   - one tank per diver per planned dive, always, so the tank count can never
 *     come out short of the dive plan;
 *   - a nitrox tank is only counted for a diver whose enriched-air card is
 *     verified *right now*. The booking flag is re-checked here rather than
 *     trusted, so a card revoked after the request downgrades that diver to
 *     air and surfaces as a blocker instead of quietly filling EANx;
 *   - the divemasters and instructors assigned to the trip dive it too, and
 *     each gets one air tank per planned dive, same as a diver. Boat crew who
 *     stay dry (captain, deckhand) are not part of the dive plan and are never
 *     counted.
 */

import { nowDate } from "./clock";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RentalItemKind =
  | "bcd"
  | "regulator"
  | "wetsuit"
  | "boots"
  | "mask_fins"
  | "weights"
  | "dive_computer"
  | "gopro";

export type RentalFit = {
  rentsBcd: boolean;
  rentsRegulator: boolean;
  rentsWetsuit: boolean;
  rentsMaskFins: boolean;
  rentsWeights: boolean;
  rentsDiveComputer: boolean;
  rentsGopro: boolean;
  bcdSize: string | null;
  wetsuitSize: string | null;
  bootSize: string | null;
  finSize: string | null;
  weightPreference: string | null;
  /**
   * Set when staff couldn't fill a requested size and flagged the diver for
   * hands-on fitting instead (H-06). Their pieces stay on the packing lines
   * with the count intact — dropping them arrives a BCD short with nothing to
   * fit them from — but a *sized* piece carries no size, because packing a
   * size nobody chose is exactly what this state exists to prevent. Unsized
   * kit (regulator, computer, GoPro), weights, and tanks are untouched: none
   * has a stock size to be short of, and a diver never loses life support or
   * gas over a wetsuit.
   */
  needsStaffFitAt?: Date | null;
  needsStaffFitNote?: string | null;
};

export type PrepDiver = {
  bookingId: string;
  personId: string;
  fullName: string;
  /** Null when the shop has never recorded a fit for this diver. */
  fit: RentalFit | null;
  wantsNitrox: boolean;
  hasVerifiedNitroxCard: boolean;
};

/** One row of the packing list: N of this item in this size, and who they're for. */
export type PrepLine = {
  kind: RentalItemKind;
  /** Null when the item is rented but no size was ever recorded. */
  size: string | null;
  count: number;
  divers: string[];
  /**
   * This line's divers are flagged for hands-on fitting (H-06), so the count is
   * real but the size is deliberately absent — bring a range in their band and
   * fit them in person. Distinct from a plain null size, which means nobody
   * ever wrote one down.
   */
  fitAtCheckIn: boolean;
};

export type TankPlan = {
  /** total = (diverCount + crewCount) × diveCount. */
  total: number;
  air: number;
  nitrox: number;
};

export type NitroxBlocker = {
  bookingId: string;
  personId: string;
  fullName: string;
  reason: "no_verified_card";
};

export type DivePrepChecklist = {
  diveCount: number;
  diverCount: number;
  /** Divemasters and instructors assigned to the trip who dive it and need their own tanks. */
  crewCount: number;
  tanks: TankPlan;
  lines: PrepLine[];
  /** Divers who asked for enriched air but have no verified card — packed as air. */
  nitroxBlockers: NitroxBlocker[];
  /** Divers with no rental fit on file; staff still has to ask them. */
  diversWithoutFit: { fullName: string; personId: string }[];
  /**
   * Divers whose stated size couldn't be filled, flagged for hands-on fitting
   * (H-06). Their pieces stay on `lines` with the count intact and the size
   * blanked — fit them from what is actually aboard rather than packing
   * against a size the shop is short of.
   */
  diversNeedingStaffFit: {
    personId: string;
    fullName: string;
    note: string | null;
    /**
     * What they asked for, e.g. BCD L, wetsuit M — a code per piece, never a
     * rendered word (`src/i18n/rental-labels.ts` resolves `kind`). The person
     * doing the check-in fit is usually the captain, who can't edit the fit
     * and now sees no size anywhere on the packing line — without this,
     * "bring a range in their band" means starting from scratch on a moving
     * dock. It is a starting point, not an allocation.
     */
    statedSizes: { kind: "bcd" | "wetsuit" | "boots" | "mask_fins"; size: string }[];
    /**
     * Whole days since the flag was raised. A shortage is a fact about one
     * day, so an old flag is a prompt to re-ask the diver rather than a
     * standing truth — surfacing the age is what stops stale flags becoming
     * background noise the crew learns to skip past.
     */
    flaggedDaysAgo: number;
  }[];
};

/** Kit that has no size to record, so a blank is expected rather than a gap. */
export const UNSIZED_ITEM_KINDS: readonly RentalItemKind[] = [
  "regulator",
  "dive_computer",
  "gopro",
];

/** Fixed order so the list reads the same way every morning. */
const KIND_ORDER: RentalItemKind[] = [
  "bcd",
  "regulator",
  "wetsuit",
  "boots",
  "mask_fins",
  "weights",
  "dive_computer",
  "gopro",
];

function size(value: string | null): string | null {
  return value?.trim() || null;
}

type PrepItem = { kind: RentalItemKind; size: string | null; fitAtCheckIn: boolean };

/**
 * The pieces one diver's fit asks for. Boots ride along with the suit — always,
 * even with no size recorded: fins don't fit over bare feet, so a missing boot
 * size is a loose end to chase, never a reason to leave boots off the list.
 *
 * A diver flagged for hands-on fitting (H-06) still contributes every piece.
 * Dropping them under-packs the boat — the count is the number the packer
 * actually works from, and a regulator or computer has no size to be wrong
 * about in the first place. What changes is that their *sized* pieces carry no
 * size: the line keeps its count and reads "fit at check-in" rather than naming
 * a size the shop already knows it is short of.
 */
function rentedItems(fit: RentalFit): PrepItem[] {
  const flagged = Boolean(fit.needsStaffFitAt);
  /** A piece whose size is the thing in question — blanked when flagged. */
  const sized = (kind: RentalItemKind, value: string | null): PrepItem =>
    flagged
      ? { kind, size: null, fitAtCheckIn: true }
      : { kind, size: size(value), fitAtCheckIn: false };
  /** A piece with no size at all; a flag never changes what to pack. */
  const unsized = (kind: RentalItemKind): PrepItem => ({ kind, size: null, fitAtCheckIn: false });
  /**
   * A piece that records a value but has no stock *size* to be short of, so
   * the flag leaves it alone. Weights are the case: lead is bulk stock in 2 lb
   * increments — a shop is never "out of 12 lb" — and usual weighting is the
   * most safety-relevant number in the fit. Under-weighting is a diver who
   * can't hold a safety stop; over-weighting is an over-inflated BCD and a bad
   * ascent. Blanking it because there's no L BCD trades a real number for
   * nothing, and "bring a range in their band" is meaningless applied to lead.
   */
  const stated = (kind: RentalItemKind, value: string | null): PrepItem => ({
    kind,
    size: size(value),
    fitAtCheckIn: false,
  });

  const items: PrepItem[] = [];
  if (fit.rentsBcd) items.push(sized("bcd", fit.bcdSize));
  if (fit.rentsRegulator) items.push(unsized("regulator"));
  if (fit.rentsWetsuit) {
    items.push(sized("wetsuit", fit.wetsuitSize));
    items.push(sized("boots", fit.bootSize));
  }
  if (fit.rentsMaskFins) items.push(sized("mask_fins", fit.finSize));
  if (fit.rentsWeights) items.push(stated("weights", fit.weightPreference));
  if (fit.rentsDiveComputer) items.push(unsized("dive_computer"));
  if (fit.rentsGopro) items.push(unsized("gopro"));
  return items;
}

/**
 * The sizes a flagged diver asked for, as one piece per stated size. Only the
 * pieces whose size the flag blanks on the packing line — the fitter already
 * sees everything else there. Empty when nothing sized was recorded, which is
 * its own useful signal: there is no starting point to work from.
 */
function statedSizeItems(
  fit: RentalFit,
): { kind: "bcd" | "wetsuit" | "boots" | "mask_fins"; size: string }[] {
  const items: { kind: "bcd" | "wetsuit" | "boots" | "mask_fins"; size: string }[] = [];
  const bcdSize = size(fit.bcdSize);
  if (fit.rentsBcd && bcdSize) items.push({ kind: "bcd", size: bcdSize });
  if (fit.rentsWetsuit) {
    const wetsuitSize = size(fit.wetsuitSize);
    if (wetsuitSize) items.push({ kind: "wetsuit", size: wetsuitSize });
    const bootSize = size(fit.bootSize);
    if (bootSize) items.push({ kind: "boots", size: bootSize });
  }
  const finSize = size(fit.finSize);
  if (fit.rentsMaskFins && finSize) items.push({ kind: "mask_fins", size: finSize });
  return items;
}

/** A diver breathes enriched air only while their card is verified. */
export function nitroxTanksApproved(diver: PrepDiver): boolean {
  return diver.wantsNitrox && diver.hasVerifiedNitroxCard;
}

/**
 * Builds the packing list for one departure. Divers are never dropped: a diver
 * with no fit on file still contributes tanks and is named in
 * `diversWithoutFit` so the gap is visible rather than absent.
 */
export function buildDivePrepChecklist(input: {
  divers: PrepDiver[];
  plannedDives: number;
  /** Names of the trip's diving crew (instructor/divemaster) — air tanks only, no rental fit. */
  divingCrew?: string[];
  /** Injectable for tests; defaults to the clock (src/lib/clock.ts). */
  now?: Date;
}): DivePrepChecklist {
  const diveCount = Math.max(1, Math.trunc(input.plannedDives) || 1);
  const grouped = new Map<string, PrepLine>();
  const nitroxBlockers: NitroxBlocker[] = [];
  const diversWithoutFit: { fullName: string; personId: string }[] = [];
  const now = input.now ?? nowDate();
  const diversNeedingStaffFit: DivePrepChecklist["diversNeedingStaffFit"] = [];
  let nitroxDivers = 0;

  for (const diver of input.divers) {
    if (nitroxTanksApproved(diver)) nitroxDivers += 1;
    else if (diver.wantsNitrox) {
      nitroxBlockers.push({
        bookingId: diver.bookingId,
        personId: diver.personId,
        fullName: diver.fullName,
        reason: "no_verified_card",
      });
    }

    if (!diver.fit) {
      diversWithoutFit.push({ fullName: diver.fullName, personId: diver.personId });
      continue;
    }
    // Flagged for hands-on fitting: name them here *and* keep their pieces on
    // the list below. Their sized items carry no size (rentedItems), so the
    // count stays right without anyone laying out a size the shop is short of.
    if (diver.fit.needsStaffFitAt) {
      diversNeedingStaffFit.push({
        personId: diver.personId,
        fullName: diver.fullName,
        note: diver.fit.needsStaffFitNote?.trim() || null,
        statedSizes: statedSizeItems(diver.fit),
        flaggedDaysAgo: Math.max(
          0,
          Math.floor((now.getTime() - diver.fit.needsStaffFitAt.getTime()) / DAY_MS),
        ),
      });
    }
    for (const item of rentedItems(diver.fit)) {
      const key = `${item.kind}:${item.fitAtCheckIn ? "\u0000fit" : (item.size?.toLowerCase() ?? "")}`;
      const line = grouped.get(key);
      if (line) {
        line.count += 1;
        line.divers.push(diver.fullName);
        continue;
      }
      grouped.set(key, {
        kind: item.kind,
        size: item.size,
        count: 1,
        divers: [diver.fullName],
        fitAtCheckIn: item.fitAtCheckIn,
      });
    }
  }

  const lines = [...grouped.values()].sort((a, b) => {
    const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    // A fit-at-check-in line sorts below everything for its kind: it is the
    // last thing the packer deals with, in person, once the rack is loaded.
    if (a.fitAtCheckIn !== b.fitAtCheckIn) return a.fitAtCheckIn ? 1 : -1;
    // An unrecorded size sorts last so it reads as the loose end it is.
    if (a.size === null) return b.size === null ? 0 : 1;
    if (b.size === null) return -1;
    return a.size.localeCompare(b.size);
  });
  for (const line of lines) line.divers.sort((a, b) => a.localeCompare(b));

  const diverCount = input.divers.length;
  const crewCount = input.divingCrew?.length ?? 0;
  return {
    diveCount,
    diverCount,
    crewCount,
    tanks: {
      total: (diverCount + crewCount) * diveCount,
      nitrox: nitroxDivers * diveCount,
      air: (diverCount - nitroxDivers + crewCount) * diveCount,
    },
    lines,
    nitroxBlockers,
    diversWithoutFit,
    diversNeedingStaffFit: diversNeedingStaffFit.sort((a, b) =>
      a.fullName.localeCompare(b.fullName),
    ),
  };
}

/**
 * One-line fit for a manifest, boarding, or roster row.
 *
 * The four states are deliberately distinct. "Own kit" is something a diver
 * told us; "not asked" is something nobody has done yet. Collapsing them reads
 * as reassurance the shop has not earned — the walk-up who was never asked
 * turns up at the dock in booties expecting a BCD.
 *
 * A code + params, never a rendered sentence: this is read from a staff page
 * *and* passed through `src/db/manifests.ts` into the offline manifest
 * snapshot, so it must stay renderable against whichever staff bundle the
 * reader resolves it in (src/i18n/rental-labels.ts's `rentalFitLineText`).
 */
export type RentalFitLine =
  | { state: "not_recorded" }
  | { state: "own_kit" }
  | { state: "needs_staff_fit"; note: string | null }
  | { state: "rents"; items: { kind: RentalItemKind; size: string | null }[] };

export function rentalFitLine(fit: RentalFit | null): RentalFitLine {
  if (!fit) return { state: "not_recorded" };
  // A fourth state on purpose: "needs staff fit" is neither a size to hand over
  // nor a diver nobody asked. It is an open job at the dock, and reading it as
  // either of the others is how a diver ends up kitted from a size the shop
  // does not have.
  if (fit.needsStaffFitAt) {
    return { state: "needs_staff_fit", note: fit.needsStaffFitNote?.trim() || null };
  }
  const items = rentedItems(fit).map((item) => ({ kind: item.kind, size: item.size }));
  if (items.length === 0) return { state: "own_kit" };
  return { state: "rents", items };
}
