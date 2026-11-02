/**
 * **Did this seat sail?** Evidence order for every non-cancelled booking
 * (issues #1689, #1704): explicit departure-checkpoint `boarded` or
 * `not_boarded` wins; otherwise any standing after-dive result means sailed;
 * otherwise `no_show` is the desk fallback. `not_boarded` means different
 * things at departure (did not sail) and after-dive (did not return), so the
 * caller uses checkpoint-specific readers.
 *
 * No dock result and no `no_show` leaves the count open through
 * `listRollCallGaps`; this fallback cannot grant `allHome`. Offline events
 * that never sync remain invisible.
 */
export function seatSailed(input: {
  /** `bookings.status === "no_show"` — the desk's own statement. */
  noShow: boolean;
  /** The standing result at the **departure** checkpoint; null when there is none. */
  dockResult: "boarded" | "not_boarded" | null;
  /**
   * Whether a result stands at any **after-dive** checkpoint —
   * `standingResultMeansSailed` over `listAfterDiveRollCallByTrip`. Either word
   * there means the person was on the boat: `boarded` counted them at a later
   * site, and `not_boarded` says they did not come *back*.
   */
  afterDiveResultStands: boolean;
}): boolean {
  if (input.dockResult === "boarded") return true;
  if (input.dockResult === "not_boarded") return false;
  if (input.afterDiveResultStands) return true;
  return !input.noShow;
}
