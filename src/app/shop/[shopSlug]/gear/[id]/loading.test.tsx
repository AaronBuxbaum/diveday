// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import GearUnitLoading from "./loading";

afterEach(cleanup);

/**
 * **The unit's heading lands where its skeleton drew it** (docs/design/
 * pixel-craft.md, class 11: 0px of shift on load). The skeleton drew an
 * eyebrow bar of its own, then the header skeleton — which draws the one
 * eyebrow the page has ("‹ Gear register") — 16px further down, so the
 * heading jumped up 32px when the page arrived (K-431).
 */
describe("the gear unit's loading skeleton", () => {
  it("opens on the header skeleton, with no eyebrow bar ahead of it", () => {
    const { container } = render(<GearUnitLoading />);
    const root = container.querySelector(".animate-pulse");
    expect(root?.firstElementChild).toHaveClass("mb-8");
    expect(container.querySelectorAll(".w-28.h-4")).toHaveLength(0);
  });

  it("draws exactly one eyebrow bar", () => {
    const { container } = render(<GearUnitLoading />);
    const header = container.querySelector(".animate-pulse")?.firstElementChild;
    expect(header?.firstElementChild).toHaveClass("h-4", "w-24");
    expect(container.querySelectorAll(".h-4")).toHaveLength(1);
  });
});
