// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeWalkthrough, type WalkBeat } from "./HomeWalkthrough";

const BEATS: WalkBeat[] = [
  { step: "a", frame: "one", caption: "First" },
  { step: "b", frame: "one", caption: "Second" },
  { step: "b", frame: "two", caption: "Third" },
];
const LABELS = {
  label: "Walk",
  position: "Step {n} of {total}",
  pause: "Pause",
  play: "Play",
  previous: "Previous step",
  next: "Next step",
  goTo: "Go to step {n}",
  hint: "Tap, swipe, or use the arrow keys.",
};

function setup() {
  return render(
    <HomeWalkthrough beats={BEATS} labels={LABELS}>
      <ol data-walk-list>
        <li data-walk-step="a">
          <div data-walk-frame="one" />
        </li>
        <li data-walk-step="b">
          <div data-walk-frame="one" />
          <div data-walk-frame="two" />
        </li>
      </ol>
    </HomeWalkthrough>,
  );
}

function mockMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the homepage walkthrough", () => {
  it("marks the list as a walk and shows the first beat", () => {
    mockMotion(false);
    const { container } = setup();
    expect(container.querySelector("[data-walk-list]")).toHaveAttribute("data-walk");
    expect(container.querySelector('[data-walk-step="a"]')).toHaveAttribute("data-walk-current");
    expect(container.querySelector('[data-walk-step="b"]')).not.toHaveAttribute(
      "data-walk-current",
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("advances by itself over about two minutes, and Pause stops it", () => {
    mockMotion(false);
    setup();
    act(() => void vi.advanceTimersByTime(51_000));
    expect(screen.getByText("Second")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => void vi.advanceTimersByTime(120_000));
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("does not start under reduced motion, and still moves by hand", () => {
    mockMotion(true);
    const { container } = setup();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(120_000));
    expect(screen.getByText("First")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText("Third")).toBeInTheDocument();
    // The third beat is the second screen of the second step.
    const frames = container.querySelectorAll('[data-walk-step="b"] [data-walk-frame]');
    expect(frames[0]).not.toHaveAttribute("data-walk-frame-current");
    expect(frames[1]).toHaveAttribute("data-walk-frame-current");
  });

  it("moves with the arrow keys and wraps around", () => {
    mockMotion(true);
    setup();
    const group = screen.getByRole("group", { name: "Walk" });
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByText("Third")).toBeInTheDocument();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("moves on a swipe and on a tap of a screen, not on a tap elsewhere", () => {
    mockMotion(true);
    const { container } = setup();
    const group = screen.getByRole("group", { name: "Walk" });
    const frame = container.querySelector("[data-walk-frame]") as HTMLElement;
    fireEvent.pointerDown(group, { clientX: 200 });
    fireEvent.pointerUp(group, { clientX: 100 });
    expect(screen.getByText("Second")).toBeInTheDocument();
    fireEvent.pointerDown(group, { clientX: 100 });
    fireEvent.pointerUp(group, { clientX: 200 });
    expect(screen.getByText("First")).toBeInTheDocument();
    fireEvent.pointerDown(frame, { clientX: 100 });
    fireEvent.pointerUp(frame, { clientX: 101 });
    expect(screen.getByText("Second")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("Second"), { clientX: 100 });
    fireEvent.pointerUp(screen.getByText("Second"), { clientX: 100 });
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("follows a drag with the beat, moves on past the threshold and springs back short of it", () => {
    mockMotion(true);
    const { container } = setup();
    const group = screen.getByRole("group", { name: "Walk" });
    const list = container.querySelector("[data-walk-list]") as HTMLElement;
    fireEvent.pointerDown(group, { clientX: 200, clientY: 50 });
    fireEvent.pointerMove(group, { clientX: 170, clientY: 52 });
    expect(list.style.transform).toBe("translateX(-30px)");
    // Short of the threshold: the beat goes home and the walk stays put.
    fireEvent.pointerUp(group, { clientX: 170 });
    expect(list.style.transform).toBe("");
    expect(screen.getByText("First")).toBeInTheDocument();
    // Past it: the next beat.
    fireEvent.pointerDown(group, { clientX: 200, clientY: 50 });
    fireEvent.pointerMove(group, { clientX: 100, clientY: 52 });
    fireEvent.pointerUp(group, { clientX: 100 });
    expect(list.style.transform).toBe("");
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("does not drag on a mostly vertical move, which is the page scrolling", () => {
    mockMotion(true);
    const { container } = setup();
    const group = screen.getByRole("group", { name: "Walk" });
    const list = container.querySelector("[data-walk-list]") as HTMLElement;
    fireEvent.pointerDown(group, { clientX: 200, clientY: 50 });
    fireEvent.pointerMove(group, { clientX: 190, clientY: 120 });
    expect(list.style.transform).toBe("");
  });

  it("goes back on a tap of a screen's left edge, as Instagram's stories do", () => {
    mockMotion(true);
    const { container } = setup();
    const frame = container.querySelector("[data-walk-frame]") as HTMLElement;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 300,
    } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText("Second")).toBeInTheDocument();
    const second = container.querySelector('[data-walk-step="b"] [data-walk-frame]') as HTMLElement;
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({ left: 0, width: 300 } as DOMRect);
    fireEvent.pointerDown(second, { clientX: 20 });
    fireEvent.pointerUp(second, { clientX: 21 });
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("fills the current segment as the beat's clock, and a hold freezes it", () => {
    mockMotion(false);
    const { container } = setup();
    const fill = () =>
      container.querySelector<HTMLElement>(
        "[data-walk-controls] ~ div > button > span > span:last-child",
      );
    const group = screen.getByRole("group", { name: "Walk" });
    act(() => void vi.advanceTimersByTime(25_000));
    const half = Number.parseFloat(fill()?.style.transform.replace("scaleX(", "") ?? "0");
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    // Holding pauses the bar and the beat; letting go carries on from there.
    fireEvent.pointerDown(group, { clientX: 100 });
    act(() => void vi.advanceTimersByTime(120_000));
    expect(screen.getByText("First")).toBeInTheDocument();
    fireEvent.pointerUp(group, { clientX: 100 });
    act(() => void vi.advanceTimersByTime(26_000));
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("jumps to a step when its segment of the bar is clicked", () => {
    mockMotion(true);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Go to step 3" }));
    expect(screen.getByText("Third")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to step 1" }));
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("does not treat the release of a hold as a tap", () => {
    mockMotion(true);
    const { container } = setup();
    const frame = container.querySelector("[data-walk-frame]") as HTMLElement;
    fireEvent.pointerDown(frame, { clientX: 100 });
    act(() => void vi.advanceTimersByTime(1_000));
    fireEvent.pointerUp(frame, { clientX: 100 });
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("plays a beat as before, tap, after, and shows the first frame when stopped", () => {
    mockMotion(false);
    const { container } = setup();
    const list = container.querySelector("[data-walk-list]") as HTMLElement;
    const phase = () => list.getAttribute("data-walk-phase");
    expect(phase()).toBe("before");
    // Three beats of 50 seconds: the tap starts at 10% and the swap at 30%.
    act(() => void vi.advanceTimersByTime(6_000));
    expect(phase()).toBe("tap");
    act(() => void vi.advanceTimersByTime(10_000));
    expect(phase()).toBe("after");
    // Pause goes back to the first frame and holds it; Play runs the beat from there.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(phase()).toBe("before");
    expect(list).toHaveAttribute("data-walk-still");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(list).not.toHaveAttribute("data-walk-still");
    expect(["before", "tap", "after"]).toContain(phase());
  });

  it("gives a beat she types into a longer first phase before its tap", () => {
    mockMotion(false);
    const typedBeats: WalkBeat[] = [{ ...(BEATS[0] as WalkBeat), typed: true }, ...BEATS.slice(1)];
    const { container } = render(
      <HomeWalkthrough beats={typedBeats} labels={LABELS}>
        <ol data-walk-list>
          <li data-walk-step="a">
            <div data-walk-frame="one" />
          </li>
          <li data-walk-step="b">
            <div data-walk-frame="one" />
            <div data-walk-frame="two" />
          </li>
        </ol>
      </HomeWalkthrough>,
    );
    const list = container.querySelector("[data-walk-list]") as HTMLElement;
    // A typed beat runs 75 seconds here and taps at 40%, so 6 seconds in she is still typing.
    act(() => void vi.advanceTimersByTime(6_000));
    expect(list.getAttribute("data-walk-phase")).toBe("before");
    act(() => void vi.advanceTimersByTime(25_000));
    expect(list.getAttribute("data-walk-phase")).toBe("tap");
  });

  it("holds the first frame, its animations still, under reduced motion", () => {
    mockMotion(true);
    const { container } = setup();
    const list = container.querySelector("[data-walk-list]");
    expect(list).toHaveAttribute("data-walk-phase", "before");
    expect(list).toHaveAttribute("data-walk-still");
  });
});
