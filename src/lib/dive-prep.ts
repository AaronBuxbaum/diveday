/**
 * Trip prep: what the shop lays out before a boat leaves, derived purely from
 * each diver's rental fit and the trip's planned dives. This is a checklist
 * to pack against, never an allocation — nothing *here* reserves a particular
 * item. Reserving is the gear register's separate, opt-in act (`src/lib/gear.ts`,
 * `gear_reservations`; ADR 20260815-minimal-gear-register), layered beside
 * this checklist without changing a line of its math.
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

import { DAY_MS } from "@/lib/clock";
import type { DiveRecencyBand } from "@/lib/dive-recency";
import { isDiver, type ParticipantType, rentsGear, rentsKind } from "@/lib/participant-types";
import { nowDate } from "./clock";
import {
  rentalFitCompleteness,
  SIZED_RENTAL_KINDS,
  type SizedRentalKind,
  toRentableKinds,
} from "./rentals";

export type RentalItemKind =
  | "bcd"
  | "regulator"
  | "wetsuit"
  | "boots"
  | "mask_fins"
  | "weights"
  | "dive_computer"
  | "gopro"
  | "drysuit"
  | "hood"
  | "gloves"
  | "torch"
  | "smb";

/** The kinds a flagged diver's stated sizes are listed under (`statedSizeItems`). */
export type StatedSizeKind =
  | "bcd"
  | "wetsuit"
  | "boots"
  | "mask_fins"
  | "drysuit"
  | "hood"
  | "gloves";

export type RentalFit = {
  rentsBcd: boolean;
  rentsRegulator: boolean;
  rentsWetsuit: boolean;
  rentsMaskFins: boolean;
  rentsWeights: boolean;
  rentsDiveComputer: boolean;
  rentsGopro: boolean;
  rentsDrysuit: boolean;
  rentsHood: boolean;
  rentsGloves: boolean;
  rentsTorch: boolean;
  rentsSmb: boolean;
  bcdSize: string | null;
  wetsuitSize: string | null;
  /** On the drysuit scale, never the wetsuit's (issue 1414, schema.ts). */
  drysuitSize: string | null;
  /** Free text, like the drysuit's (H-102): a hood and gloves both by size and thickness. */
  hoodSize: string | null;
  gloveSize: string | null;
  bootSize: string | null;
  finSize: string | null;
  weightPreference: string | null;
  /**
   * **The diver is in a drysuit**, their own or ours (H-78, issue #1752) —
   * `rental_fit_profiles.dives_dry`. What the diver wears, where every
   * `rents*` flag above is what the shop hands over. The in-water weight check
   * keys on it (see `rentedItems`).
   */
  divesDry: boolean;
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
  /**
   * When a fit was last *stated*. Null means the row is here for something
   * other than a fit — today, only to hold the diver's free-text note, saved on
   * its own since issue 627. Read exactly as a missing row is: nothing to pack
   * from. Without it, every `rents_*` column's `true` default would put six
   * pieces nobody asked for on the packing list (schema.ts, `fit_stated_at`).
   */
  fitStatedAt?: Date | null;
};

/**
 * Whether this row records an actual fit, as opposed to existing only to carry
 * the diver's note. `undefined` reads as stated so a caller that builds a
 * `RentalFit` by hand (tests, the offline snapshot) is not silently dropped
 * from the packing list; only an explicit null means "note only".
 */
export function fitIsStated(fit: RentalFit): boolean {
  return fit.fitStatedAt !== null;
}

export type PrepDiver = {
  bookingId: string;
  personId: string;
  fullName: string;
  /** Null when the shop has never recorded a fit for this diver. */
  fit: RentalFit | null;
  wantsNitrox: boolean;
  hasVerifiedNitroxCard: boolean;
  /**
   * How long since this diver was last in the water, as they answered it on
   * `/ready`. Null for a booking taken before the question existed, or a diver
   * who skipped it — which is silence, not an answer, and renders nothing.
   */
  lastDivedBand: DiveRecencyBand | null;
  /** Lodging / hotel location stated by diver on /ready (text). */
  hotelPickupLocation?: string | null;
  /** Staff-set pickup time for this booking (e.g. "07:15"). */
  pickupTime?: string | null;
  /**
   * What this seat is for (ADR 20261007-participant-types). Absent is a
   * diver's. A rider is packed nothing and breathes no tank; a snorkeler is
   * packed the surface kit they rent and no tank.
   */
  participantType?: ParticipantType;
};

export type HotelPickupRun = {
  bookingId: string;
  diverName: string;
  hotelPickupLocation: string;
  pickupTime: string | null;
};

/**
 * Derives the morning's hotel van run from the roster's pickup requests.
 * Ordered by pickup time (earliest first), then untimed pickups by hotel name.
 */
export function buildHotelPickupList(divers: readonly PrepDiver[]): HotelPickupRun[] {
  const result: HotelPickupRun[] = [];
  for (const diver of divers) {
    if (diver.hotelPickupLocation?.trim()) {
      result.push({
        bookingId: diver.bookingId,
        diverName: diver.fullName,
        hotelPickupLocation: diver.hotelPickupLocation.trim(),
        pickupTime: diver.pickupTime ? diver.pickupTime.trim() : null,
      });
    }
  }

  return result.sort((a, b) => {
    if (a.pickupTime && b.pickupTime) {
      const cmp = a.pickupTime.localeCompare(b.pickupTime);
      if (cmp !== 0) return cmp;
    } else if (a.pickupTime) {
      return -1;
    } else if (b.pickupTime) {
      return 1;
    }
    const locCmp = a.hotelPickupLocation.localeCompare(b.hotelPickupLocation);
    if (locCmp !== 0) return locCmp;
    return a.diverName.localeCompare(b.diverName);
  });
}

/**
 * Which way the one packing list is read: down the rack (every BCD together,
 * with its sizes) or down the roster (every diver, with their pieces). One set
 * of pieces, two groupings — the packer picks whichever matches how they are
 * walking the shop this morning, and the choice rides in `?group=` so it
 * survives a reload and a shared link.
 */
export type PrepGrouping = "item" | "diver";

/** Narrows an untrusted `?group=`; anything else reads as the `item` default. */
export function isPrepGrouping(value: string | undefined): value is PrepGrouping {
  return value === "item" || value === "diver";
}

/** One piece to pull: an item, the size to pull it in, and whether that size is deferred. */
export type PrepPiece = {
  kind: RentalItemKind;
  size: string | null;
  fitAtCheckIn: boolean;
  /**
   * The weights piece of a diver in a drysuit, whose stated weighting is a
   * wetsuit answer and never a number to pack to (see `rentedItems`).
   */
  drysuitWeightCheck: boolean;
  /**
   * The fins piece of a diver in a drysuit, whose stated fin size is a bare
   * foot's and never the pair that goes over the boot (see `rentedItems`).
   */
  drysuitFinFit: boolean;
  /**
   * The gloves of a diver in a drysuit (H-102, dive-domain review). A drysuit
   * diver may wear wet gloves or dry gloves on a ring system, and those are
   * different things off the rack, so the line asks rather than reading like
   * any other pair to pull.
   */
  drysuitGloves: boolean;
  /**
   * **The diver's fit asks for this piece and the shop's catalog no longer
   * offers it.** The piece stays on the list and says so.
   *
   * Dropping it silently would be the write side's own bug moved one layer
   * down (`saveRentalFit`, issue #1755): the diver's answer was never
   * retracted, and a packing list that quietly loses a piece tells the packer
   * nothing while the fit behind it still records one. So the list
   * over-includes and names the reason, which is a loose end a staffer can
   * actually close — put the item back in the catalog, or ask the diver.
   */
  notOffered: boolean;
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
  /**
   * These divers are in drysuits, so the lead they need is settled in the water
   * rather than packed to a stated number (see `rentedItems`). A third kind of
   * absent size, kept apart from the other two for the same reason they are
   * kept apart from each other: the answer at the dock differs.
   */
  drysuitWeightCheck: boolean;
  /**
   * These divers are in drysuits, so the size on this line is the shoe size
   * they stated and the fins pulled against it have to clear a drysuit boot
   * (see `rentedItems`). A size-9 line for a drysuit diver and a size-9 line
   * for a wetsuit diver are two different pairs off the rack, so they are two
   * rows.
   */
  drysuitFinFit: boolean;
  /** These divers are in drysuits and rent gloves: wet or dry is still to settle (`PrepPiece`). */
  drysuitGloves: boolean;
  /**
   * This line's item is not in the shop's catalog any more (`PrepPiece`). A
   * property of the shop rather than of the diver, so it is the same answer
   * for every diver on the line and never splits one — which is why
   * {@link prepLineKey} does not read it.
   */
  notOffered: boolean;
};

/**
 * One diver's row of the same packing list: everything to pull for this
 * person, in the same fixed item order the by-item rows use.
 *
 * Every diver on the roster gets a row, including the ones with nothing to
 * pull. The by-item rows can leave them out — an item nobody rents has no row
 * to be in — but a roster to walk down cannot: "this diver needs nothing" is
 * the answer the packer came for, and dropping them sends someone back to the
 * guest list to work out whether the name was handled or merely absent.
 * `state` says which kind of nothing it is, because the fix differs: nobody
 * asked, versus they bring their own.
 */
export type PrepDiverLine = {
  bookingId: string;
  personId: string;
  fullName: string;
  items: PrepPiece[];
  state: "rents" | "own_kit" | "not_recorded";
  /** Carried through so the by-diver view can show it beside the name. */
  lastDivedBand: DiveRecencyBand | null;
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
  /**
   * The same pieces as `lines`, regrouped one row per diver. Built in the same
   * pass from the same `rentedItems` call, so the two groupings cannot drift
   * into telling the boat different things about one fit.
   */
  diverLines: PrepDiverLine[];
  /** Divers who asked for enriched air but have no verified card — packed as air. */
  nitroxBlockers: NitroxBlocker[];
  /**
   * **Divers the packing list can't be built from yet.**
   *
   * This used to mean "no fit row at all", which quietly excused the more
   * common gap: a diver who ticked BCD, wetsuit and weights and supplied only
   * a shoe size had a row, so the prep list called them done and the packer
   * found out at the rack. A fit is a *size record* (glossary — **Complete
   * rental fit**), so the question is per item, and `rentalFitCompleteness`
   * (src/lib/rentals.ts) is the one place that answers it.
   *
   * `state` keeps the two apart, because the fix differs: nobody has asked
   * this diver anything, versus somebody asked and some of it is still blank.
   * A partially-fitted diver still contributes every piece they rent to
   * `lines` — the sizes they *did* give are real, and dropping them would
   * under-pack the boat.
   */
  diversWithIncompleteFit: {
    fullName: string;
    personId: string;
    state: "not_recorded" | "incomplete";
    /**
     * The pieces with no size, as codes (`src/i18n/rental-labels.ts` resolves
     * them). Empty for `not_recorded`, where the answer is "all of it" and
     * naming five items would say less than the state already does.
     */
    missing: SizedRentalKind[];
  }[];
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
    statedSizes: { kind: StatedSizeKind; size: string }[];
    /**
     * Whole days since the flag was raised. A shortage is a fact about one
     * day, so an old flag is a prompt to re-ask the diver rather than a
     * standing truth — surfacing the age is what stops stale flags becoming
     * background noise the crew learns to skip past.
     */
    flaggedDaysAgo: number;
  }[];
};

/**
 * Fixed order so the list reads the same way every morning: the core kit a
 * packer walks the rack for, then the add-ons a particular dive calls for.
 *
 * **Exhaustive, and the compiler says so** (issue #1805, the same shape as
 * #1799's fleet order). `KIND_ORDER.indexOf` answers `-1` for a kind that is
 * not here, and `-1` sorts *first* — so the three add-ons added in September
 * led the packing table above the BCDs, and nobody saw it because no seeded
 * diver rented one. A kind with no position here is now a typecheck failure
 * rather than a silent promotion to the top of the rack.
 */
const KIND_ORDER = [
  "bcd",
  "regulator",
  "wetsuit",
  "boots",
  "drysuit",
  "mask_fins",
  "weights",
  "dive_computer",
  "hood",
  "gloves",
  "torch",
  "smb",
  // **Last, below the dive-specific add-ons** (`dive-domain-expert`). The
  // principle above is "the add-ons a particular dive calls for", and a GoPro
  // is called for by no dive: a light on a night departure and an SMB on a
  // drift departure *are* the dive, and the camera is the only piece here
  // whose absence changes nothing in the water. The bottom of a packing list
  // is what gets skipped at 6:40 with the truck loading, so it is the right
  // place for the one line that can be.
  "gopro",
] as const satisfies readonly RentalItemKind[];

type KindWithNoPackingPosition = Exclude<RentalItemKind, (typeof KIND_ORDER)[number]>;
/** Add the kind to `KIND_ORDER` above; this line is what fails if you don't. */
const _everyKindHasAPackingPosition: Record<KindWithNoPackingPosition, never> = {};

/**
 * Kit that has no size to record, so a blank is expected rather than a gap.
 *
 * **Derived, not listed** (issue #1805). This was a hand-kept list of three,
 * and it had drifted: a torch and an SMB have no `rental_fit_profiles` size
 * column either — `src/lib/rentals.ts` says so at `RENTABLE_ITEMS` and
 * enforces it in `SIZED_RENTAL_KINDS` — so a diver renting one read "Not
 * recorded" on the packing line, naming a gap that cannot be filled by
 * anybody. The complement of the sized kinds is the answer, and taking it from
 * the same constant is what stops the two lists disagreeing again: when a hood
 * and gloves gained a size each (H-102), they left this list by themselves.
 */
const SIZED = new Set<string>(SIZED_RENTAL_KINDS);
export const UNSIZED_ITEM_KINDS: readonly RentalItemKind[] = KIND_ORDER.filter(
  (kind) => !SIZED.has(kind),
);

function size(value: string | null): string | null {
  return value?.trim() || null;
}

/**
 * What makes two pieces of one kind the same packing row. A deferred size and
 * a drysuit's in-water weight check both carry a null size and mean different
 * things, so each gets its own sentinel rather than collapsing into the row
 * for "nobody wrote a size down". Exported because the page keys its rendered
 * rows by it: two rows the grouping kept apart must not share a React key.
 *
 * `notOffered` is deliberately absent. It is a fact about the shop's catalog,
 * so every piece of one kind on one departure carries the same answer and it
 * can never be what separates two rows.
 */
export function prepLineKey(piece: Omit<PrepPiece, "kind">): string {
  if (piece.fitAtCheckIn) return "\u0000fit";
  if (piece.drysuitWeightCheck) return "\u0000drysuit-weight";
  const stated = piece.size?.toLowerCase() ?? "";
  // A stated shoe size means one pair over a bare foot and another over a
  // drysuit boot, so the same string is two rows rather than one of two.
  if (piece.drysuitFinFit) return `\u0000drysuit-fin:${stated}`;
  // The same reason, one item over: a pair of L gloves over a wet hand and an
  // L pair for a drysuit diver are two questions at the rack.
  if (piece.drysuitGloves) return `\u0000drysuit-gloves:${stated}`;
  return stated;
}

/**
 * **Which pieces the shop still rents**, or `null` for "no catalog was handed
 * over", which reads as renting everything.
 *
 * Absent is the over-including direction on purpose, and it is the same answer
 * {@link rentalFitCompleteness} gives its own absent `offeredKinds`: a caller
 * with no catalog to hand should see every piece the fit asks for rather than a
 * list quietly short of one.
 */
type CatalogScope = ReadonlySet<string> | null;

function catalogScope(offeredKinds: readonly string[] | undefined): CatalogScope {
  return offeredKinds ? new Set<string>(toRentableKinds(offeredKinds)) : null;
}

/**
 * Whether this shop's catalog still offers a packing piece.
 *
 * **Boots take the wetsuit's answer.** They are not a catalog entry of their
 * own — nothing ticks them, they ride along with the suit (`RENTABLE_ITEMS` in
 * `src/lib/rentals.ts`) — so asking the catalog about `boots` directly would
 * read every shop on earth as having dropped them.
 */
function offersKind(offered: CatalogScope, kind: RentalItemKind): boolean {
  if (offered === null) return true;
  return offered.has(kind === "boots" ? "wetsuit" : kind);
}

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
 *
 * `offered` is the shop's own catalog. A piece the catalog no longer offers is
 * **kept and marked** rather than filtered out (`PrepPiece.notOffered`). No
 * other line reads the catalog: the two drysuit consequences follow
 * `inDrysuit` below, a fact about the diver that no catalog edit changes.
 */
function rentedItems(fit: RentalFit, offered: CatalogScope = null): PrepPiece[] {
  const flagged = Boolean(fit.needsStaffFitAt);
  const offers = (kind: RentalItemKind) => offersKind(offered, kind);
  /**
   * **The diver is in a drysuit**, whoever owns it (H-78).
   *
   * `divesDry` is the diver's own answer about what they wear, and the writer
   * holds `rents_drysuit` to it (a rented drysuit is a dry diver — a check
   * constraint on `rental_fit_profiles`). Reading both here is for a fit built
   * by hand: a suit we hand over is a suit they are in, whatever the other
   * flag says, and over-reading is the safe direction for a weight check.
   *
   * It drives **the weights line** and **the fins line**. `weightPreference`
   * is a wetsuit answer and a drysuit needs two to four kilos more, so the
   * lead is settled in the water. And every drysuit diver has a boot on, a
   * rented suit's vulcanised one or their own, two to three fin sizes bigger
   * than the bare foot, so the fins are sized up over it. Both used to key on
   * whether the shop was renting a suit — so a diver in their own drysuit,
   * most drysuit divers, had their wetsuit number printed as one to pack to
   * and fins packed to their bare foot (issues #1752 and #1810), and so did a
   * diver whose shop had since dropped drysuits from its catalog. The catalog
   * says what the shop hands over; it says nothing about what the diver wears.
   *
   * The drysuit piece itself stays when the catalog drops it, marked
   * `notOffered`, so the packer still meets the contradiction on the surface
   * where gear is reasoned about.
   */
  const inDrysuit = fit.divesDry || fit.rentsDrysuit;
  /** A piece whose size is the thing in question — blanked when flagged. */
  const sized = (kind: RentalItemKind, value: string | null): PrepPiece =>
    flagged
      ? {
          kind,
          size: null,
          fitAtCheckIn: true,
          drysuitWeightCheck: false,
          drysuitFinFit: false,
          drysuitGloves: false,
          notOffered: !offers(kind),
        }
      : {
          kind,
          size: size(value),
          fitAtCheckIn: false,
          drysuitWeightCheck: false,
          drysuitFinFit: false,
          drysuitGloves: false,
          notOffered: !offers(kind),
        };
  /** A piece with no size at all; a flag never changes what to pack. */
  const unsized = (kind: RentalItemKind): PrepPiece => ({
    kind,
    size: null,
    fitAtCheckIn: false,
    drysuitWeightCheck: false,
    drysuitFinFit: false,
    drysuitGloves: false,
    notOffered: !offers(kind),
  });
  /**
   * Weights: a piece that records a value but has no stock *size* to be short
   * of, so the H-06 flag leaves it alone. Lead is bulk stock in 2 lb
   * increments — a shop is never "out of 12 lb" — and usual weighting is the
   * most safety-relevant number in the fit. Under-weighting is a diver who
   * can't hold a safety stop; over-weighting is an over-inflated BCD and a bad
   * ascent. Blanking it because there's no L BCD trades a real number for
   * nothing, and "bring a range in their band" is meaningless applied to lead.
   *
   * **Unless they are in a drysuit** — `inDrysuit`, theirs or ours, whatever
   * the shop's catalog says. `weightPreference` is one free-text
   * answer to a question both fit forms ask against a wetsuit ("Usually 12 lb
   * with 3 mm suit" in staff/divers.json, "e.g. 16 lb with a 3 mm suit" in
   * diver.json), so on a drysuit it is short by the two to four kilos the suit
   * and its undergarment add — short, which is the direction that cannot hold
   * a safety stop on a near-empty tank in a suit the diver cannot fully vent.
   * Nothing here knows their undergarment, so the number is neither corrected
   * nor quietly packed to: the line says the weighting is settled in the
   * water, and the stated answer stays where it was written, on the diver
   * profile. Blanking it here rather than at the packing table is deliberate —
   * `rentalFitLine` feeds the roll call, the offline manifest and the roster
   * from these same pieces, and the rail is the last place a wetsuit number
   * should appear beside "Drysuit ML". `rentalFitLine` carries the flag there
   * too, so the blank reads as a check rather than as nobody having asked.
   */
  const weights = (value: string | null): PrepPiece => {
    if (inDrysuit) {
      return {
        kind: "weights",
        size: null,
        fitAtCheckIn: false,
        drysuitWeightCheck: true,
        drysuitFinFit: false,
        drysuitGloves: false,
        notOffered: !offers("weights"),
      };
    }
    return {
      kind: "weights",
      size: size(value),
      fitAtCheckIn: false,
      drysuitWeightCheck: false,
      drysuitFinFit: false,
      drysuitGloves: false,
      notOffered: !offers("weights"),
    };
  };

  /**
   * Mask & fins. The fit forms ask **one shoe size** for them — "Fin & boot
   * size", placeholder "US 9 / EU 42" in staff/divers.json and diver.json
   * alike, and the actions behind both write that one answer to `boot_size`
   * *and* `fin_size` (divers/[personId]/actions.ts, ready/[token]/actions.ts).
   * A drysuit's vulcanised boot is two to three fin sizes bigger than the bare
   * foot inside it. Packed to the stated number, the fin does not go on: the
   * diver sits on the bench, the boat waits, and the fix is somebody's spare
   * pair. The size stays on the line, because it is the number the packer
   * sizes *up* from, and the line carries the flag that says so rather than
   * reading like any other size to pull. A diver already flagged for hands-on
   * fitting keeps "fit at check-in", which is this same job done in person.
   *
   * **Whenever the diver dives dry**, owned suit or rented (H-78 names this
   * signal): every drysuit has a boot, and the stated shoe size is the foot,
   * not the boot.
   */
  const maskFins = (): PrepPiece => ({
    ...sized("mask_fins", fit.finSize),
    drysuitFinFit: inDrysuit && !flagged,
  });

  const items: PrepPiece[] = [];
  if (fit.rentsBcd) items.push(sized("bcd", fit.bcdSize));
  if (fit.rentsRegulator) items.push(unsized("regulator"));
  if (fit.rentsWetsuit) {
    items.push(sized("wetsuit", fit.wetsuitSize));
    items.push(sized("boots", fit.bootSize));
  }
  if (fit.rentsMaskFins) items.push(maskFins());
  if (fit.rentsWeights) items.push(weights(fit.weightPreference));
  if (fit.rentsDiveComputer) items.push(unsized("dive_computer"));
  if (fit.rentsGopro) items.push(unsized("gopro"));
  // **One piece, and no boot beside it** (issue 1414). Most rental drysuits
  // have their boots vulcanised on: they come off the wall with the suit, the
  // shop cannot be out of them separately, and there is nothing extra to pack.
  // Deliberately a different shape from `rentsWetsuit` above, which pushes two
  // pieces from one shoe-size answer — do not "fix" this to match it.
  //
  // **Most, not all.** A neoprene-sock suit worn with separate rock boots is
  // real, and it is stocked by exactly the cold-water and tech-leaning fleets
  // most likely to rent drysuits at all. Nothing on the fit can tell the two
  // shapes apart — it records a size, not a suit — so the shop says so in the
  // size: `drysuitSize` is free text staff-side ("ML, rock boot 9") and reaches
  // the packing list verbatim. Pushing a second piece here on a guess packs
  // boots the shop does not own, which is the failure issue 1414 named.
  //
  // The fins that go over that boot are a size the shop cannot read off the
  // shoe size either, which is what `maskFins` above marks rather than what
  // this line handles.
  if (fit.rentsDrysuit) items.push(sized("drysuit", fit.drysuitSize));
  // Two kinds with a free-text size each (H-102, issue #1816).
  if (fit.rentsHood) items.push(sized("hood", fit.hoodSize));
  if (fit.rentsGloves) {
    items.push({ ...sized("gloves", fit.gloveSize), drysuitGloves: inDrysuit && !flagged });
  }
  // The two add-ons that carry no size (see `RENTABLE_ITEMS`).
  if (fit.rentsTorch) items.push(unsized("torch"));
  if (fit.rentsSmb) items.push(unsized("smb"));
  // **Sorted, not pushed in order** (issue #1805, `dive-domain-expert`). The
  // pushes above are grouped by the flag that produces them — the wetsuit's
  // two pieces, the drysuit's one — and that grouping is not `KIND_ORDER`:
  // the drysuit went out *last*, after the GoPro, while the by-item table
  // sorts it fifth. So the two groupings disagreed about the same departure,
  // and `rentalFitLine` carried the wrong one to the roll call, the offline
  // manifest and the diver record: a drysuit diver's rail line read "Mask &
  // fins over the drysuit boot · Weights: weight check in the water · Drysuit
  // ML", putting both derived instructions ahead of the fact they derive from.
  // Sorting here makes the invariant hold by construction rather than by a
  // discipline the next added kind has to remember.
  return items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/**
 * The sizes a flagged diver asked for, as one piece per stated size. Only the
 * pieces whose size the flag blanks on the packing line — the fitter already
 * sees everything else there. Empty when nothing sized was recorded, which is
 * its own useful signal: there is no starting point to work from.
 */
function statedSizeItems(fit: RentalFit): { kind: StatedSizeKind; size: string }[] {
  const items: { kind: StatedSizeKind; size: string }[] = [];
  const bcdSize = size(fit.bcdSize);
  if (fit.rentsBcd && bcdSize) items.push({ kind: "bcd", size: bcdSize });
  if (fit.rentsWetsuit) {
    const wetsuitSize = size(fit.wetsuitSize);
    if (wetsuitSize) items.push({ kind: "wetsuit", size: wetsuitSize });
    const bootSize = size(fit.bootSize);
    if (bootSize) items.push({ kind: "boots", size: bootSize });
  }
  // The flag blanks a drysuit's size on the packing line like any other sized
  // piece, so the fitter needs the size the diver actually asked for (issue 1414).
  const drysuitSize = size(fit.drysuitSize);
  if (fit.rentsDrysuit && drysuitSize) items.push({ kind: "drysuit", size: drysuitSize });
  const hoodSize = size(fit.hoodSize);
  if (fit.rentsHood && hoodSize) items.push({ kind: "hood", size: hoodSize });
  const gloveSize = size(fit.gloveSize);
  if (fit.rentsGloves && gloveSize) items.push({ kind: "gloves", size: gloveSize });
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
 * with no fit on file — or with half of one — still contributes tanks and is
 * named in `diversWithIncompleteFit` so the gap is visible rather than absent.
 */
export function buildDivePrepChecklist(input: {
  divers: PrepDiver[];
  plannedDives: number;
  /** Names of the trip's diving crew (instructor/divemaster) — air tanks only, no rental fit. */
  divingCrew?: string[];
  /**
   * The shop's own rental catalog (`shops.rental_items`), read by **both**
   * halves of this list.
   *
   * It scopes the completeness question to gear the shop still hands over, so
   * a fit written before the shop stopped renting BCDs doesn't flag a size
   * nobody can be given. It also decides which pieces are still the shop's to
   * hand over at all: a piece the catalog has dropped is marked
   * (`PrepPiece.notOffered`). It never decides whether a diver is in a
   * drysuit: that is their own answer (`divesDry`, H-78), so the weight check
   * and the fin sizing survive a catalog edit.
   *
   * Omit it and every item counts — which is what a caller with no catalog to
   * hand should want, since over-including is the safe direction.
   */
  offeredKinds?: readonly string[];
  /** Injectable for tests; defaults to the clock (src/lib/clock.ts). */
  now?: Date;
}): DivePrepChecklist {
  const diveCount = Math.max(1, Math.trunc(input.plannedDives) || 1);
  // One catalog read for the whole departure, shared by the completeness
  // question below and by `rentedItems`, so the nag and the packing line can
  // never disagree about what this shop still rents.
  const offered = catalogScope(input.offeredKinds);
  const grouped = new Map<string, PrepLine>();
  const diverLines: PrepDiverLine[] = [];
  const nitroxBlockers: NitroxBlocker[] = [];
  const diversWithIncompleteFit: DivePrepChecklist["diversWithIncompleteFit"] = [];
  const now = input.now ?? nowDate();
  const diversNeedingStaffFit: DivePrepChecklist["diversNeedingStaffFit"] = [];
  let nitroxDivers = 0;

  // Gear and tanks are for the people who get in the water. A rider takes
  // nothing from the rack; a snorkeler takes surface kit and no cylinder.
  // Neither is dropped from any head count: this is the packing list, and the
  // manifest and roll call count everyone (ADR 20261007-participant-types).
  const inWater = input.divers.filter((diver) => rentsGear(diver.participantType));
  for (const diver of inWater) {
    const diving = isDiver(diver.participantType);
    if (diving && nitroxTanksApproved(diver)) nitroxDivers += 1;
    else if (diver.wantsNitrox) {
      nitroxBlockers.push({
        bookingId: diver.bookingId,
        personId: diver.personId,
        fullName: diver.fullName,
        reason: "no_verified_card",
      });
    }

    // Asked before the pieces are laid out, and of every diver — including the
    // ones who *have* a row. A partial fit is named here and still packed
    // below: the sizes they did give are real, and dropping their pieces to
    // punish the gap would send the boat out short.
    // Read for the seat: a diver is chased for the whole fit, a snorkeler for
    // the surface kit only, the same rule the trip pulse and Today count by.
    const fit = rentalFitCompleteness(diver.fit, input.offeredKinds, diver.participantType);
    if (fit.state !== "complete") {
      diversWithIncompleteFit.push({
        fullName: diver.fullName,
        personId: diver.personId,
        state: fit.state,
        missing: fit.state === "incomplete" ? fit.missing : [],
      });
    }
    // Nothing on file is nothing to pack from — the only case that skips the
    // lines below. The roster grouping still gets its row: a name with no
    // answer beside it is the loose end, and leaving it out hides it.
    if (!diver.fit || !fitIsStated(diver.fit)) {
      diverLines.push({
        bookingId: diver.bookingId,
        personId: diver.personId,
        fullName: diver.fullName,
        items: [],
        state: "not_recorded",
        // How long since they last dived is a diver's question; a snorkeler
        // is not asked it (ADR 20261007-participant-types).
        lastDivedBand: isDiver(diver.participantType) ? diver.lastDivedBand : null,
      });
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
    // One call, both groupings. `rentedItems` sorts into `KIND_ORDER` before
    // it returns, so a diver's row reads down the rack in the same order the
    // by-item rows do — and neither grouping can hold a piece the other
    // doesn't.
    const items = rentedItems(diver.fit, offered).filter((item) =>
      rentsKind(diver.participantType, item.kind),
    );
    diverLines.push({
      bookingId: diver.bookingId,
      personId: diver.personId,
      fullName: diver.fullName,
      items,
      state: items.length > 0 ? "rents" : "own_kit",
      lastDivedBand: isDiver(diver.participantType) ? diver.lastDivedBand : null,
    });
    for (const item of items) {
      const key = `${item.kind}:${prepLineKey(item)}`;
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
        drysuitWeightCheck: item.drysuitWeightCheck,
        drysuitFinFit: item.drysuitFinFit,
        drysuitGloves: item.drysuitGloves,
        notOffered: item.notOffered,
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
    if (a.size === null) {
      if (b.size !== null) return 1;
      // Both blank: an in-water weight check is an instruction, an unrecorded
      // size is a gap, and the instruction is the one the packer acts on.
      if (a.drysuitWeightCheck !== b.drysuitWeightCheck) return a.drysuitWeightCheck ? -1 : 1;
      // Same reason, same order: "fins that clear a drysuit boot" is a job,
      // "nobody wrote a shoe size down" is a gap.
      if (a.drysuitFinFit !== b.drysuitFinFit) return a.drysuitFinFit ? -1 : 1;
      if (a.drysuitGloves !== b.drysuitGloves) return a.drysuitGloves ? -1 : 1;
      return 0;
    }
    if (b.size === null) return -1;
    const bySize = a.size.localeCompare(b.size);
    if (bySize !== 0) return bySize;
    // One stated size, two rows (see `prepLineKey`): the bare-foot pair first,
    // the drysuit pair under it, in that order on every render.
    if (a.drysuitFinFit !== b.drysuitFinFit) return a.drysuitFinFit ? 1 : -1;
    if (a.drysuitGloves !== b.drysuitGloves) return a.drysuitGloves ? 1 : -1;
    return 0;
  });
  for (const line of lines) line.divers.sort((a, b) => a.localeCompare(b));

  // Tanks are counted for divers alone.
  const diverCount = inWater.filter((diver) => isDiver(diver.participantType)).length;
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
    // Alphabetical, so the roster grouping is a list to walk down rather than
    // whatever order the roster query happened to return.
    diverLines: diverLines.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    nitroxBlockers,
    diversWithIncompleteFit,
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
  | {
      state: "rents";
      /**
       * `drysuitFinFit` rides along on the fins of a diver in a drysuit: their
       * stated size is a shoe size and the pair has to clear the boot. The
       * rail is the last place a bare-foot number should read like the pair to
       * hand over (see `rentedItems`). Absent rather than `false` on every
       * other piece, so a reader that has never heard of it is unchanged.
       */
      items: {
        kind: RentalItemKind;
        size: string | null;
        drysuitFinFit?: true;
        /**
         * The weights of a diver in a drysuit: no number, because the stated
         * one is a wetsuit answer (see `rentedItems`). Carried so the rail says
         * why the size is blank — a bare null there reads as "nobody wrote a
         * number down", which is a different job at the ladder. Absent rather
         * than `false`, like `drysuitFinFit`.
         */
        drysuitWeightCheck?: true;
        /** The gloves of a diver in a drysuit: wet or dry is still to settle. Absent rather than `false`. */
        drysuitGloves?: true;
        /**
         * A piece the shop's catalog no longer offers. Kept rather than
         * filtered for the same reason `PrepPiece.notOffered` is kept: the
         * diver asked for it and the shop has to meet that, not lose it. What
         * it adds here is the marker, so a one-line fit cannot read a suit
         * nobody is handing over as an ordinary piece to fetch — the rail and
         * the packing list said different things about the same departure
         * until it existed (issue #1804). Absent rather than `false`, like
         * `drysuitFinFit`.
         */
        notOffered?: true;
      }[];
    };

/**
 * `offeredKinds` is the shop's catalog, and it is optional for the same reason
 * it is optional on {@link buildDivePrepChecklist}: a caller with none to hand
 * sees every piece the fit asks for. A caller that **has** one should pass it,
 * so a piece the shop stopped renting reads as such on the rail too
 * (`notOffered`, issue #1755's review).
 */
export function rentalFitLine(
  fit: RentalFit | null,
  offeredKinds?: readonly string[],
  /**
   * The seat's type, when the line is for a seat: a snorkeler's line names the
   * surface kit only, a rider's nothing (`rentsKind`, ADR
   * 20261007-participant-types). A dive size on file stays on the diver's
   * record; it is just not what this seat is handed on the dock.
   */
  participantType?: ParticipantType | null,
): RentalFitLine {
  // A row that exists only to hold the diver's note reads exactly as no row at
  // all: they have not answered the gear question, so there is nothing to pack
  // from and nothing to claim they brought.
  if (!fit || !fitIsStated(fit)) return { state: "not_recorded" };
  // A fourth state on purpose: "needs staff fit" is neither a size to hand over
  // nor a diver nobody asked. It is an open job at the dock, and reading it as
  // either of the others is how a diver ends up kitted from a size the shop
  // does not have.
  if (fit.needsStaffFitAt) {
    return { state: "needs_staff_fit", note: fit.needsStaffFitNote?.trim() || null };
  }
  const items = rentedItems(fit, catalogScope(offeredKinds))
    .filter((item) => participantType === undefined || rentsKind(participantType, item.kind))
    .map((item) => ({
      kind: item.kind,
      size: item.size,
      ...(item.drysuitFinFit ? { drysuitFinFit: true as const } : {}),
      ...(item.drysuitWeightCheck ? { drysuitWeightCheck: true as const } : {}),
      ...(item.drysuitGloves ? { drysuitGloves: true as const } : {}),
      ...(item.notOffered ? { notOffered: true as const } : {}),
    }));
  if (items.length === 0) return { state: "own_kit" };
  return { state: "rents", items };
}
