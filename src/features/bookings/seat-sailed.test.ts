import { describe, expect, it } from "vitest";
import { seatSailed } from "./seat-sailed";

/**
 * **The one rule that decides who the homecoming sentence counts** (issue
 * #1689). Everything else in the evening is arithmetic over it, so this is
 * where the adversarial cases belong: the two statements a shop can make about
 * one seat, each way round, and the case where it has made neither.
 */
describe("seatSailed", () => {
  it("follows the crew's dock tap over the desk's mark, in both directions", () => {
    // The rail outranks the desk, which is the ranking the product already
    // keeps everywhere else: a crew member tapping Boarded is the strongest
    // evidence held about where a person is, and `reclaimReleasedSeat` makes
    // the booking agree by taking it back to what it was before the release
    // (`booked`; the arrival trail it never touched still says whether the desk
    // saw them, issue #2702). A row that somehow
    // still read `no_show` under a boarding must not drop a counted body.
    expect(seatSailed({ noShow: true, dockResult: "boarded", afterDiveResultStands: false })).toBe(
      true,
    );
    // And the commoner half: the crew closed the dock count by marking the two
    // who never showed, and nobody at the desk ever did the "Not here?" tap.
    // Booking status is still `booked`, and this is the case the first fix of
    // #1689 counted out *and* home.
    expect(
      seatSailed({ noShow: false, dockResult: "not_boarded", afterDiveResultStands: false }),
    ).toBe(false);
  });

  it("falls back to the desk's mark only for a seat the crew never answered for", () => {
    expect(seatSailed({ noShow: true, dockResult: null, afterDiveResultStands: false })).toBe(
      false,
    );
    // **A seat nobody spoke for counts.** This is an unfinished dock count,
    // and `listRollCallGaps` is already raising `departure_uncounted` or
    // `no_roll_call` over it — so the station reads `count_open` and no moment
    // can be spent on the strength of this answer.
    expect(seatSailed({ noShow: false, dockResult: null, afterDiveResultStands: false })).toBe(
      true,
    );
  });

  /**
   * **The state a dive-domain-expert review found this function wrong about**
   * (issue #1704). No dock result, the desk's mark, and an after-dive
   * `not_boarded` — a diver the crew have recorded as not back aboard. The old
   * rule saw only the dock, fell through to `!noShow`, and answered "did not
   * sail", so the evening printed "0 divers out, 0 back" over a one-diver boat
   * carrying somebody the day was raising a top-severity missing-diver row
   * about. `onTheWaterByRollCall` answered "on the water" about the same diver
   * at the same moment; the clamp on the homecoming line hid the `-1`.
   *
   * Reachable without anything exotic: the desk's door is open for six hours
   * after departure, so a desk tap at 10:15 and a crew tap at 12:10 — or an
   * offline tap made at 09:40 that syncs at 12:40, which is the *expected*
   * ordering on a boat with no signal — lands exactly here.
   */
  it("counts a diver the crew recorded missing after a dive, whatever the desk marked", () => {
    expect(seatSailed({ noShow: true, dockResult: null, afterDiveResultStands: true })).toBe(true);
    expect(seatSailed({ noShow: false, dockResult: null, afterDiveResultStands: true })).toBe(true);
  });

  /**
   * **The dock still wins where it spoke**, and this is the documented case
   * that makes it right rather than an oversight: a diver marked ashore at the
   * dock and boarded at a later site carries no after-dive gap, so both halves
   * of the homecoming sentence move together and "souls on board" stays how
   * many the vessel *left* with (glossary, **sailed**). Only the dock's
   * *silence* stopped outranking a statement made at sea.
   */
  it("keeps the dock's own word above a later checkpoint's", () => {
    expect(
      seatSailed({ noShow: false, dockResult: "not_boarded", afterDiveResultStands: true }),
    ).toBe(false);
    expect(seatSailed({ noShow: true, dockResult: "boarded", afterDiveResultStands: true })).toBe(
      true,
    );
  });
});
