// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { HeadCount } from "./HeadCount";

afterEach(cleanup);

const t = staffTranslator("en-US");

function water() {
  const element = document.querySelector<HTMLElement>("[data-head-count-water]");
  if (!element) throw new Error("expected the water");
  return element;
}

/**
 * ADR 20260901-diveday-reimagined, slice 13h. The fill is decoration behind
 * a figure that carries every fact; the rules pinned here are the ones a
 * restyle must not lose.
 */
describe("HeadCount", () => {
  it("carries the count as a progressbar with the sentence, and says the words on screen", () => {
    const { container } = render(<HeadCount aboard={7} out={8} t={t} />);
    const figure = screen.getByRole("progressbar", { name: "Roll-call progress" });
    expect(figure.getAttribute("aria-valuenow")).toBe("7");
    expect(figure.getAttribute("aria-valuemax")).toBe("8");
    expect(figure.getAttribute("aria-valuetext")).toBe("7 of 8 divers aboard");
    // The qualifying words are visible, not only in ARIA: "7" over a bare
    // "of 8" read as seven back aboard whatever the seven counted (dive-domain
    // review 20260902).
    expect(container.textContent).toBe("7of 8 divers aboard");
  });

  it("raises the water to the aboard share, by transform only", () => {
    render(<HeadCount aboard={3} out={8} t={t} />);
    expect(water().style.transform).toBe("scaleY(0.375)");
    expect(water().style.height).toBe("");
    expect(water().getAttribute("aria-hidden")).toBe("true");
  });

  it("stands at the brim when everyone is aboard, and at zero for an empty glass", () => {
    const view = render(<HeadCount aboard={8} out={8} t={t} />);
    expect(water().style.transform).toBe("scaleY(1)");
    view.unmount();
    render(<HeadCount aboard={0} out={0} t={t} />);
    expect(water().style.transform).toBe("scaleY(0)");
  });

  it("bounds the water, never the numbers: a bad count looks bad", () => {
    render(<HeadCount aboard={9} out={8} t={t} />);
    expect(water().style.transform).toBe("scaleY(1)");
    const figure = screen.getByRole("progressbar");
    expect(figure.getAttribute("aria-valuenow")).toBe("9");
    expect(figure.getAttribute("aria-valuetext")).toBe("9 of 8 divers aboard");
  });

  it("is lagoon, never coral, and draws nothing", () => {
    // No coral and no illustration on a manifest or a roll call — both ADR
    // tables. The water is a fill, not a creature.
    const { container } = render(<HeadCount aboard={8} out={8} t={t} />);
    expect(water().className).toContain("bg-primary-tint");
    expect(container.innerHTML).not.toMatch(/accent/);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps the words at reading size", () => {
    // Critical text on a roll call is 16px (principles.md §1); the first cut
    // put "of 8" at 12px inside the glass, straddling the water line.
    const { container } = render(<HeadCount aboard={7} out={8} t={t} />);
    expect(container.querySelector(".text-xs")).toBeNull();
  });
});
