// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FACT_SOURCES } from "@/lib/fact-source";
import { FactSource } from "./FactSource";

/** The chip's own dot, which carries the source's ink. */
function dot(container: HTMLElement): HTMLElement {
  const found = container.querySelector("[aria-hidden='true']");
  if (!(found instanceof HTMLElement)) throw new Error("the chip drew no dot");
  return found;
}

afterEach(cleanup);

describe("FactSource", () => {
  it("always renders the word, for every kind", () => {
    // Colour never carries a state alone (ADR 20260827-clearwater-surface-
    // language), and here the ink is the only other thing separating four
    // identical dots — so the label is a required prop and this is the check
    // that it is honoured.
    for (const kind of FACT_SOURCES) {
      const { unmount } = render(<FactSource kind={kind} label={`Said by ${kind}`} />);
      expect(screen.getByText(`Said by ${kind}`)).toBeInTheDocument();
      unmount();
    }
  });

  it("gives each kind the Budget's own ink", () => {
    const inks: Record<(typeof FACT_SOURCES)[number], string> = {
      forecast: "border-border-strong",
      plan: "bg-primary",
      crew: "bg-foreground",
      observed: "bg-success",
    };
    for (const [kind, ink] of Object.entries(inks)) {
      const { container, unmount } = render(
        <FactSource kind={kind as (typeof FACT_SOURCES)[number]} label="Source" />,
      );
      expect(dot(container).className).toContain(ink);
      unmount();
    }
  });

  it("draws forecast hollow and nothing else", () => {
    // Nobody stands behind a forecast, so its dot is a ring rather than a fill.
    const { container: forecast } = render(<FactSource kind="forecast" label="Forecast" />);
    expect(dot(forecast).className).not.toMatch(/\bbg-/);

    for (const kind of ["plan", "crew", "observed"] as const) {
      const { container } = render(<FactSource kind={kind} label="Source" />);
      expect(dot(container).className).toMatch(/\bbg-/);
      expect(dot(container).className).not.toContain("border");
    }
  });

  it("renders a time only when one is given", () => {
    const { container: bare } = render(<FactSource kind="crew" label="Crew" />);
    expect(bare.textContent).toBe("Crew");

    const { container: timed } = render(
      <FactSource kind="crew" label="Crew" at="Sep 4, 7:40 AM" />,
    );
    expect(timed.textContent).toBe("Crew · Sep 4, 7:40 AM");
  });

  it("holds no copy and no raw colour of its own", () => {
    // Semantic tokens only (ADR-0004), and the words come from the caller's
    // bundle — this file names no language.
    const source = readFileSync(join(__dirname, "FactSource.tsx"), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "");
    for (const word of ["Forecast", "Plan", "Crew", "Observed"]) {
      expect(code).not.toContain(word);
    }
  });
});
