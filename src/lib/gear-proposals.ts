import { groupUnitsForSize } from "./gear";
import { sizedRentalKindOfGearKind } from "./rentals";

/**
 * One piece a diver wants this departure, as the proposal reads it.
 *
 * `sizeIsAStart` marks a piece whose pull is a person's call: a drysuit
 * diver's fins (the number is a shoe size, and the pair has to clear the
 * boot) and a drysuit diver's gloves (wet or dry is still to settle). The
 * packing list already says so in words (`rentalFitLine`); a proposal that
 * matched the bare number would quietly undo that warning.
 */
export type ProposalNeed = {
  kind: string;
  size: string | null;
  sizeIsAStart?: true;
};

export type ProposalUnit = {
  id: string;
  label: string;
  size: string | null;
  serviceState: { state: string };
  /**
   * The unit last came home flagged for a service concern and nobody has
   * written the care that answers it since (`serviceConcernStillOpen`). Never
   * proposed; the picker still offers it, labelled.
   */
  serviceConcern?: boolean;
};

/**
 * One diver's row as the proposal reads it. `wantsNitrox` keeps a regulator
 * off the row: the register cannot yet say which regulators are O2-clean, so
 * DiveDay does not choose one for an enriched-air diver.
 */
export type ProposalRow = {
  bookingId: string;
  wanted: readonly ProposalNeed[];
  wantsNitrox?: boolean;
};

/** The key a proposal is filed under: one booking, one kind. */
export function proposalKey(bookingId: string, kind: string): string {
  return `${bookingId}:${kind}`;
}

/**
 * **A unit offered for every piece the register can answer on its own** (UX
 * audit 2026-10-07, item 9). The Gear tab was one "Pick a unit…" select per
 * piece, 23 on a seeded departure, every morning. This proposes the obvious
 * pick so staff confirm instead of choose; the rows it cannot answer stay
 * open with their picker.
 *
 * A proposal, never an assignment: nothing is reserved until a staffer taps
 * (H-06 lets staff assign; a size label matching is not a fit check), and the
 * exclusion constraint stays the only arbiter of availability at write time.
 *
 * What it proposes, and what it leaves to a person:
 *
 * - **A sized piece** (BCD, wetsuit, boots, fins, drysuit, per
 *   `sizedRentalKindOfGearKind`) only from units *exactly* the size on
 *   file — the same exact-match band the picker heads with that size. No size
 *   on file, or a size that is only a starting point (`sizeIsAStart`), is no
 *   proposal: those are the rows a person has to fit. Exact-size matching
 *   reads the size label only: it does not cover a wetsuit's thickness or cut.
 * - **A sizeless piece** (a mask, a regulator, a computer) only from units
 *   with no size label. A mask labelled "Kids" or "RX -4.0" was labelled for
 *   somebody, and handing it over is a person's call.
 * - **Never weights.** Lead is bulk stock, not a tagged unit to choose.
 * - **Never a regulator for a diver who asked for nitrox**, until the
 *   register can say which regulators are O2-clean.
 * - **Never a unit whose service clock has lapsed, nor one that came home
 *   with a service concern nobody has serviced since.** The picker still
 *   offers both, labelled, because the dock decides; a proposal is DiveDay
 *   choosing, and it does not choose an overdue regulator. A unit coming due
 *   soon is proposed only after every unit that is not, and its line says so.
 * - **Never one unit twice.** Rows are served in the order given (the
 *   roster's), each taking the first candidate nobody above has taken, so
 *   six L divers against four L BCDs leaves the last two open rather than
 *   proposing a unit the first confirm would make a refusal.
 */
export function proposeRentalUnits<U extends ProposalUnit>(
  rows: readonly ProposalRow[],
  freeByKind: ReadonlyMap<string, readonly U[]>,
): Map<string, U> {
  const taken = new Set<string>();
  const proposals = new Map<string, U>();
  for (const row of rows) {
    for (const need of row.wanted) {
      const free = freeByKind.get(need.kind) ?? [];
      const sized = sizedRentalKindOfGearKind(need.kind) !== null;
      let candidates: readonly U[];
      if (need.sizeIsAStart || need.kind === "weights") continue;
      if (need.kind === "regulator" && row.wantsNitrox) continue;
      if (sized) {
        if (!need.size?.trim()) continue;
        candidates = groupUnitsForSize(free, need.size).exact;
      } else {
        candidates = groupUnitsForSize(free, null).rest.filter((unit) => !unit.size?.trim());
      }
      const usable = candidates.filter(
        (unit) =>
          !taken.has(unit.id) && unit.serviceState.state !== "overdue" && !unit.serviceConcern,
      );
      const pick =
        usable.find((unit) => unit.serviceState.state !== "due_soon") ?? usable[0] ?? null;
      if (!pick) continue;
      taken.add(pick.id);
      proposals.set(proposalKey(row.bookingId, need.kind), pick);
    }
  }
  return proposals;
}
