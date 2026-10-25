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
    { stage: "boarding", label: "Boarding", shortLabel: "Board" },
    { stage: "underway", label: "Underway", shortLabel: "Out" },
    { stage: "surface", label: "Surface", shortLabel: "Surface" },
    { stage: "heading_in", label: "Heading in", shortLabel: "Inbound" },
    { stage: "home", label: "Home", shortLabel: "Home" },
  ],
};

const noop = async () => ({ ok: true, rollCallOpen: false }) as const;

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

  it("lays the five words on one row that scrolls inside its track, never wrapping", () => {
    // At 390 the wrapping flex row broke 4 + 1 (UX audit 2026-10-07, item 2),
    // and the 3 + 2 grid that followed still took two rows (visual review
    // 2026-10-24, B06). jsdom has no layout, so this pins one row of equal
    // columns, the boat's one segment style, and the short word below `sm`.
    render(<StageStrip action={noop} copy={copy} current="surface" />);
    const row = screen.getByRole("button", { name: "Home" }).closest("form")?.parentElement;
    expect(row).toHaveClass("grid", "grid-flow-col", "overflow-x-auto");
    expect(row).not.toHaveClass("flex-wrap");
    expect(row).not.toHaveClass("grid-cols-3");
    for (const tap of copy.taps) {
      const button = screen.getByRole("button", { name: tap.label });
      expect(button).toHaveClass("w-full", "min-h-14", "touch-manipulation");
      expect(button.querySelector(".sm\\:hidden")).toHaveTextContent(tap.shortLabel);
    }
    expect(screen.getByRole("button", { name: "Surface" })).toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveClass("bg-primary");
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

/**
 * Batch 6, item 4: "Heading in" or "Home" while the last after-dive roll call
 * is open warns, with the one tap to it. The words stay pressable: a warning,
 * never a refusal.
 */
describe("StageStrip on the way home with a roll call open", () => {
  const open = {
    ...copy,
    rollCallOpen: {
      line: "2 people not marked after dive 2.",
      openLabel: "Open roll call",
      href: "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_2",
    },
  };

  it("says who is unmarked and links straight to that roll call", () => {
    render(<StageStrip action={noop} copy={open} current="heading_in" />);
    expect(screen.getByRole("status").textContent).toBe("2 people not marked after dive 2.");
    expect(screen.getByRole("link", { name: "Open roll call" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_2",
    );
    for (const tap of copy.taps) {
      expect(screen.getByRole("button", { name: tap.label })).toBeEnabled();
    }
  });

  it("offers the plan beside the roll call when the last dive was never counted", () => {
    render(
      <StageStrip
        action={noop}
        copy={{
          ...open,
          rollCallOpen: {
            ...open.rollCallOpen,
            line: "Dive 2 not counted. If it was called off, set the plan to 1 dive.",
            plan: {
              label: "Change the plan",
              href: "/shop/blue-mantis/trips/trip-1?view=details#dives",
            },
          },
        }}
        current="home"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Dive 2 not counted. If it was called off, set the plan to 1 dive.",
    );
    expect(screen.getByRole("link", { name: "Change the plan" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1?view=details#dives",
    );
    expect(screen.getByRole("link", { name: "Open roll call" })).toBeInTheDocument();
  });

  it("holds the line until the boat's word says the diving is over", () => {
    render(<StageStrip action={noop} copy={open} current="surface" />);
    expect(screen.queryByText(/not marked/)).toBeNull();
  });
});
