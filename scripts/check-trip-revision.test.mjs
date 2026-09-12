import { describe, expect, it } from "vitest";
import { findFlatRevisionWrites } from "./check-trip-revision.mjs";

const lines = (source) => findFlatRevisionWrites(source).findings.map((finding) => finding.line);

describe("a write that moves a departure", () => {
  /**
   * `moveTrip` and `refreshDemoShop`'s shape, and the one the brace matcher has
   * to survive: a `${…}` inside a `sql` template literal, balanced, in the
   * middle of the object it is reading.
   */
  it("passes when the same `.set()` bumps the revision unconditionally", () => {
    expect(
      lines(`
        await tx
          .update(trips)
          .set({
            startsAt,
            endsAt: shift(existing.endsAt),
            revision: sql\`\${trips.revision} + 1\`,
          })
          .where(eq(trips.id, tripId));
      `),
    ).toEqual([]);
  });

  /**
   * `updateTrip`'s shape: one statement renames a departure and may also move
   * it, so the bump is a spread that collapses to nothing when only the words
   * changed. A diver's phone re-alerts for the move and not for the typo.
   */
  it("passes when the bump is a conditional spread", () => {
    expect(
      lines(`
        await tx
          .update(trips)
          .set({
            ...(revisionMoved ? { revision: sql\`\${trips.revision} + 1\` } : {}),
            title: patch.title,
            startsAt: patch.startsAt,
            endsAt: patch.endsAt,
          })
          .where(eq(trips.id, tripId));
      `),
    ).toEqual([]);
  });

  it("is refused when nothing in the literal bumps", () => {
    expect(
      lines(`
        await db.update(trips).set({ startsAt, endsAt }).where(eq(trips.id, trip.id));
      `),
    ).toEqual([2]);
  });

  it("passes once it says why no calendar is listening, from above the write", () => {
    expect(
      lines(`
        // diveday:allow-flat-revision: a fixture rewinding a per-worker test database
        await db.update(trips).set({ startsAt, endsAt }).where(eq(trips.id, trip.id));
      `),
    ).toEqual([]);
  });

  it("passes when the same reason is written inside the literal", () => {
    expect(
      lines(`
        await db
          .update(trips)
          .set({
            // diveday:allow-flat-revision: a fixture rewinding a per-worker test database
            startsAt,
            endsAt,
          })
          .where(eq(trips.id, trip.id));
      `),
    ).toEqual([]);
  });
});

describe("a write that is not a calendar move", () => {
  /**
   * The false positive that would have sunk a rule anchored on `startsAt`
   * instead of on the table: `moveTrip` shifts each child day three statements
   * below its own bump, and a schedule day has no `SEQUENCE` of its own.
   */
  it("ignores a shift of the trip's schedule days", () => {
    expect(
      lines(`
        await tx
          .update(tripScheduleDays)
          .set({ startsAt: shift(day.startsAt), endsAt: shift(day.endsAt) })
          .where(eq(tripScheduleDays.id, day.id));
      `),
    ).toEqual([]);
  });

  it("ignores a `.set()` that never touches startsAt, and still counts it as inspected", () => {
    const cancellation = `
      await tx
        .update(trips)
        .set({ status: "cancelled", cancelledAt: now })
        .where(eq(trips.id, tripId));
    `;
    expect(lines(cancellation)).toEqual([]);
    expect(findFlatRevisionWrites(cancellation).guarded).toBe(1);
  });
});

describe("two writes of trips sharing one block", () => {
  /**
   * Ported from `check-live-trips.test.mjs` rather than re-learned: issue #635
   * shipped an unfiltered query that this repo's other trip guard called clean,
   * because it found the *neighbour's* filter inside a fixed line window. A
   * write may never be proven by its neighbour, so both the `.set()` search and
   * the brace match end at the next `.update(trips)`.
   */
  const neighbours = `
    await tx
      .update(trips)
      .set({ startsAt, endsAt, revision: sql\`\${trips.revision} + 1\` })
      .where(eq(trips.id, tripId));
    await tx
      .update(trips)
      .set({ startsAt: other.startsAt, endsAt: other.endsAt })
      .where(eq(trips.id, other.id));
  `;

  it("cannot cover the second with the first's bump", () => {
    expect(lines(neighbours)).toEqual([7]);
  });

  it("cannot cover the first with the second's bump either", () => {
    const reversed = `
      await tx
        .update(trips)
        .set({ startsAt: other.startsAt, endsAt: other.endsAt })
        .where(eq(trips.id, other.id));
      await tx
        .update(trips)
        .set({ startsAt, endsAt, revision: sql\`\${trips.revision} + 1\` })
        .where(eq(trips.id, tripId));
    `;
    expect(lines(reversed)).toEqual([3]);
  });

  it("counts both as inspected, so the bound lost no coverage", () => {
    expect(findFlatRevisionWrites(neighbours).guarded).toBe(2);
  });

  it("passes once each carries its own bump", () => {
    expect(
      lines(
        neighbours.replace(
          ".set({ startsAt: other.startsAt, endsAt: other.endsAt })",
          ".set({ startsAt: other.startsAt, endsAt: other.endsAt, revision: sql`x` })",
        ),
      ),
    ).toEqual([]);
  });
});

describe("a `.set()` the rule cannot read", () => {
  /**
   * The shape a developer writes the moment two branches share a patch. The
   * brace matcher would take the first `{` anywhere after `.set(` — for the
   * last anchor in a file, that search runs to the end of it — and conclude
   * from someone else's object that this write is not a calendar move. A
   * departure would move with the calendar left on the old time, and the
   * guard's own `moves` count would fall by one with nothing to notice it
   * (`security-reviewer`, issue 1394).
   */
  const hoisted = `
    const patch = { startsAt, endsAt };
    await db.update(trips).set(patch).where(eq(trips.id, id));

    const settings = { revision: 1 };
  `;

  it("is refused rather than quietly passed", () => {
    expect(lines(hoisted)).toEqual([3]);
  });

  it("says it could not read the write, not that the write forgot to bump", () => {
    const [only] = findFlatRevisionWrites(hoisted).findings;
    expect(only.opaque).toBe(true);
  });

  it("can still be exempted by name, for a write that genuinely needs no bump", () => {
    expect(
      lines(`
        // diveday:allow-flat-revision: a fixture, and no calendar is subscribed to it.
        await db.update(trips).set(patch).where(eq(trips.id, id));
      `),
    ).toEqual([]);
  });
});

describe("the exemption's reason", () => {
  /** The comment sits directly above the write, which is where
   *  `commentBlockStart` reads from — a blank line between them is not a
   *  preamble at all. */
  const withComment = (comment) => `
    ${comment}
    await db.update(trips).set({ startsAt, endsAt }).where(eq(trips.id, id));
  `;

  it("is required — a bare colon silences nothing", () => {
    // The docblock, the failure message and .claude/rules/db.md all promise
    // `diveday:allow-flat-revision: <why>`. An exemption with nothing after the
    // colon tells the next reader nothing at all.
    expect(lines(withComment("// diveday:allow-flat-revision:"))).toEqual([3]);
  });

  it("is accepted when it actually says why", () => {
    expect(
      lines(
        withComment("// diveday:allow-flat-revision: a per-worker database nobody subscribes to."),
      ),
    ).toEqual([]);
  });
});

describe("the count the success line reports", () => {
  it("counts calendar moves, not every write of trips", () => {
    // The line used to print the anchor count, which claimed eighteen calendar
    // moves were inspected when five were. Pinned here so a refactor that
    // hides a move behind a shape the rule cannot read turns this red rather
    // than dropping the number silently.
    const source = `
      await db.update(trips).set({ startsAt, endsAt, revision: sql\`x\` }).where(eq(trips.id, a));
      await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, b));
      await db.update(trips).set({ deletedAt: now }).where(eq(trips.id, c));
    `;
    const result = findFlatRevisionWrites(source);
    expect(result.guarded).toBe(3);
    expect(result.moves).toBe(1);
  });
});
