// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StageStrip, type StageStripCopy } from "./StageStrip";

/**
 * **The crew's control on a safety surface** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 */
const copy: StageStripCopy = {
  legend: "Where the boat is",
  errorRefusal: "That didn’t save. Check your connection and tap again.",
  taps: [
    { stage: "boarding", label: "Boarding" },
    { stage: "underway", label: "Underway" },
    { stage: "surface", label: "Surface" },
    { stage: "heading_in", label: "Heading in" },
    { stage: "home", label: "Home" },
  ],
};

const noop = async () => ({ ok: true }) as const;

afterEach(cleanup);

describe("StageStrip", () => {
  it("offers the five words the crew taps", () => {
    render(<StageStrip action={noop} copy={copy} current={null} />);
    for (const tap of copy.taps) {
      expect(screen.getByRole("button", { name: tap.label })).toBeInTheDocument();
    }
  });

  it("presses exactly the word the crew last said", () => {
    render(
      <StageStrip
        action={noop}
        copy={{ ...copy, recordedLine: "Keiko Tanaka · 7:04 AM" }}
        current="underway"
      />,
    );
    expect(screen.getByRole("button", { name: "Underway" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const label of ["Boarding", "Surface", "Heading in", "Home"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByText("Keiko Tanaka · 7:04 AM")).toBeInTheDocument();
  });

  it("says nothing about a stage nobody set, and never says Unknown", () => {
    const { container } = render(<StageStrip action={noop} copy={copy} current={null} />);
    for (const tap of copy.taps) {
      expect(screen.getByRole("button", { name: tap.label })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
    expect(container.textContent).not.toMatch(/unknown/i);
  });

  it("carries no drawing, no coral and no motion", () => {
    // The path walk in `illustration.test.ts` covers the import; this covers
    // the tokens and the animation class, which no import would show.
    const source = readFileSync(path.join(__dirname, "StageStrip.tsx"), "utf8");
    expect(source).not.toMatch(/SiteMark|Swell/);
    expect(source).not.toMatch(/accent/);
    expect(source).not.toMatch(/animate-|boat-leaves|settle-in|rise-in/);
  });
});

/**
 * **Paper keeps where the boat is** (K-141). The five buttons were the only
 * statement of the current stage, and the pressed one is a primary fill: print
 * strips every fill and kept its white label, so on the manifest print the
 * stage was a 75px hole the width of "Boarding", and the packets, which hide
 * every button, said nothing at all under the eyebrow. On paper the row goes,
 * and one line says the stage in the crew's own word.
 */
describe("the stage on paper", () => {
  it("keeps the buttons off paper and prints the current stage as a word", () => {
    const { container } = render(
      <StageStrip
        action={noop}
        copy={{ ...copy, recordedLine: "Keiko Tanaka · 7:04 AM" }}
        current="boarding"
      />,
    );
    const row = screen.getByRole("button", { name: "Boarding" }).closest("form")?.parentElement;
    expect(row).toHaveClass("print:hidden");
    const printed = container.querySelector(".print\\:block");
    expect(printed).not.toBeNull();
    expect(printed).toHaveClass("hidden");
    expect(printed?.textContent).toBe("Boarding");
  });

  it("prints no stage line when nobody has said where the boat is", () => {
    const { container } = render(<StageStrip action={noop} copy={copy} current={null} />);
    expect(container.querySelector(".print\\:block")).toBeNull();
  });

  it("keeps the whole strip off paper until somebody has said a stage", () => {
    // With the buttons hidden and no word to print, the heading "Where the
    // boat is" printed over nothing: the day packet's eyebrow sat straight on
    // the checklist card. On paper the section appears only with its answer.
    render(<StageStrip action={noop} copy={copy} current={null} />);
    expect(screen.getByRole("region", { name: "Where the boat is" })).toHaveClass("print:hidden");
  });

  it("prints the strip, heading and word, once a stage is set", () => {
    render(<StageStrip action={noop} copy={copy} current="boarding" />);
    expect(screen.getByRole("region", { name: "Where the boat is" })).not.toHaveClass(
      "print:hidden",
    );
  });
});
