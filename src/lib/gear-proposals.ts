import { gearServiceKeepsUnitBack, groupUnitsForSize } from "./gear";
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
  /**
   * A regulator the shop keeps for enriched air (`gear_items.nitrox_designated`,
   * issue #2207). Only `true` counts; null is "not said".
   */
  nitroxDesignated?: boolean | null;
  /** A wetsuit's thickness in millimetres (`gear_items.thickness_mm`, issue #2206). */
  thicknessMm?: number | null;
};

/**
 * What the departure says that a proposal reads: the wetsuit the boat is
 * running today (`trips.wetsuit_thickness_mm`, issue #2206). Absent or null
 * is "not said", and then no wetsuit is proposed.
 */
export type ProposalDeparture = { wetsuitThicknessMm?: number | null };

/**
 * One diver's row as the proposal reads it. `wantsNitrox` decides which side
 * of the shop's designated set its regulator comes from (see
 * `proposeRentalUnits`).
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
 * (H-20260724-initial-gear-policy-sizing lets staff assign; a size label matching is not a fit check), and the
 * exclusion constraint stays the only arbiter of availability at write time.
 *
 * What it proposes, and what it leaves to a person:
 *
 * - **A sized piece** (BCD, wetsuit, boots, fins, drysuit, per
 *   `sizedRentalKindOfGearKind`) only from units *exactly* the size on
 *   file — the same exact-match band the picker heads with that size. No size
 *   on file, or a size that is only a starting point (`sizeIsAStart`), is no
 *   proposal: those are the rows a person has to fit. Exact-size matching
 *   reads the size label only, so it says nothing of a suit's cut.
 * - **A wetsuit only when its thickness is the departure's too** (issue
 *   #2206; Aaron 2026-10-13): the size *and* `thicknessMm` both match the
 *   day's `wetsuitThicknessMm`. The day not saying, or the unit not saying,
 *   is no proposal: the L diver on a February wreck day is otherwise handed
 *   the first free L, which may be a 3 mm shorty on a 7 mm day.
 * - **A sizeless piece** (a mask, a regulator, a computer) only from units
 *   with no size label. A mask labelled "Kids" or "RX -4.0" was labelled for
 *   somebody, and handing it over is a person's call.
 * - **Never weights.** Lead is bulk stock, not a tagged unit to choose.
 * - **A nitrox diver's regulator only from the shop's designated set, and an
 *   air diver's only from outside it** (`nitroxDesignated`, issue #2207).
 *   None when that side has nothing free. The second half is the shop's own
 *   policy read back: a set kept for enriched air is kept off air fills,
 *   which is the point of keeping one, so DiveDay does not hand it to an air
 *   diver. The picker still offers every free regulator to everyone, the
 *   designated ones labelled on a nitrox diver's row: a person may hand over
 *   any of them (a standard regulator is fine to 40% for most agencies), and
 *   refusing that would be a boarding gate in disguise.
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
  departure: ProposalDeparture = {},
): Map<string, U> {
  const dayThickness = departure.wetsuitThicknessMm ?? null;
  const taken = new Set<string>();
  const proposals = new Map<string, U>();
  for (const row of rows) {
    for (const need of row.wanted) {
      const free = freeByKind.get(need.kind) ?? [];
      const sized = sizedRentalKindOfGearKind(need.kind) !== null;
      let candidates: readonly U[];
      if (need.sizeIsAStart || need.kind === "weights") continue;
      if (sized) {
        if (!need.size?.trim()) continue;
        candidates = groupUnitsForSize(free, need.size).exact;
      } else {
        candidates = groupUnitsForSize(free, null).rest.filter((unit) => !unit.size?.trim());
      }
      if (need.kind === "wetsuit") {
        if (dayThickness === null) continue;
        candidates = candidates.filter((unit) => unit.thicknessMm === dayThickness);
      }
      if (need.kind === "regulator") {
        const nitrox = row.wantsNitrox === true;
        candidates = candidates.filter((unit) => (unit.nitroxDesignated === true) === nitrox);
      }
      const usable = candidates.filter(
        (unit) => !taken.has(unit.id) && !gearServiceKeepsUnitBack(unit),
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
