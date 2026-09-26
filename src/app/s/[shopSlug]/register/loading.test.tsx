// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RegisterLoading from "./loading";

afterEach(cleanup);

const FORM = readFileSync(join(__dirname, "RegisterForm.tsx"), "utf8");

/**
 * **The counter's form arrives where its skeleton stood** (docs/design/
 * pixel-craft.md, class 11: 0px of shift on load). The skeleton predated the
 * form's two legend groups: six fields in one grid and a pill, where the page
 * draws three groups, nine fields and a 48px `md` button, so every field below
 * the first row landed lower than its grey box (K-384). Each count here is read
 * off the form's source, so a field added there fails here rather than as a
 * jump on every visit.
 */
describe("the register page's loading skeleton", () => {
  it("draws one box per control the form renders, each at the control's 44px", () => {
    const controls = [...FORM.matchAll(/className=\{controlClass\}/g)].length;
    expect(controls).toBe(9);
    const { container } = render(<RegisterLoading />);
    const boxes = container.querySelectorAll("[data-control-bar]");
    expect(boxes).toHaveLength(controls);
    for (const box of boxes) expect(box).toHaveClass("h-11", "rounded-lg");
  });

  it("stands a bar for each of the form's legends, at the legend's 32px line", () => {
    const legends = [...FORM.matchAll(/<legend className=\{LEAD_TITLE_CLASS\}>/g)].length;
    expect(legends).toBe(2);
    const { container } = render(<RegisterLoading />);
    const bars = container.querySelectorAll("[data-legend-bar]");
    expect(bars).toHaveLength(legends);
    for (const bar of bars) expect(bar).toHaveClass("h-8");
  });

  it("draws the submit as the md button it is, not a pill", () => {
    expect(FORM).toContain("className={buttonClass()}");
    const { container } = render(<RegisterLoading />);
    const submit = container.querySelector("[data-submit-bar]");
    expect(submit).toHaveClass("h-12", "rounded-lg");
    expect(submit).not.toHaveClass("rounded-full");
  });
});
