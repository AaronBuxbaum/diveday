// @vitest-environment jsdom

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
   * The print palette flattens `--success` and `--warning` to one near-black
   * and `--danger` to black, and repaints `--surface-sunken` white — so a
   * printed hull would show aboard and ashore as the same blob and a booked
   * seat as white on white. The rows print the same facts in words.
   */
  it("stands down on paper rather than printing a boat it cannot print honestly", () => {
    const { container } = render(<Hull geometry={geometry} label="the boat" seats={roster} />);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("print:hidden");
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
