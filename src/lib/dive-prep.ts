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
import { nowDate } from "./clock";
import { rentalFitCompleteness, type SizedRentalKind, toRentableKinds } from "./rentals";
import { hasSupportNeeds, type SupportNeeds, supportDiversToArrange } from "./support-needs";

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
  | "hood_gloves"
  | "torch"
  | "smb";

export type RentalFit = {
  rentsBcd: boolean;
  rentsRegulator: boolean;
  rentsWetsuit: boolean;
  rentsMaskFins: boolean;
  rentsWeights: boolean;
  rentsDiveComputer: boolean;
  rentsGopro: boolean;
  rentsDrysuit: boolean;
  rentsHoodGloves: boolean;
  rentsTorch: boolean;
  rentsSmb: boolean;
  bcdSize: string | null;
  wetsuitSize: string | null;
  /** On the drysuit scale, never the wetsuit's (issue 1414, schema.ts). */
  drysuitSize: string | null;
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
   * What this diver's dive needs set up, as they answered it on `/ready` (ADR
   * 20260827-support-needs-are-a-record-about-the-dive). Null or absent when
   * nobody has asked, which is the ordinary case.
   */
  supportNeeds?: SupportNeeds | null;
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
    statedSizes: { kind: "bcd" | "wetsuit" | "boots" | "mask_fins" | "drysuit"; size: string }[];
    /**
     * Whole days since the flag was raised. A shortage is a fact about one
     * day, so an old flag is a prompt to re-ask the diver rather than a
     * standing truth — surfacing the age is what stops stale flags becoming
     * background noise the crew learns to skip past.
     */
    flaggedDaysAgo: number;
  }[];
  /**
   * **What the day has been asked to set up, and for whom.**
   *
   * Divers who stated something a crew plans around, plus the departure's total
   * in-water support requirement (ADR
   * 20260827-support-needs-are-a-record-about-the-dive). Empty for almost every
   * departure, and empty renders nothing.
   *
   * `supportDiversNeeded` is the figure a shop reads beside its rostered crew
   * when deciding whether it has the day covered — the same relationship
   * `src/lib/divemaster-ratio.ts` has with `inWaterDivemasterCount`, and the
   * same authority: **none**. Nothing here compares the two and refuses
   * anything. A departure short of this number sails, and the shop has a
   * conversation.
   */
  supportNeeds: {
    /**
     * How many in-water supporters the **shop** has to find, which is not how
     * many will be in the water: a diver bringing their own adaptive-trained
     * buddy needs seats and a team, not crew.
     */
    supportDiversToArrange: number;
    divers: { personId: string; fullName: string; needs: SupportNeeds }[];
    /**
     * Every name on this departure, divers and diving crew, for the "dives
     * with" line to be checked against (issue #1068).
     *
     * Assembled here rather than at each surface so the prep list and the
     * manifest cannot answer the same question differently — a diver who named
     * the divemaster they always pair with must not read "on this departure"
     * the day before and "not booked" at the rail.
     */
    rosterNames: string[];
  };
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
  "drysuit",
  "mask_fins",
  "weights",
  "dive_computer",
  "gopro",
];

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
 * **kept and marked** rather than filtered out (`PrepPiece.notOffered`); what
 * it loses is the right to change any *other* line, which is the whole of
 * `inShopDrysuit` below.
 */
function rentedItems(fit: RentalFit, offered: CatalogScope = null): PrepPiece[] {
  const flagged = Boolean(fit.needsStaffFitAt);
  const offers = (kind: RentalItemKind) => offersKind(offered, kind);
  /**
   * **A drysuit off this shop's wall is actually going out to this diver.**
   *
   * `rents_drysuit` survives a shop dropping drysuits from its catalog, which
   * is correct: the diver's answer was theirs and a catalog edit is not the
   * diver speaking (`saveRentalFit`, issue #1755, and the glossary's **Rental
   * catalog**). But three things on this list are conditioned on a rental suit
   * being handed over, and none of them may be derived from a flag the catalog
   * contradicts:
   *
   * 1. **The weights line loses its number.** `weightPreference` is a wetsuit
   *    answer and a drysuit needs two to four kilos more, so the lead is
   *    settled in the water. No suit going out, no correction to make — and
   *    withholding the most safety-relevant number in the fit over a suit
   *    nobody is handing over is the expensive direction: under-weighted is
   *    the diver who cannot hold a safety stop.
   * 2. **The fins line sizes up over a boot.** A vulcanised drysuit boot is
   *    two to three fin sizes bigger than the foot in it. With no boot in the
   *    picture that instruction packs a pair two to three sizes too big, which
   *    is a fin that comes off on a drift dive.
   * 3. **The card advisory** (`src/lib/drysuit-card.ts`), which is the
   *    shop-facing half of the same fact and is scoped there for the same
   *    reason.
   *
   * All three go, not some. The shared argument is that none of them is about
   * the drysuit *piece* — each is a claim about what else changes **because a
   * rental suit is going out** — and a contradicted flag does not say that.
   * Nothing here is a judgement about whether the diver dives dry: this column
   * records what the shop hands over, there is no field for a suit the diver
   * owns (issue #1752, which is the mirror case and deliberately unfixed until
   * someone decides where that fact lives), and reading one column as the other
   * is the over-reach that issue is about.
   *
   * The drysuit piece itself stays, marked `notOffered`, so the packer still
   * meets the contradiction — on the surface where gear is reasoned about, in a
   * form they can close, and without the danger tone of an advisory that has no
   * honest way to clear (the checkbox no longer renders, so neither staff nor
   * diver can retract the flag).
   */
  const inShopDrysuit = fit.rentsDrysuit && offers("drysuit");
  /** A piece whose size is the thing in question — blanked when flagged. */
  const sized = (kind: RentalItemKind, value: string | null): PrepPiece =>
    flagged
      ? {
          kind,
          size: null,
          fitAtCheckIn: true,
          drysuitWeightCheck: false,
          drysuitFinFit: false,
          notOffered: !offers(kind),
        }
      : {
          kind,
          size: size(value),
          fitAtCheckIn: false,
          drysuitWeightCheck: false,
          drysuitFinFit: false,
          notOffered: !offers(kind),
        };
  /** A piece with no size at all; a flag never changes what to pack. */
  const unsized = (kind: RentalItemKind): PrepPiece => ({
    kind,
    size: null,
    fitAtCheckIn: false,
    drysuitWeightCheck: false,
    drysuitFinFit: false,
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
   * **Unless they are in a drysuit.** `weightPreference` is one free-text
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
   * should appear beside "Drysuit ML".
   *
   * **Only while the shop actually rents drysuits** — `inShopDrysuit`, not the
   * raw flag.
   */
  const weights = (value: string | null): PrepPiece => {
    if (inShopDrysuit) {
      return {
        kind: "weights",
        size: null,
        fitAtCheckIn: false,
        drysuitWeightCheck: true,
        drysuitFinFit: false,
        notOffered: !offers("weights"),
      };
    }
    return {
      kind: "weights",
      size: size(value),
      fitAtCheckIn: false,
      drysuitWeightCheck: false,
      drysuitFinFit: false,
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
   * **Only while the shop actually rents drysuits** — `inShopDrysuit`, not the
   * raw flag. Sizing up over a boot that is not coming is how a fin ends up two
   * to three sizes too big.
   */
  const maskFins = (): PrepPiece => ({
    ...sized("mask_fins", fit.finSize),
    drysuitFinFit: inShopDrysuit && !flagged,
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
  // The three add-ons that carry no size (see `RENTABLE_ITEMS`).
  if (fit.rentsHoodGloves) items.push(unsized("hood_gloves"));
  if (fit.rentsTorch) items.push(unsized("torch"));
  if (fit.rentsSmb) items.push(unsized("smb"));
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
): { kind: "bcd" | "wetsuit" | "boots" | "mask_fins" | "drysuit"; size: string }[] {
  const items: { kind: "bcd" | "wetsuit" | "boots" | "mask_fins" | "drysuit"; size: string }[] = [];
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
   * (`PrepPiece.notOffered`) and stops changing any other line
   * (`inShopDrysuit` in `rentedItems`). Until issue #1755's review this
   * argument reached only the first half, which left the drysuit's three
   * safety consequences hanging off a flag the catalog contradicted.
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
  const diversWithSupportNeeds: DivePrepChecklist["supportNeeds"]["divers"] = [];
  let nitroxDivers = 0;

  for (const diver of input.divers) {
    // Above the fit branches on purpose: this is the one fact here that has
    // nothing to do with whether a fit was recorded, so a diver with no gear
    // on file still brings their support arrangements onto the list. It is
    // also why it is not folded into the `not_recorded` early-continue below.
    if (hasSupportNeeds(diver.supportNeeds)) {
      // Narrowed by `hasSupportNeeds`, which returns false for null.
      diversWithSupportNeeds.push({
        personId: diver.personId,
        fullName: diver.fullName,
        needs: diver.supportNeeds as SupportNeeds,
      });
    }
    if (nitroxTanksApproved(diver)) nitroxDivers += 1;
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
    const fit = rentalFitCompleteness(diver.fit, input.offeredKinds);
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
        lastDivedBand: diver.lastDivedBand,
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
    // One call, both groupings. `rentedItems` already emits in `KIND_ORDER`,
    // so a diver's row reads down the rack in the same order the by-item rows
    // do — and neither grouping can hold a piece the other doesn't.
    const items = rentedItems(diver.fit, offered);
    diverLines.push({
      bookingId: diver.bookingId,
      personId: diver.personId,
      fullName: diver.fullName,
      items,
      state: items.length > 0 ? "rents" : "own_kit",
      lastDivedBand: diver.lastDivedBand,
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
      return 0;
    }
    if (b.size === null) return -1;
    const bySize = a.size.localeCompare(b.size);
    if (bySize !== 0) return bySize;
    // One stated size, two rows (see `prepLineKey`): the bare-foot pair first,
    // the drysuit pair under it, in that order on every render.
    if (a.drysuitFinFit !== b.drysuitFinFit) return a.drysuitFinFit ? 1 : -1;
    return 0;
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
    // Alphabetical, so the roster grouping is a list to walk down rather than
    // whatever order the roster query happened to return.
    diverLines: diverLines.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    nitroxBlockers,
    diversWithIncompleteFit,
    diversNeedingStaffFit: diversNeedingStaffFit.sort((a, b) =>
      a.fullName.localeCompare(b.fullName),
    ),
    supportNeeds: {
      // Summed over the whole roster, not only the divers listed below: a
      // stated 0 contributes 0 and a diver nobody asked contributes nothing, so
      // the two agree by construction.
      supportDiversToArrange: supportDiversToArrange(input.divers),
      divers: diversWithSupportNeeds.sort((a, b) => a.fullName.localeCompare(b.fullName)),
      rosterNames: [...input.divers.map((diver) => diver.fullName), ...(input.divingCrew ?? [])],
    },
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
      items: { kind: RentalItemKind; size: string | null; drysuitFinFit?: true }[];
    };

/**
 * `offeredKinds` is the shop's catalog, and it is optional for the same reason
 * it is optional on {@link buildDivePrepChecklist}: a caller with none to hand
 * sees every piece the fit asks for. A caller that **has** one should pass it,
 * so `drysuitFinFit` cannot ride on a flag the catalog contradicts — the rail
 * is the last place to read "size up over the boot" about a suit the shop
 * stopped renting (`inShopDrysuit` in `rentedItems`, issue #1755's review).
 */
export function rentalFitLine(
  fit: RentalFit | null,
  offeredKinds?: readonly string[],
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
  const items = rentedItems(fit, catalogScope(offeredKinds)).map((item) =>
    item.drysuitFinFit
      ? { kind: item.kind, size: item.size, drysuitFinFit: true as const }
      : { kind: item.kind, size: item.size },
  );
  if (items.length === 0) return { state: "own_kit" };
  return { state: "rents", items };
}
