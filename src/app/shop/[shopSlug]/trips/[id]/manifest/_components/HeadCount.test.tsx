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
  it("carries the count as a progressbar with the sentence, not only as pixels", () => {
    render(<HeadCount recorded={3} total={8} t={t} />);
    const figure = screen.getByRole("progressbar", { name: "Roll-call progress" });
    expect(figure.getAttribute("aria-valuenow")).toBe("3");
    expect(figure.getAttribute("aria-valuemax")).toBe("8");
    expect(figure.getAttribute("aria-valuetext")).toBe("3 of 8 divers recorded");
    expect(figure.textContent).toBe("3of 8");
  });

  it("raises the water to the recorded share, by transform only", () => {
    render(<HeadCount recorded={3} total={8} t={t} />);
    expect(water().style.transform).toBe("scaleY(0.375)");
    expect(water().style.height).toBe("");
    expect(water().getAttribute("aria-hidden")).toBe("true");
  });

  it("stands at the brim when everyone is counted, and at zero for an empty roster", () => {
    const view = render(<HeadCount recorded={8} total={8} t={t} />);
    expect(water().style.transform).toBe("scaleY(1)");
    view.unmount();
    render(<HeadCount recorded={0} total={0} t={t} />);
    expect(water().style.transform).toBe("scaleY(0)");
  });

  it("never overflows on a bad count", () => {
    render(<HeadCount recorded={9} total={8} t={t} />);
    expect(water().style.transform).toBe("scaleY(1)");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("8");
  });

  it("is lagoon, never coral, and draws nothing", () => {
    // No coral and no illustration on a manifest or a roll call — both ADR
    // tables. The water is a fill, not a creature.
    const { container } = render(<HeadCount recorded={8} total={8} t={t} />);
    expect(water().className).toContain("bg-primary-tint");
    expect(container.innerHTML).not.toMatch(/accent/);
    expect(container.querySelector("svg")).toBeNull();
  });
});
