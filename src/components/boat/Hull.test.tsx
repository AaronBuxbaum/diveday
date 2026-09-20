// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { hullGeometry, type SeatReadiness, type SeatState } from "@/lib/hull";
import { Hull } from "./Hull";

afterEach(cleanup);

/** The seat rects — the ones `hullGeometry` rounds to `SEAT_RX`. */
function seatsOf(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("rect")].filter((node) => node.getAttribute("rx") === "9");
}

/**
 * The dashed inset an `awaiting` seat wears inside its own solid line. Picked
 * by its thinner stroke: an *open* seat is also dashed and also unfilled, and
 * telling those two apart is the entire point of the tests below.
 */
function insetsOf(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("rect")].filter(
    (node) =>
      node.getAttribute("stroke-dasharray") === "3 3" && node.getAttribute("stroke-width") === "1",
  );
}

const geometry = hullGeometry({ capacity: 8, crewCount: 1 });

/**
 * A seat as the component takes it. The two fields beside the state are what
 * the derivation refuses to throw away (ADR 20260919-one-idea §3b.1, §3b.2);
 * nothing paints them yet, so the fixture keeps them at their unrecorded
 * values and the tests below are about the state exactly as before.
 */
const seat = (state: SeatState, initials: string, readiness: SeatReadiness = "ready") => ({
  reading: { state, checkpoint: null, readiness },
  initials,
});

const roster = [
  seat("aboard", "RN"),
  seat("aboard", "HL"),
  seat("booked", "BC"),
  seat("blocked", "GM", "blocked"),
  seat("ashore", "PS"),
  seat("missing", "TF"),
];

describe("Hull", () => {
  it("is one image with the caller's sentence for a reader who cannot see it", () => {
    render(<Hull geometry={geometry} label="Reef Runner: six of eight aboard." />);
    expect(screen.getByRole("img", { name: "Reef Runner: six of eight aboard." })).toBeTruthy();
  });

  it("draws one seat per place the boat has, however short the roster", () => {
    const { container } = render(<Hull geometry={geometry} label="the boat" seats={roster} />);
    // Eight places: six named, two still open.
    const seats = [...container.querySelectorAll("rect")].filter(
      (node) => node.getAttribute("rx") === "9",
    );
    expect(seats).toHaveLength(8);
    expect(seats.filter((node) => node.getAttribute("stroke-dasharray") === "3 3")).toHaveLength(2);
  });

  /**
   * **A taken seat is not told from an empty one by its fill.**
   *
   * The canvas drew an ordinary taken seat as paper inside a solid line
   * (`.deck .seat`), and the first build here dropped the line: white on an
   * unpainted hull's `--surface-sunken` body is 1.2:1, and 1.05:1 in the Glare
   * Mode this surface exists for — so the open seats, which kept their dashed
   * line, were the *more* visible ones and the picture's first reading was
   * inverted (dive-domain review 20260919). Every seat carries a line at full
   * weight now; only an open place's is dashed and faint.
   */
  it("outlines a taken seat, so occupancy survives a washed-out fill", () => {
    const { container } = render(<Hull geometry={geometry} label="the boat" seats={roster} />);
    const seats = [...container.querySelectorAll("rect")].filter(
      (node) => node.getAttribute("rx") === "9",
    );
    for (const seat of seats) {
      expect(seat.getAttribute("stroke")).not.toBe("none");
      expect(seat.getAttribute("stroke-width")).toBe("1.5");
    }
    const booked = seats.find((node) => node.getAttribute("fill") === "var(--surface)");
    expect(booked?.getAttribute("stroke-dasharray")).toBe(null);
    expect(booked?.getAttribute("stroke-opacity")).toBe("1");
  });

  /**
   * "Cannot board" and "did not come back" are the same hue by design — they
   * are both the roll call's danger — so the thing that has to separate them is
   * lightness, exactly as it separates their two rows (`bg-danger/5` and no
   * ring against `bg-danger/15` with one). An outline against a solid survives
   * greyscale, glare and a reader who cannot tell the hues apart; a
   * half-transparent halo does not.
   */
  it("tells an unsigned waiver from a diver still in the water without using hue", () => {
    const { container } = render(<Hull geometry={geometry} label="the boat" seats={roster} />);
    const seats = [...container.querySelectorAll("rect")].filter(
      (node) => node.getAttribute("rx") === "9",
    );
    const fills = seats.map((node) => node.getAttribute("fill"));
    expect(fills).toContain("var(--danger-tint)");
    expect(fills).toContain("var(--danger)");
  });

  /**
   * **§3b.3 — an inference may not wear a statement's weight.** ADR 20260827
   * decision 4: an alarm is earned by a recorded fact, never by the absence of
   * one. A crew member saying "she never boarded" and the dock's silence being
   * carried forward are different claims, and a solid amber ring is what only
   * the first of them earns.
   */
  it("draws a carried-forward ashore more quietly than a stated one", () => {
    const { container } = render(
      <Hull
        geometry={geometry}
        label="the boat"
        seats={[seat("ashore", "PS"), seat("ashoreImplied", "MK")]}
      />,
    );
    const [stated, inferred] = [...container.querySelectorAll("rect")].filter(
      (node) => node.getAttribute("rx") === "9",
    );
    expect(stated?.getAttribute("stroke-dasharray")).toBeNull();
    expect(inferred?.getAttribute("stroke-dasharray")).toBe("3 3");
    // And not by weight alone: the fill drops to the tint as well.
    expect(stated?.getAttribute("fill")).toBe("var(--warning)");
    expect(inferred?.getAttribute("fill")).toBe("var(--warning-tint)");
  });

  /**
   * **§3b.5 — "nobody looked" is not "fine", and it must not read as "nobody
   * is here" either.**
   *
   * A first pass drew this dashed, like an open place, and leaned on the
   * initials to tell the two apart. `hullGeometry` drops the initials above
   * eight columns — every boat bigger than a six-pack — so on a 24-place hull
   * a booked diver nobody had vetted rendered as an empty seat. The rule that
   * holds instead is the one this component already had: **a line at full
   * weight means a body is in this seat.** The doubt goes inside it.
   */
  it("draws a seat nobody has read as taken, not as empty", () => {
    const { container } = render(
      <Hull
        geometry={geometry}
        label="the boat"
        seats={[seat("booked", "BC"), seat("awaiting", "NR", "unread")]}
      />,
    );
    const [cleared, unread] = seatsOf(container);
    // Neither is dashed: both seats have somebody in them.
    expect(cleared?.getAttribute("stroke-dasharray")).toBeNull();
    expect(unread?.getAttribute("stroke-dasharray")).toBeNull();
    // The doubt is the slate fill and the inset, not the outline.
    expect(cleared?.getAttribute("fill")).toBe("var(--surface)");
    expect(unread?.getAttribute("fill")).toBe("var(--surface-sunken)");
    expect(insetsOf(container)).toHaveLength(1);
  });

  /**
   * The case the first pass had no test for, and the one that was wrong: a
   * hull too big to letter. The distinction has to survive with no initials at
   * all, because that is the normal boat.
   */
  it("keeps an unread seat distinct from an open one on a hull too big to letter", () => {
    const big = hullGeometry({ capacity: 24 });
    expect(big.showsInitials).toBe(false);
    const { container } = render(
      <Hull geometry={big} label="the boat" seats={[seat("awaiting", "NR", "unread")]} />,
    );
    const [unread, ...empty] = seatsOf(container);
    expect(unread?.getAttribute("stroke-dasharray")).toBeNull();
    expect(empty[0]?.getAttribute("stroke-dasharray")).toBe("3 3");
    expect(unread?.getAttribute("fill")).not.toBe(empty[0]?.getAttribute("fill"));
    // And the inset is drawn exactly once, on the one seat that is not settled.
    expect(insetsOf(container)).toHaveLength(1);
  });

  /**
   * This used to assert `print:hidden`, and the reason was sound: the print
   * palette flattens `--success` and `--warning` to one near-black, so a
   * printed hull showed aboard and ashore as the same blob. Standing the
   * picture down was the honest answer while the paper had no treatment of its
   * own. It has one now — `@media print` in `globals.css`, held by the block
   * at the foot of this file — so the boat goes on the sheet, which is what a
   * manifest is (ADR 20260919-one-idea §3b.4).
   */
  it("goes on the sheet, because a manifest is a piece of paper", () => {
    const { container } = render(<Hull geometry={geometry} label="the boat" seats={roster} />);
    const className = container.querySelector("svg")?.getAttribute("class") ?? "";
    expect(className).not.toContain("print:hidden");
    // The hook the print sheet hangs everything else off.
    expect(className).toContain("hull");
  });

  /**
   * The whole defence against a seat map reading as a seating plan is that
   * nothing on a seat is a number. The only words are initials the caller
   * shortened.
   */
  it("prints no number on any seat", () => {
    const { container } = render(<Hull geometry={geometry} label="the boat" seats={roster} />);
    // `<title>` is the accessible name, not a `<text>` node — the only words
    // drawn on the boat are the initials the caller shortened.
    const words = [...container.querySelectorAll("text")].map((node) => node.textContent ?? "");
    expect(words).toEqual(roster.map((seat) => seat.initials));
    for (const word of words) expect(word).not.toMatch(/\d/);
  });

  /**
   * A stated "did not come back" is the loudest thing on the boat and the only
   * seat that wears a ring — the same rule the roll call's rows follow
   * (dive-domain review 20260804).
   */
  it("rings exactly one state, and it is the one that means a person is unaccounted for", () => {
    const { container } = render(<Hull geometry={geometry} label="the boat" seats={roster} />);
    const rings = [...container.querySelectorAll("rect")].filter(
      (node) => node.getAttribute("rx") === "11",
    );
    expect(rings).toHaveLength(1);
  });

  it("wears the shop's colour, and the page's ink on a boat nobody painted", () => {
    const painted = render(
      <Hull geometry={geometry} label="the boat" color={DIVEDAY_BRAND_COLOR} />,
    );
    expect(painted.container.querySelector("path")?.getAttribute("stroke")).toBe(
      DIVEDAY_BRAND_COLOR,
    );
    cleanup();
    const bare = render(<Hull geometry={geometry} label="the boat" />);
    expect(bare.container.querySelector("path")?.getAttribute("stroke")).toBe(
      "var(--border-strong)",
    );
  });

  /**
   * Every fill is a token, so the night palette and the crew's glare mode each
   * get their own boat — which is exactly what `check:tokens` exists to hold.
   */
  it("reaches for tokens and never a colour of its own", () => {
    const { container } = render(<Hull geometry={geometry} label="the boat" seats={roster} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(container.innerHTML).toContain("var(--success)");
  });

  it("drops the lettering rather than rendering it too small to read", () => {
    const big = hullGeometry({ capacity: 24 });
    const { container } = render(
      <Hull
        geometry={big}
        label="the boat"
        seats={Array.from({ length: 24 }, () => seat("booked", "AB"))}
      />,
    );
    // Not one letter drawn, and every one of the twenty-four seats still there:
    // the picture is the count made spatial either way.
    expect(container.querySelectorAll("text")).toHaveLength(0);
    expect(container.querySelectorAll("rect")).toHaveLength(24);
  });

  it("draws nothing at all for a boat with no places", () => {
    const { container } = render(<Hull geometry={hullGeometry({ capacity: 0 })} label="none" />);
    expect(container.firstChild).toBe(null);
  });
});

/**
 * **The hull on paper** (ADR 20260919-one-idea §3b.4).
 *
 * A manifest is a piece of paper. The print palette in `globals.css` flattens
 * `--success` and `--warning` onto one near-black, so `aboard` and `ashore` —
 * the only two answers a head count has — printed identically, and the
 * component wore `print:hidden` rather than print that. These hold the fix:
 * the classes the print sheet reaches for are on the elements, and no two
 * states come out of a printer looking the same.
 */

/**
 * Every state, as a record rather than a list, so a ninth one fails *here*
 * rather than reaching paper with no treatment of its own.
 */
const EVERY_STATE: Record<SeatState, true> = {
  open: true,
  booked: true,
  blocked: true,
  awaiting: true,
  aboard: true,
  ashore: true,
  ashoreImplied: true,
  missing: true,
};
const STATES = Object.keys(EVERY_STATE) as SeatState[];
const kebab = (state: SeatState) => state.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The leaf rules inside `@media print`, as a map from one selector to its
 * declarations. Brace-counted rather than regexed whole: the block is nested,
 * and a rule read from the wrong side of it would pass this file while paper
 * still came out wrong.
 */
function printRules(): Map<string, Map<string, string>> {
  const css = readFileSync(join(import.meta.dirname, "../../app/globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const rules = new Map<string, Map<string, string>>();
  for (const start of [...css.matchAll(/@media\s+print\s*\{/g)]) {
    let depth = 1;
    let i = start.index + start[0].length;
    const from = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      i += 1;
    }
    for (const rule of css.slice(from, i - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = new Map(
        rule[2]
          .split(";")
          .map((line) => line.split(":").map((half) => half.trim()))
          .filter((pair) => pair.length === 2 && pair[0])
          .map(([property, value]) => [property, value] as const),
      );
      for (const selector of rule[1].split(",")) rules.set(selector.trim(), declarations);
    }
  }
  return rules;
}

/**
 * What a printer actually puts on the page for one state: the seat's own
 * treatment, the inner mark if it has one, and the ring if it has one. The
 * comparison below is over this whole thing rather than over the seat rule
 * alone, because `booked` and `awaiting` share a line on purpose — the doubt
 * is the dashed box inside the second one.
 */
const PAPER_CHANNELS = ["fill", "stroke-width", "stroke-dasharray"] as const;

function paperTreatment(rules: Map<string, Map<string, string>>, state: SeatState) {
  const read = (selector: string) =>
    PAPER_CHANNELS.map((property) => `${property}:${rules.get(selector)?.get(property) ?? "-"}`);
  return [
    ...read(`.hull-seat-${kebab(state)}`),
    ...read(`.hull-seat-inset-${kebab(state)}`).map((part) => `inset ${part}`),
    `ring+cross:${state === "missing"}`,
  ].join(" | ");
}

/**
 * The *seat rules alone*, which is the comparison a first draft of the e2e
 * half made and which is not a safe one: `booked` and `awaiting` share a line
 * deliberately — the doubt is the dashed box inside the second — so anything
 * that compares seats without their inner marks either passes vacuously or
 * fails for a reason that is not a bug. This exists so the test below can say
 * that out loud rather than leave it to be rediscovered.
 */
function seatRuleOnly(rules: Map<string, Map<string, string>>, state: SeatState) {
  return PAPER_CHANNELS.map(
    (property) => `${property}:${rules.get(`.hull-seat-${kebab(state)}`)?.get(property) ?? "-"}`,
  ).join(" | ");
}

describe("the hull on paper", () => {
  it("gives every seat and its inner mark the class the print sheet reaches for", () => {
    const { container } = render(
      <Hull
        geometry={hullGeometry({ capacity: 8, crewCount: 1 })}
        label="the boat"
        seats={STATES.filter((state) => state !== "open").map((state) => seat(state, "AB"))}
      />,
    );
    for (const state of STATES) {
      expect(container.querySelector(`.hull-seat-${kebab(state)}`)).toBeTruthy();
    }
    // The three that need a fourth channel on paper draw the element for it.
    // Two of them stroke it only under print, and CSS cannot style an element
    // that is not in the document.
    for (const state of ["awaiting", "ashore", "ashoreImplied"] as const) {
      expect(container.querySelector(`.hull-seat-inset-${kebab(state)}`)).toBeTruthy();
    }
    // The alarm's own two marks, both of them paper-only.
    expect(container.querySelector(".hull-seat-cross")).toBeTruthy();
    expect(container.querySelector(".hull-seat-ring")).toBeTruthy();
    // The sentence, as ink rather than as a tooltip: `<title>` is never
    // painted, and above eight columns there are no initials either.
    expect(container.querySelector("p.print\\:block")?.textContent).toBe("the boat");
    // The boat itself, whose inline colour print has to take back.
    for (const part of [".hull-body", ".hull-midline", ".hull-crew", ".hull-helm"]) {
      expect(container.querySelector(part)).toBeTruthy();
    }
  });

  it("gives all eight states a print treatment, and none of them the same one", () => {
    const rules = printRules();
    for (const state of STATES) {
      expect(rules.has(`.hull-seat-${kebab(state)}`)).toBe(true);
    }
    // Pairwise, and over the channels that survive a mono laser: fill, stroke
    // weight, dash, the inner mark and the ring. **Stroke colour is not one of
    // them** — that is the whole of §3b.4, and a pair told apart only by hue
    // is exactly what `aboard` and `ashore` were before this.
    const seen = new Map<string, SeatState>();
    for (const state of STATES) {
      const treatment = paperTreatment(rules, state);
      const clash = seen.get(treatment);
      expect(clash, `${state} prints exactly like ${clash}: ${treatment}`).toBeUndefined();
      seen.set(treatment, state);
    }
  });

  /**
   * **The two rules a crew reads the sheet by**, asserted rather than
   * described. A dive-domain review of the first draft found both broken: the
   * heaviest mark on the boat was `blocked`, which means a waiver is unsigned,
   * and `missing` — a diver who did not come back aboard — was drawn *filled*,
   * the same mark as `aboard`, separated from it by a hairline halo measuring
   * about a third of a millimetre on a full boat.
   */
  it("keeps a fill meaning a body aboard, and the heaviest line meaning nobody knows", () => {
    const rules = printRules();
    const fill = (state: SeatState) => rules.get(`.hull-seat-${kebab(state)}`)?.get("fill");
    const width = (state: SeatState) =>
      Number(rules.get(`.hull-seat-${kebab(state)}`)?.get("stroke-width"));

    // One filled state, and it is the one that means a body is in this boat.
    expect(STATES.filter((state) => fill(state) !== "none")).toEqual(["aboard"]);

    // The heaviest line is the unaccounted-for one, and `blocked` — which
    // means paperwork — is quieter than it. That ordering is the same one
    // `ROLL_CALL_ROW_TONE` carries, and inverting it teaches a crew that the
    // loudest thing on a boat is a signature.
    const heaviest = Math.max(...STATES.map(width));
    expect(STATES.filter((state) => width(state) === heaviest)).toEqual(["missing"]);
    expect(width("blocked")).toBeLessThan(width("missing"));
    expect(width("blocked")).toBeGreaterThan(width("booked"));
  });

  /**
   * The pair §3b.5 exists for. They share a seat rule on purpose, so any
   * comparison that forgets the inner mark is either vacuous or a false alarm
   * waiting for the first shop with an unread booking.
   */
  it("tells a seat nobody has read from a seat nobody has objected to, by the mark inside it", () => {
    const rules = printRules();
    expect(seatRuleOnly(rules, "awaiting")).toBe(seatRuleOnly(rules, "booked"));
    expect(paperTreatment(rules, "awaiting")).not.toBe(paperTreatment(rules, "booked"));
  });

  it("does not let a printer read the shop's paint as a state", () => {
    const rules = printRules();
    // A mid-tone brand prints as mid grey and a dark one lands on top of
    // `blocked`, so the body, the midline and the crew give their inline
    // colour back to the page's own ink.
    for (const part of [".hull-body", ".hull-midline", ".hull-crew", ".hull-helm"]) {
      expect(rules.get(part)?.get("stroke")).toMatch(/^var\(--border/);
    }
    // `ashore` letters in `--surface`, and its seat is empty on paper: white
    // on white is the one ink that has to be re-cut.
    expect(rules.get(".hull-seat-ink-ashore")?.get("fill")).toBe("var(--foreground)");
  });
});
