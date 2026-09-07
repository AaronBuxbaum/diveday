// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettledRows } from "./SettledRows";

/**
 * jsdom has no layout, so every `getBoundingClientRect` here is one this test
 * supplies. That is the right shape for what has to hold: the rule is about
 * *which properties* the slide writes and *when* it declines to run, and both
 * are decisions the hook makes from the numbers it is handed rather than
 * anything a real browser would decide differently.
 */

const reducedMotion = (matches: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
};

/**
 * Give the container and every row a position, in the order they appear. The
 * first entry is the list's own top; the rest are the rows'.
 */
const layout = (tops: number[]) => {
  let call = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = tops[call] ?? 0;
    call += 1;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
  });
};

const rows = (names: string[]) => (
  <SettledRows>
    {names.map((name) => (
      <div key={name} data-testid={name}>
        {name}
      </div>
    ))}
  </SettledRows>
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SettledRows", () => {
  it("puts a row back where it was and releases it, writing only a transform", () => {
    reducedMotion(false);
    // First paint: the list starts at 0, its three rows at 0, 60 and 120.
    layout([0, 0, 60, 120]);
    const { rerender, getByTestId } = render(rows(["hugo", "ben", "grace"]));

    // Hugo checks in and leaves. Ben and Grace are now 60px higher.
    layout([0, 0, 60]);
    rerender(rows(["ben", "grace"]));

    const ben = getByTestId("ben");
    expect(ben.style.transform, "released to its real position").toBe("");
    expect(ben.style.transition).toContain("transform");
    // The travel is the only thing written: no top, no margin, no height.
    expect(ben.getAttribute("style")).not.toMatch(/top|margin|height|width/);
  });

  it("leaves a row that did not move alone", () => {
    reducedMotion(false);
    layout([0, 0, 60]);
    const { rerender, getByTestId } = render(rows(["ben", "grace"]));
    layout([0, 0, 60]);
    rerender(rows(["ben", "grace"]));
    expect(getByTestId("ben").getAttribute("style")).toBeNull();
  });

  it("measures a row against the list, so a page that scrolled is not a rearrangement", () => {
    reducedMotion(false);
    layout([0, 0, 60]);
    const { rerender, getByTestId } = render(rows(["ben", "grace"]));
    // Everything moved up 200px together: the reader scrolled, the list did not
    // change. Each row's offset *within* the list is what it was.
    layout([-200, -200, -140]);
    rerender(rows(["ben", "grace"]));
    expect(getByTestId("grace").getAttribute("style")).toBeNull();
  });

  it("declines to run for a reader who asked for reduced motion", () => {
    reducedMotion(true);
    layout([0, 0, 60, 120]);
    const { rerender, getByTestId } = render(rows(["hugo", "ben", "grace"]));
    layout([0, 0, 60]);
    rerender(rows(["ben", "grace"]));
    expect(getByTestId("ben").getAttribute("style")).toBeNull();
  });

  it("says nothing about a row it has never seen before", () => {
    reducedMotion(false);
    layout([0, 0]);
    const { rerender, getByTestId } = render(rows(["ben"]));
    layout([0, 0, 60]);
    rerender(rows(["ben", "priya"]));
    expect(getByTestId("priya").getAttribute("style")).toBeNull();
  });
});
