// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { hullGeometry } from "@/lib/hull";
import { Hull } from "./Hull";

afterEach(cleanup);

const geometry = hullGeometry({ capacity: 8, crewCount: 1 });

const roster = [
  { state: "aboard" as const, initials: "RN" },
  { state: "aboard" as const, initials: "HL" },
  { state: "booked" as const, initials: "BC" },
  { state: "blocked" as const, initials: "GM" },
  { state: "ashore" as const, initials: "PS" },
  { state: "missing" as const, initials: "TF" },
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
        seats={Array.from({ length: 24 }, () => ({ state: "booked" as const, initials: "AB" }))}
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
