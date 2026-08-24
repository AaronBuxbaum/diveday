// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EARNED_MOMENT_SURFACE, EarnedMomentLine } from "./EarnedMoment";

afterEach(cleanup);

/**
 * The compact shape (issue 761) — pinned so a future call site cannot drift
 * back into rebuilding the coral line by hand the way Today, the departure
 * board and the gear register each once did.
 */
describe("EarnedMomentLine", () => {
  it("announces itself as a status, so a screen reader hears the moment without a reload", () => {
    render(<EarnedMomentLine>Everyone's aboard.</EarnedMomentLine>);
    expect(screen.getByRole("status")).toHaveTextContent("Everyone's aboard.");
  });

  it("carries the rationed accent classes and rise-in, the reduced-motion kill-switch's hook", () => {
    render(<EarnedMomentLine>All home</EarnedMomentLine>);
    const line = screen.getByRole("status");
    expect(line.className).toContain("rise-in");
    expect(line.className).toContain("border-accent/40");
    expect(line.className).toContain("bg-accent/10");
  });

  it("merges a caller's className rather than replacing the line's own", () => {
    render(<EarnedMomentLine className="mt-4">All home</EarnedMomentLine>);
    expect(screen.getByRole("status").className).toContain("mt-4");
  });

  it("supplies no glyph — a moment's mark belongs in its words, where a translator can see it", () => {
    render(<EarnedMomentLine>All home</EarnedMomentLine>);
    expect(screen.getByRole("status").textContent).toBe("All home");
  });
});

/**
 * The panel shape, for the one surface with a heading of its own
 * (close-out) rather than a single line — a class string rather than a third
 * component, so the vocabulary still lives in one place.
 */
describe("EARNED_MOMENT_SURFACE", () => {
  it("carries the same rationed accent vocabulary as the line and the whole-page moment", () => {
    expect(EARNED_MOMENT_SURFACE).toContain("rise-in");
    expect(EARNED_MOMENT_SURFACE).toContain("border-accent/40");
    expect(EARNED_MOMENT_SURFACE).toContain("bg-accent/10");
  });
});
