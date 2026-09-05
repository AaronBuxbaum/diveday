import { describe, expect, it } from "vitest";
import { findUnbufferedDepartureChecks } from "./check-departure-buffer.mjs";

const lines = (source, options) =>
  findUnbufferedDepartureChecks(source, options).findings.map((finding) => finding.line);

describe("a check against a departure time", () => {
  it("passes when it goes through the shared predicate", () => {
    expect(
      lines(`
        const inPast = hasSailed(trip.startsAt, now);
      `),
    ).toEqual([]);
  });

  it("is refused when it adds its own offset and compares", () => {
    expect(
      lines(`
        const inPast = new Date(trip.startsAt.getTime() + 60 * 60 * 1000) <= now;
      `),
    ).toEqual([2]);
  });

  it("is refused a comparison built from the shared constant, which is still a hand-rolled check", () => {
    expect(
      lines(`
        const ahead = seat.startsAt.getTime() + DEPARTURE_BUFFER_MS >= now.getTime();
      `),
    ).toEqual([2]);
  });

  /**
   * The seeds are the reason the comparison operator is the anchor rather than
   * the arithmetic. They build dates off a departure on nearly every line and
   * ask nothing about the clock; anchoring on `+` alone would have made this
   * guard unadoptable on its first run.
   */
  it("leaves construction alone, however much arithmetic it does", () => {
    expect(
      lines(`
        const at = new Date(startsAt.getTime() + offset.minutesFromDeparture * 60_000);
        writes.push({ occurredAt: new Date(trip.startsAt.getTime() + index * step) });
        const endsAt = new Date(startsAt.getTime() + 12 * 60 * 60 * 1000);
      `),
    ).toEqual([]);
  });

  it("does not read an arrow's => as a comparison", () => {
    expect(
      lines(`
        const stamps = trips.map((trip) => new Date(trip.endsAt.getTime() + gap));
      `),
    ).toEqual([]);
  });
});

/**
 * The same check with the comparison moved off the binding's line, which the
 * first version of this guard reported as a clean repository. Found in review
 * of the change that added it (PR #1381), before anything in the tree was
 * written that way.
 */
describe("a check split across lines", () => {
  it("is refused, and reported at the comparison rather than the binding", () => {
    expect(
      lines(`
        const cutoff = new Date(trip.startsAt.getTime() + HOUR_MS);
        return cutoff <= now;
      `),
    ).toEqual([3]);
  });

  it("is still refused with statements in between", () => {
    expect(
      lines(`
        const cutoff = new Date(trip.startsAt.getTime() + HOUR_MS);
        const seats = await countSeats(trip.id);
        log("checked", seats);
        if (cutoff < nowDate()) return null;
      `),
    ).toEqual([5]);
  });

  /**
   * The discriminator. Date arithmetic that never asks the clock is ordinary
   * work — the seeds are full of it — and pairing a binding with any nearby
   * comparison at all was the false-failure this rule had to avoid.
   */
  it("leaves a derived date compared against something other than now alone", () => {
    expect(
      lines(`
        const endsAt = new Date(startsAt.getTime() + 12 * 60 * 60 * 1000);
        if (endsAt < lastSlotOfDay) return "overflows";
      `),
    ).toEqual([]);
  });

  it("does not reach past its window to an unrelated comparison", () => {
    expect(
      lines(`
        const endsAt = new Date(startsAt.getTime() + span);
        const a = 1;
        const b = 2;
        const c = 3;
        const d = 4;
        const e = 5;
        const f = 6;
        const g = 7;
        const h = 8;
        if (endsAt <= now) return null;
      `),
    ).toEqual([]);
  });

  it("honours the exemption on the comparison line", () => {
    expect(
      lines(`
        const sendAt = new Date(trip.endsAt.getTime() + RECAP_DELAY_MS);
        // diveday:allow-departure-offset: the recap's own clock, not this rule
        return sendAt <= now;
      `),
    ).toEqual([]);
  });
});

describe("a second spelling of the buffer", () => {
  /**
   * The rule that matters. Every one of the nine constants this guard was
   * written against looked exactly like this — a plain declaration under a
   * docstring citing the rule it was forking.
   */
  it("is refused even under a docstring that cites the rule", () => {
    expect(
      lines(`
        /**
         * The standing late-arrival buffer (AGENTS.md): a boat that left at
         * 7:00 is not "in the past" at 7:05.
         */
        const DEPARTURE_BUFFER_MS = 60 * 60 * 1000;
      `),
    ).toEqual([6]);
  });

  it("is refused under any name", () => {
    expect(lines(`const COUNTER_DEPARTED_BUFFER_MS = HOUR_MS;`)).toEqual([1]);
  });

  it("is allowed in the one file that owns it", () => {
    expect(lines(`export const DEPARTURE_BUFFER_MS = HOUR_MS;`, { isHome: true })).toEqual([]);
  });
});

describe("the exemption", () => {
  it("is honoured on the line itself", () => {
    expect(
      lines(`
        return now.getTime() > input.endsAt.getTime() + RECAP_DELAY_MS; // diveday:allow-departure-offset: the recap's own clock
      `),
    ).toEqual([]);
  });

  /**
   * The three-line form is the one in the tree. A guard that only read the
   * line directly above would force the reason onto one long line, which is
   * how an exemption stops explaining itself and becomes a token people copy.
   */
  it("is honoured from anywhere in the comment block above", () => {
    expect(
      lines(`
        // diveday:allow-departure-offset: the recap's own delay, not the
        // sailed/returned question — it waits its scheduled hours after a boat
        // this rule already counts as home.
        return now.getTime() > input.endsAt.getTime() + RECAP_DELAY_MS;
      `),
    ).toEqual([]);
  });

  it("does not carry across a blank line to an unrelated check", () => {
    expect(
      lines(`
        // diveday:allow-departure-offset: the recap's own clock

        const inPast = new Date(trip.startsAt.getTime() + 60 * 60 * 1000) <= now;
      `),
    ).toEqual([4]);
  });
});
