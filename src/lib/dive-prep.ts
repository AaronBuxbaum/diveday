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
 *     air and surfaces as a blocker instead of quietly filling EANx.
 */

export type RentalItemKind = "bcd" | "regulator" | "wetsuit" | "boots" | "mask_fins" | "weights";

export type RentalFit = {
  rentsBcd: boolean;
  rentsRegulator: boolean;
  rentsWetsuit: boolean;
  rentsMaskFins: boolean;
  rentsWeights: boolean;
  bcdSize: string | null;
  wetsuitSize: string | null;
  bootSize: string | null;
  finSize: string | null;
  weightPreference: string | null;
};

export type PrepDiver = {
  bookingId: string;
  fullName: string;
  /** Null when the shop has never recorded a fit for this diver. */
  fit: RentalFit | null;
  wantsNitrox: boolean;
  hasVerifiedNitroxCard: boolean;
};

/** One row of the packing list: N of this item in this size, and who they're for. */
export type PrepLine = {
  kind: RentalItemKind;
  label: string;
  /** Null when the item is rented but no size was ever recorded. */
  size: string | null;
  count: number;
  divers: string[];
};

export type TankPlan = {
  /** Tanks per diver, per dive: total = diverCount × diveCount. */
  total: number;
  air: number;
  nitrox: number;
};

export type NitroxBlocker = {
  bookingId: string;
  fullName: string;
  reason: "no_verified_card";
};

export type DivePrepChecklist = {
  diveCount: number;
  diverCount: number;
  tanks: TankPlan;
  lines: PrepLine[];
  /** Divers who asked for enriched air but have no verified card — packed as air. */
  nitroxBlockers: NitroxBlocker[];
  /** Divers with no rental fit on file; staff still has to ask them. */
  diversWithoutFit: string[];
};

export const RENTAL_ITEM_LABELS: Record<RentalItemKind, string> = {
  bcd: "BCD",
  regulator: "Regulator",
  wetsuit: "Wetsuit",
  boots: "Boots",
  mask_fins: "Mask & fins",
  weights: "Weights",
};

/** Kit that has no size to record, so a blank is expected rather than a gap. */
export const UNSIZED_ITEM_KINDS: readonly RentalItemKind[] = ["regulator"];

/** Fixed order so the list reads the same way every morning. */
const KIND_ORDER: RentalItemKind[] = [
  "bcd",
  "regulator",
  "wetsuit",
  "boots",
  "mask_fins",
  "weights",
];

function size(value: string | null): string | null {
  return value?.trim() || null;
}

/**
 * The pieces one diver's fit asks for. Boots ride along with the suit — always,
 * even with no size recorded: fins don't fit over bare feet, so a missing boot
 * size is a loose end to chase, never a reason to leave boots off the list.
 */
function rentedItems(fit: RentalFit): { kind: RentalItemKind; size: string | null }[] {
  const items: { kind: RentalItemKind; size: string | null }[] = [];
  if (fit.rentsBcd) items.push({ kind: "bcd", size: size(fit.bcdSize) });
  if (fit.rentsRegulator) items.push({ kind: "regulator", size: null });
  if (fit.rentsWetsuit) {
    items.push({ kind: "wetsuit", size: size(fit.wetsuitSize) });
    items.push({ kind: "boots", size: size(fit.bootSize) });
  }
  if (fit.rentsMaskFins) items.push({ kind: "mask_fins", size: size(fit.finSize) });
  if (fit.rentsWeights) items.push({ kind: "weights", size: size(fit.weightPreference) });
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
}): DivePrepChecklist {
  const diveCount = Math.max(1, Math.trunc(input.plannedDives) || 1);
  const grouped = new Map<string, PrepLine>();
  const nitroxBlockers: NitroxBlocker[] = [];
  const diversWithoutFit: string[] = [];
  let nitroxDivers = 0;

  for (const diver of input.divers) {
    if (nitroxTanksApproved(diver)) nitroxDivers += 1;
    else if (diver.wantsNitrox) {
      nitroxBlockers.push({
        bookingId: diver.bookingId,
        fullName: diver.fullName,
        reason: "no_verified_card",
      });
    }

    if (!diver.fit) {
      diversWithoutFit.push(diver.fullName);
      continue;
    }
    for (const item of rentedItems(diver.fit)) {
      const key = `${item.kind}:${item.size?.toLowerCase() ?? ""}`;
      const line = grouped.get(key);
      if (line) {
        line.count += 1;
        line.divers.push(diver.fullName);
        continue;
      }
      grouped.set(key, {
        kind: item.kind,
        label: RENTAL_ITEM_LABELS[item.kind],
        size: item.size,
        count: 1,
        divers: [diver.fullName],
      });
    }
  }

  const lines = [...grouped.values()].sort((a, b) => {
    const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    // An unrecorded size sorts last so it reads as the loose end it is.
    if (a.size === null) return b.size === null ? 0 : 1;
    if (b.size === null) return -1;
    return a.size.localeCompare(b.size);
  });
  for (const line of lines) line.divers.sort((a, b) => a.localeCompare(b));

  const diverCount = input.divers.length;
  return {
    diveCount,
    diverCount,
    tanks: {
      total: diverCount * diveCount,
      nitrox: nitroxDivers * diveCount,
      air: (diverCount - nitroxDivers) * diveCount,
    },
    lines,
    nitroxBlockers,
    diversWithoutFit,
  };
}

/**
 * One-line fit for a manifest, check-in, or roster row.
 *
 * The three states are deliberately distinct. "Own kit" is something a diver
 * told us; "not asked" is something nobody has done yet. Collapsing them reads
 * as reassurance the shop has not earned — the walk-up who was never asked
 * turns up at the dock in booties expecting a BCD.
 */
export type RentalFitLine = {
  state: "not_recorded" | "own_kit" | "rents";
  text: string;
};

export function rentalFitLine(fit: RentalFit | null): RentalFitLine {
  if (!fit) return { state: "not_recorded", text: "No fit on file — not asked yet" };
  const parts = rentedItems(fit).map((item) =>
    item.size ? `${RENTAL_ITEM_LABELS[item.kind]} ${item.size}` : RENTAL_ITEM_LABELS[item.kind],
  );
  if (parts.length === 0) return { state: "own_kit", text: "Own kit" };
  return { state: "rents", text: parts.join(", ") };
}
