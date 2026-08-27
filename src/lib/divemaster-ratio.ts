import type { InWaterCrewCount } from "./crew-roles";

/**
 * The shop's own target for how many divers one divemaster takes into the
 * water — "5:1", stored as the 5.
 *
 * It applies to **every** dive the shop runs, fun dives and course sessions
 * alike, and it **binds nothing**. A shop may crew a departure however it
 * likes; DiveDay shows the target beside what is actually rostered and
 * suggests the divemaster count a day's requests imply. No booking is refused
 * by anything in this file, and no manifest is held up by it.
 *
 * That is the whole distinction from `src/lib/course-ratios.ts`, which looks
 * similar and is not: those are **agency-published in-water ratios** for
 * entry-level and intro training (PADI's 8/+2/12 and the DSD figure), they are
 * safety caps rather than preferences, and they really do refuse a seat in
 * `createBookingRecord`. A shop cannot loosen those by typing a bigger number
 * here, and a shop that types a tighter one here has not made them tighter
 * either — the two are measured and reported separately, on purpose. Where a
 * course session is short of both, the agency cap is the one that blocks.
 *
 * It replaced `shops.shore_group_size` ("Divers per departure"), a coarser
 * number that only a shop with no boat was ever asked for and only the
 * Requests planner ever read — see
 * docs/architecture/decisions/20260820-shop-divemaster-ratio.md.
 */

/**
 * What a shop is assumed to run at until it says otherwise. Six divers to a
 * divemaster sits mid-range in ordinary recreational guiding practice: it is a
 * starting point a shop can see and change on its settings page, never a
 * standard DiveDay is asserting.
 */
export const DEFAULT_DIVERS_PER_DIVEMASTER = 6;

/** One diver to a divemaster is the tightest sane answer; the ratio is a target, not zero. */
export const MIN_DIVERS_PER_DIVEMASTER = 1;

/**
 * Above twenty the number has stopped describing supervision, and a typo
 * ("60" for "6") would otherwise quietly switch every suggestion off. Mirrored
 * by the `shops_divers_per_divemaster_in_range` check constraint.
 */
export const MAX_DIVERS_PER_DIVEMASTER = 20;

/**
 * Who counts as a divemaster for this target: everybody supervising divers in
 * the water on this sailing.
 *
 * `countInWaterCrew` (src/lib/crew-roles.ts) splits its answer in two because
 * the agency course ratios need the split — an instructor is worth eight
 * students, a certified assistant buys two more. This target does not care:
 * an instructor guiding a fun dive is guiding it, and a shop that rosters two
 * instructors and no divemaster has not left the water unsupervised. So the
 * two counts add.
 */
export function inWaterDivemasterCount(crew: InWaterCrewCount): number {
  return crew.instructorCount + crew.assistantCount;
}

/** How many divemasters `divers` people want at this target. Zero divers want none. */
export function divemastersNeeded(divers: number, diversPerDivemaster: number): number {
  if (divers <= 0) return 0;
  return Math.ceil(divers / diversPerDivemaster);
}

/** How many divers the rostered divemasters cover at this target. */
export function divemasterRatioCapacity(
  divemasterCount: number,
  diversPerDivemaster: number,
): number {
  return divemasterCount * diversPerDivemaster;
}

/**
 * Whether a departure is rostered below the shop's own target, and by how many
 * divemasters.
 *
 * `under_target` is the only thing this reports, and it is advice: a shop
 * reading it may add a divemaster, may split the departure, or may know
 * something about today that the number does not. Nothing downstream is
 * allowed to turn it into a refusal.
 */
export type DivemasterRatioGap =
  | { code: "none" }
  | {
      code: "under_target";
      divers: number;
      divemasterCount: number;
      /** Divemasters the target wants for this many divers. */
      needed: number;
      /** `needed` less those already rostered — always at least one here. */
      shortBy: number;
    };

/**
 * The one measurement of a departure against its shop's target, so the trip
 * page and any later surface cannot disagree about the same sailing.
 *
 * A departure with nobody booked is never short: the target describes divers
 * in the water, and an empty boat has none.
 *
 * Neither is one the shop has marked **self-guided** (`trips.self_guided`).
 * The exemption lives here rather than at each caller for the reason the
 * paragraph above gives: the trip page, the Today queue and whatever reads
 * this next must not be able to disagree about whether one departure is short.
 * It reaches this target only — an agency training ratio is a safety cap and
 * has its own module, which nothing here can loosen.
 */
export function divemasterRatioGap(input: {
  divers: number;
  divemasterCount: number;
  diversPerDivemaster: number;
  /** The shop has said this departure runs without an in-water guide. */
  selfGuided?: boolean;
}): DivemasterRatioGap {
  if (input.selfGuided) return { code: "none" };
  const needed = divemastersNeeded(input.divers, input.diversPerDivemaster);
  const shortBy = needed - input.divemasterCount;
  if (shortBy <= 0) return { code: "none" };
  return {
    code: "under_target",
    divers: input.divers,
    divemasterCount: input.divemasterCount,
    needed,
    shortBy,
  };
}
