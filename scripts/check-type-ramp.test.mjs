import { describe, expect, it } from "vitest";

import { findRampSpellings } from "./check-type-ramp.mjs";

const hits = (source) => findRampSpellings(source).map((h) => h.text);

describe("the spellings the sweep removed", () => {
  it("catches the two that were 76 of the ~160 call sites", () => {
    expect(hits('<h2 className="text-lg font-semibold">')).toEqual(["text-lg font-semibold"]);
    expect(hits('<h2 className="text-lg font-semibold tracking-tight">')).toEqual([
      "text-lg font-semibold",
    ]);
  });

  it("catches every size on the ramp, at either weight", () => {
    for (const size of ["lg", "xl", "2xl", "3xl", "4xl"]) {
      for (const weight of ["semibold", "bold"]) {
        expect(hits(`className="text-${size} font-${weight}"`)).toHaveLength(1);
      }
    }
  });

  it("catches a spelling written in the other order, which a fixed-order grep misses", () => {
    // Six real figures were found only this way — three of them ones the ADR
    // itself calls figures, sitting behind a `leading-none` the issue's own
    // grep could not see past.
    expect(
      hits('className="text-3xl leading-none font-semibold tracking-tight tabular-nums"'),
    ).toEqual(["text-3xl leading-none font-semibold"]);
    expect(hits('className="text-2xl leading-none font-bold tabular-nums"')).toEqual([
      "text-2xl leading-none font-bold",
    ]);
  });
});

describe("what is deliberately not a bare spelling", () => {
  it("leaves a responsive step alone — the call site pairs a constant with its own breakpoint", () => {
    expect(hits("className={`${BANNER_TITLE_CLASS} sm:text-4xl`}")).toEqual([]);
    expect(hits('className="font-semibold tracking-tight sm:text-lg"')).toEqual([]);
    expect(hits('className="text-sm font-semibold md:text-2xl"')).toEqual([]);
  });

  it("leaves a variant prefix alone for the same reason", () => {
    expect(hits('className="font-semibold dark:text-xl"')).toEqual([]);
    expect(hits('className="group-hover:text-2xl font-bold"')).toEqual([]);
  });

  it("leaves the row title and the card's h3 alone — text-base is not on the ramp", () => {
    expect(hits('className="text-base font-semibold"')).toEqual([]);
  });

  it("leaves the group label and the eyebrow alone — both already single-spelling constants", () => {
    expect(
      hits('className="text-xs font-semibold tracking-[0.14em] uppercase text-muted"'),
    ).toEqual([]);
  });

  it("does not join a size and a weight that are a whole element apart", () => {
    // A `text-lg` at the top of a long className and a `font-bold` far below it
    // are two different intents, not one heading.
    const wide =
      'className="text-lg mt-2 flex items-center justify-between gap-3 rounded-panel border border-border bg-surface p-4 font-bold"';
    expect(hits(wide)).toEqual([]);
  });
});

describe("the escape hatch", () => {
  it("honours an acknowledgement on the line", () => {
    expect(hits('className="text-3xl font-bold" /* diveday:allow-type-ramp: satori */')).toEqual(
      [],
    );
  });

  it("honours one on the line above", () => {
    expect(
      hits(
        '// diveday:allow-type-ramp: an ImageResponse card Tailwind never reaches\nclassName="text-3xl font-bold"',
      ),
    ).toEqual([]);
  });
});
