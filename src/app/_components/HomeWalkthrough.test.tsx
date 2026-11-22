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

  it("advances by itself, a beat at a time, and Pause stops it", () => {
    mockMotion(false);
    setup();
    // The first card holds 7 s on its first frame, then a beat with nothing to do first is 0.7 s of
    // lead, 1.8 s of tap and 4.2 s on the finished screen.
    act(() => void vi.advanceTimersByTime(15_000));
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
    fireEvent.pointerMove(group, { clientX: 100 });
    fireEvent.pointerUp(group, { clientX: 100 });
    expect(screen.getByText("Second")).toBeInTheDocument();
    fireEvent.pointerDown(group, { clientX: 100 });
    fireEvent.pointerMove(group, { clientX: 200 });
    fireEvent.pointerUp(group, { clientX: 200 });
    expect(screen.getByText("First")).toBeInTheDocument();
    fireEvent.pointerDown(frame, { clientX: 100 });
    fireEvent.pointerUp(frame, { clientX: 101 });
    expect(screen.getByText("Second")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("Second"), { clientX: 100 });
    fireEvent.pointerUp(screen.getByText("Second"), { clientX: 100 });
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("moves on a finger swipe that leans a little up, and claims the sideways move", () => {
    mockMotion(true);
    setup();
    const group = screen.getByRole("group", { name: "Walk" });
    fireEvent.touchStart(group, { touches: [{ clientX: 200, clientY: 50 }] });
    const sideways = fireEvent.touchMove(group, { touches: [{ clientX: 120, clientY: 40 }] });
    fireEvent.touchEnd(group, { changedTouches: [{ clientX: 100, clientY: 38 }] });
    expect(sideways).toBe(false);
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("never moves on or taps when a touch that began as a scroll drifts sideways", () => {
    mockMotion(true);
    const { container } = setup();
    const group = screen.getByRole("group", { name: "Walk" });
    const frame = container.querySelector("[data-walk-frame]") as HTMLElement;
    // Mostly down, then a long sideways drift: still the page scrolling.
    fireEvent.touchStart(frame, { touches: [{ clientX: 200, clientY: 50 }] });
    const down = fireEvent.touchMove(frame, { touches: [{ clientX: 195, clientY: 100 }] });
    fireEvent.touchMove(frame, { touches: [{ clientX: 90, clientY: 120 }] });
    fireEvent.touchEnd(frame, { changedTouches: [{ clientX: 90, clientY: 120 }] });
    expect(down).toBe(true);
    expect(screen.getByText("First")).toBeInTheDocument();
    // A diagonal that is not clearly sideways is a scroll too.
    fireEvent.touchStart(group, { touches: [{ clientX: 200, clientY: 50 }] });
    const diagonal = fireEvent.touchMove(group, { touches: [{ clientX: 140, clientY: 110 }] });
    fireEvent.touchEnd(group, { changedTouches: [{ clientX: 100, clientY: 150 }] });
    expect(diagonal).toBe(true);
    expect(screen.getByText("First")).toBeInTheDocument();
    // A short vertical scroll that ends on a screen is not a tap.
    fireEvent.touchStart(frame, { touches: [{ clientX: 200, clientY: 50 }] });
    fireEvent.touchMove(frame, { touches: [{ clientX: 200, clientY: 70 }] });
    fireEvent.touchEnd(frame, { changedTouches: [{ clientX: 200, clientY: 70 }] });
    expect(screen.getByText("First")).toBeInTheDocument();
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
    act(() => void vi.advanceTimersByTime(10_350));
    const half = Number.parseFloat(fill()?.style.transform.replace("scaleX(", "") ?? "0");
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    // Holding pauses the bar and the beat; letting go carries on from there.
    fireEvent.pointerDown(group, { clientX: 100 });
    act(() => void vi.advanceTimersByTime(120_000));
    expect(screen.getByText("First")).toBeInTheDocument();
    fireEvent.pointerUp(group, { clientX: 100 });
    act(() => void vi.advanceTimersByTime(3_700));
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

  it("plays a beat as before, tap, after, and stays on the frame it was paused on", () => {
    mockMotion(false);
    const { container } = setup();
    const list = container.querySelector("[data-walk-list]") as HTMLElement;
    const phase = () => list.getAttribute("data-walk-phase");
    expect(phase()).toBe("before");
    // The first card holds 7 s, then the tap starts 0.7 s in and the finished screen 1.8 s after that.
    act(() => void vi.advanceTimersByTime(1_000));
    expect(phase()).toBe("before");
    expect(list).toHaveAttribute("data-walk-idle");
    act(() => void vi.advanceTimersByTime(6_800));
    expect(phase()).toBe("tap");
    act(() => void vi.advanceTimersByTime(2_000));
    expect(phase()).toBe("after");
    // Paused mid-play, it stays on that frame, its animations held where they are.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(phase()).toBe("after");
    expect(list).toHaveAttribute("data-walk-still");
    // A slide opened while it is paused starts on its first frame, still.
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(phase()).toBe("before");
    expect(list).toHaveAttribute("data-walk-still");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(list).not.toHaveAttribute("data-walk-still");
  });

  it("gives a beat with something to do first a longer first phase before its tap", () => {
    mockMotion(false);
    const longBeats: WalkBeat[] = [{ ...(BEATS[0] as WalkBeat), lead: 5_000 }, ...BEATS.slice(1)];
    const { container } = render(
      <HomeWalkthrough beats={longBeats} labels={LABELS}>
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
    act(() => void vi.advanceTimersByTime(9_000));
    expect(list.getAttribute("data-walk-phase")).toBe("before");
    act(() => void vi.advanceTimersByTime(4_000));
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
