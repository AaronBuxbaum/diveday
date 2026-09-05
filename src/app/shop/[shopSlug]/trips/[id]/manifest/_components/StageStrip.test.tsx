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
  consequence: "Each tap shows on divers' links and on your website.",
  errorRefusal: "That didn't save. Check your connection and tap again.",
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
    expect(source).not.toMatch(/SiteMark|Swell|BoatDrift/);
    expect(source).not.toMatch(/accent/);
    expect(source).not.toMatch(/animate-|boat-leaves|settle-in|rise-in/);
  });
});
