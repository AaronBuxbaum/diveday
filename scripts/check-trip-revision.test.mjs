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
