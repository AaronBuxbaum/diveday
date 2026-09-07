// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOTION_RUNGS } from "@/lib/motion";
import { StationSettles } from "./StationSettles";

afterEach(() => {
  cleanup();
});

const SENTENCE = "Nothing left before 7:00 AM.";

function rows(count: number) {
  return count === 0 ? null : (
    <ul data-rows>
      {["Nora", "Kwame", "Adaeze"].slice(0, count).map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  );
}

function mount(count: number) {
  return render(
    <StationSettles rowCount={count} sentence={SENTENCE}>
      {rows(count)}
    </StationSettles>,
  );
}

/**
 * jsdom's `CSSStyleDeclaration` has no `animation` property, so React binds
 * `onAnimationEnd` to the vendor-prefixed name there; fire both so the test
 * reads the same whichever React picked.
 */
function animationEnd(element: Element) {
  fireEvent.animationEnd(element);
  fireEvent(element, new Event("webkitAnimationEnd", { bubbles: true }));
}

function update(view: ReturnType<typeof render>, count: number) {
  view.rerender(
    <StationSettles rowCount={count} sentence={SENTENCE}>
      {rows(count)}
    </StationSettles>,
  );
}

/**
 * ADR 20260901-diveday-reimagined, slice 13g. The moment is *earned* by a
 * transition this reader watched, never by arriving on a page that was
 * already clear — the rule every earned moment in the tree keeps.
 */
/**
 * A duration as the stylesheet writes it — `200ms`, or a rung named through the
 * ladder both languages share (`src/lib/motion.ts`).
 */
function durationMs(value: string): number {
  const rung = value.match(/^var\(--motion-([a-z]+)\)$/)?.[1];
  if (rung) {
    const ms = MOTION_RUNGS[rung as keyof typeof MOTION_RUNGS];
    if (ms === undefined) throw new Error(`unknown motion rung: ${value}`);
    return ms;
  }
  const literal = value.match(/^(\d+)ms$/)?.[1];
  if (!literal) throw new Error(`unreadable duration: ${value}`);
  return Number(literal);
}

describe("StationSettles", () => {
  it("renders nothing for a station that arrives with no work", () => {
    mount(0);
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector("[data-station-swell]")).toBeNull();
  });

  it("renders the rows, and no water, for a station that arrives with work", () => {
    mount(2);
    expect(document.querySelector("[data-rows]")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector("[data-station-swell]")).toBeNull();
  });

  it("draws the swell and settles into the sentence when the last row clears", () => {
    const view = mount(2);
    act(() => update(view, 0));
    expect(document.querySelector("[data-rows]")).toBeNull();
    expect(document.querySelector("[data-station-swell]")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(SENTENCE);
  });

  it("keeps the words and drops the water once the swell has crossed", () => {
    const view = mount(1);
    act(() => update(view, 0));
    const swell = document.querySelector("[data-station-swell]");
    if (!swell) throw new Error("expected the swell");
    animationEnd(swell);
    expect(document.querySelector("[data-station-swell]")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(SENTENCE);
  });

  it("drops the water on the clock when its animation never ran", () => {
    // Tomorrow's stations sit inside a closed <details>: no animation runs
    // there, so `animationend` never fires, and without the clock the swell
    // would wait to play the moment the disclosure opened, hours later.
    vi.useFakeTimers();
    try {
      const view = mount(1);
      act(() => update(view, 0));
      expect(document.querySelector("[data-station-swell]")).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(document.querySelector("[data-station-swell]")).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent(SENTENCE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the rows back, and takes the sentence away, when work returns", () => {
    const view = mount(1);
    act(() => update(view, 0));
    act(() => update(view, 3));
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector("[data-station-swell]")).toBeNull();
    expect(document.querySelector("[data-rows]")).not.toBeNull();
    // ...and the next clear earns the moment afresh.
    act(() => update(view, 0));
    expect(document.querySelector("[data-station-swell]")).not.toBeNull();
  });

  it("draws the swell in Reef's hand, lagoon and never coral", () => {
    const view = mount(1);
    act(() => update(view, 0));
    const swell = document.querySelector("[data-station-swell]");
    if (!swell) throw new Error("expected the swell");
    expect(swell.getAttribute("aria-hidden")).toBe("true");
    expect(swell.getAttribute("stroke-width")).toBe("1.7");
    expect(swell.getAttribute("stroke-linecap")).toBe("round");
    // The home renders one coral element ever, resolved in DaySpine.tsx; the
    // water is not it.
    expect(swell.getAttribute("class")).not.toMatch(/accent/);
    expect(swell.getAttribute("class")).toContain("text-primary-hover");
    for (const path of swell.querySelectorAll("path")) {
      expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
  });

  it("stays inside the 400ms the moments table allows, on the arrival curve", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = css.match(
      /\.swell-across \{\n\s*animation: swell-across (\d+)ms var\(--ease-out-soft\) both;/,
    );
    if (!rule?.[1]) throw new Error("expected the swell-across rule in globals.css");
    const source = readFileSync(
      "src/app/shop/[shopSlug]/_components/today/StationSettles.tsx",
      "utf8",
    );
    // The component's clock fallback has to agree with the stylesheet.
    expect(source).toContain(`const SWELL_MS = ${rule[1]};`);
    // `.rise-in` names a rung rather than a number (ADR
    // 20260907-nothing-from-nowhere, decision 2), so the duration is resolved
    // through the same ladder JS reads. Matching a literal here is what broke
    // when the stylesheet moved onto it — and reading the token keeps this
    // assertion about the moment's *length* rather than about its spelling.
    const riseIn = css.match(/\.rise-in \{\n\s*animation: rise-in ([^\s;]+)/);
    if (!riseIn?.[1]) throw new Error("expected the rise-in rule in globals.css");
    const riseInMs = durationMs(riseIn[1]);
    // The sentence rises behind the swell's start by the inline delay in the
    // component; the whole moment is over when the later of the two ends.
    const delay = source.match(/animationDelay: "(\d+)ms"/);
    if (!delay?.[1]) throw new Error("expected the sentence's animation delay");
    expect(Math.max(Number(rule[1]), Number(delay[1]) + riseInMs)).toBeLessThanOrEqual(400);
    // It ends invisible: the swell is the transition, never a resting thing,
    // which is also what lets the reduced-motion kill-switch skip it entirely.
    expect(css).toMatch(/@keyframes swell-across \{[\s\S]*?to \{[^}]*opacity: 0;/);
  });
});
