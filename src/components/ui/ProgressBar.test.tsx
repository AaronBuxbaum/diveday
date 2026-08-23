// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

afterEach(cleanup);

const sheets = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[class*='origin-left']")].map((el) => ({
    transform: el.style.transform,
    className: el.className,
  }));

/**
 * **One bar, one behaviour.** There were three and no two matched: the shop
 * home's boarding bar jumped, the manifest's roll-call bar transitioned on
 * Tailwind's default curve, and the waiver's answered-count bar on
 * `--ease-out-soft` — on two surfaces a staffer moves between all morning
 * (issue #834).
 */
describe("ProgressBar", () => {
  /**
   * `width` is layout, so the browser reflows every frame of the transition;
   * principle 5 says transform/opacity only. Every fill is a sheet that scales.
   */
  it("scales rather than sizing, so nothing it animates is layout", () => {
    const { container } = render(
      <ProgressBar segments={[{ key: "a", fraction: 0.25, className: "bg-primary" }]} />,
    );
    const [fill] = sheets(container);
    expect(fill?.transform).toBe("scaleX(0.25)");
    expect(fill?.className).toContain("transition-transform");
    // Not a width anywhere on the fill — that is the whole point.
    expect(container.innerHTML).not.toContain("width:");
  });

  /**
   * Three bands reading 2/3/1 of six draw as a full-width sheet, a
   * five-sixths sheet over it, and a two-sixths sheet over that — left to
   * right as a reader sees them, widest furthest back.
   */
  it("stacks bands as cumulative sheets, widest first", () => {
    const { container } = render(
      <ProgressBar
        segments={[
          { key: "boarded", fraction: 2 / 6, className: "bg-primary" },
          { key: "ready", fraction: 3 / 6, className: "bg-success/70" },
          { key: "blocked", fraction: 1 / 6, className: "bg-danger" },
        ]}
      />,
    );
    const drawn = sheets(container);
    expect(drawn).toHaveLength(3);
    expect(drawn[0]?.className).toContain("bg-danger");
    expect(drawn[0]?.transform).toBe("scaleX(1)");
    expect(drawn[1]?.className).toContain("bg-success/70");
    // Rounded to four places — see `clamp`. `2/6 + 3/6` is 0.8333333333333333.
    expect(drawn[1]?.transform).toBe("scaleX(0.8333)");
    expect(drawn[2]?.className).toContain("bg-primary");
    expect(drawn[2]?.transform).toBe("scaleX(0.3333)");
  });

  it("draws nothing for a band with none of the track", () => {
    const { container } = render(
      <ProgressBar
        segments={[
          { key: "boarded", fraction: 0, className: "bg-primary" },
          { key: "ready", fraction: 0.5, className: "bg-success/70" },
        ]}
      />,
    );
    expect(sheets(container)).toHaveLength(1);
  });

  /** A bad count must not paint past the end of its own track. */
  /**
   * `2/6 + 3/6 + 1/6` is `0.9999999999999999`, and a bar ending a sub-pixel
   * short of its own track would write that into the DOM on every render.
   */
  it("reaches the end of its track when the bands add up", () => {
    const { container } = render(
      <ProgressBar
        segments={[
          { key: "a", fraction: 2 / 6, className: "bg-primary" },
          { key: "b", fraction: 3 / 6, className: "bg-success/70" },
          { key: "c", fraction: 1 / 6, className: "bg-danger" },
        ]}
      />,
    );
    expect(sheets(container)[0]?.transform).toBe("scaleX(1)");
  });

  it("clamps a fraction that overruns", () => {
    const { container } = render(
      <ProgressBar segments={[{ key: "a", fraction: 3, className: "bg-primary" }]} />,
    );
    expect(sheets(container)[0]?.transform).toBe("scaleX(1)");
  });

  /**
   * The meaning is the caller's — decorative on the boarding bar, a real
   * `progressbar` on the manifest, described by a `status` sentence on the
   * waiver — so the component renders no ARIA and forwards what it is given.
   */
  it("carries the caller's own meaning and invents none", () => {
    const { container } = render(
      <ProgressBar
        aria-hidden="true"
        segments={[{ key: "a", fraction: 0.5, className: "bg-primary" }]}
      />,
    );
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[role=progressbar]")).toBeNull();
  });
});
