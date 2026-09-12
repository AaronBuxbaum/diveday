import { describe, expect, it } from "vitest";

import { findDecapitatedEntries } from "./check-glossary.mjs";

/**
 * The check's judgement, not its plumbing. It exists because the Blocked / Ready entry lost
 * its term to the Close-out entry on 2026-08-04 and nothing noticed for five weeks, so what
 * matters is that it sees that shape and stays quiet about the wrapped prose surrounding it —
 * a guard that cries wolf over an ordinary paragraph gets suppressed, not obeyed.
 */

const lineNumbers = (markdown) => findDecapitatedEntries(markdown).map((found) => found.line);

describe("what reads as an entry that lost its term", () => {
  it("catches a definition continuing mid-sentence under the entry above it", () => {
    const markdown = [
      "- **Close-out** — the end-of-day ritual, and Today's evening mirror: one surface",
      "  where staff confirm the day actually ended.",
      "  readiness check has. Every *live* surface that shows one uses these words.",
      "- **Shop day scan** — the coarse ±26-hour bound a query casts.",
    ].join("\n");

    expect(lineNumbers(markdown)).toEqual([3]);
  });

  it("is quiet once the term is restored", () => {
    const markdown = [
      "- **Close-out** — the end-of-day ritual, and Today's evening mirror: one surface",
      "  where staff confirm the day actually ended.",
      "- **Blocked / Ready** — the shop's one readiness vocabulary, and the only two states a",
      "  readiness check has. Every *live* surface that shows one uses these words.",
    ].join("\n");

    expect(lineNumbers(markdown)).toEqual([]);
  });
});

describe("what it leaves alone", () => {
  /**
   * The ordinary shape of wrapped prose: the wrap lands mid-sentence, so the continuation
   * opens lowercase after a line that does not end one. Most of the glossary looks like this.
   */
  it("says nothing about a line wrapped mid-sentence", () => {
    const markdown = [
      "- **Operational horizon** — the single forward window every readiness surface reads: now",
      "  through the end of the day after tomorrow, and every surface derives its bounds from",
      "  there rather than declaring its own.",
    ].join("\n");

    expect(lineNumbers(markdown)).toEqual([]);
  });

  /**
   * A sentence genuinely may start on a new line. It starts capitalized when it does, which
   * is the whole reason a lowercase opener is evidence of a deletion.
   */
  it("says nothing about a new sentence beginning a continuation line", () => {
    const markdown = [
      "- **Check-in** — a recorded arrival state for a booked diver.",
      "  It confirms the live readiness result and changes the booking to `checked_in`.",
    ].join("\n");

    expect(lineNumbers(markdown)).toEqual([]);
  });

  /**
   * An abbreviation is the one honest way to end a wrapped line in a period without ending a
   * sentence. Reading `p.m.` as a full stop would flag the arrivals prose every time.
   */
  it("does not read an abbreviation's period as the end of a sentence", () => {
    const markdown = [
      "- **Arrivals window** — counter mode's narrower lens, from six hours ago to 6 p.m.",
      "  the following day, because a diver still walks up for a boat that already sailed.",
    ].join("\n");

    expect(lineNumbers(markdown)).toEqual([]);
  });

  it("ignores a fenced block, where indentation and case mean nothing", () => {
    const markdown = [
      "- **Departure log** — the print-optimized document.",
      "  ```",
      "  run      pnpm infra:bootstrap",
      "  verify   aws ssm get-parameter --name /cdk-bootstrap.",
      "  note     the sandbox is the default.",
      "  ```",
    ].join("\n");

    expect(lineNumbers(markdown)).toEqual([]);
  });

  it("ignores a nested bullet, which carries its own opener", () => {
    const markdown = [
      "- **Levels** — the recreational ladder.",
      "  - open water, then advanced open water.",
    ].join("\n");

    expect(lineNumbers(markdown)).toEqual([]);
  });
});
