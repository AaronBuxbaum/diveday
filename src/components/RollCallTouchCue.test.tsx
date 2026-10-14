// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROLL_CALL_PANEL_ATTRIBUTE,
  ROLL_CALL_TOUCH_CUE_MS,
  RollCallTouchCue,
} from "./RollCallTouchCue";
import { TOUCH_REFUSED_EVENT } from "./roll-call-touch-guard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LINE = "Tap again with one finger.";

/** The painted pill, wherever its accessible role went. */
const pill = () =>
  Array.from(document.body.querySelectorAll("p")).find(
    (node) => node.textContent === LINE && !node.classList.contains("sr-only"),
  ) ?? null;

const refuse = (inside: HTMLElement = document.body) => {
  const control = document.createElement("button");
  inside.append(control);
  control.dispatchEvent(new CustomEvent(TOUCH_REFUSED_EVENT, { bubbles: true }));
  control.remove();
};

afterEach(() => {
  for (const node of document.querySelectorAll("[data-fixture]")) node.remove();
});

/** The pinned count card, its bottom edge `bottom` px down the screen. */
function pinnedCard(bottom: number) {
  const card = document.createElement("section");
  card.setAttribute(ROLL_CALL_PANEL_ATTRIBUTE, "");
  card.setAttribute("data-fixture", "");
  card.getBoundingClientRect = () => ({ bottom }) as DOMRect;
  document.body.append(card);
}

/**
 * The words that go with a refused roll-call press (issue #2328): said in a
 * polite status line when the guard refuses a press, and nowhere otherwise.
 */
describe("the roll call's touch cue", () => {
  it("says nothing while no press was refused", () => {
    render(<RollCallTouchCue message={LINE} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the line when a press is refused, then goes", () => {
    vi.useFakeTimers();
    render(<RollCallTouchCue message={LINE} />);
    act(() => refuse());
    expect(screen.getByRole("status")).toHaveTextContent(LINE);
    // It takes no taps: the roll-call controls stay reachable under it.
    expect(screen.getByRole("status").parentElement?.className).toContain("pointer-events-none");
    act(() => vi.advanceTimersByTime(ROLL_CALL_TOUCH_CUE_MS));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lands again for a second refusal, for a whole cue", () => {
    vi.useFakeTimers();
    render(<RollCallTouchCue message={LINE} />);
    act(() => refuse());
    act(() => vi.advanceTimersByTime(ROLL_CALL_TOUCH_CUE_MS - 100));
    act(() => refuse());
    act(() => vi.advanceTimersByTime(ROLL_CALL_TOUCH_CUE_MS - 100));
    expect(screen.getByRole("status")).toHaveTextContent(LINE);
  });

  /**
   * **Clear of the head count** (dive-domain review of #2328): the line sits
   * just under the pinned count card, and at the top only where there is no
   * card on screen or the press was inside the person sheet, whose backdrop
   * covers the card.
   */
  it("sits just under the pinned count card, and never moves", () => {
    pinnedCard(300);
    render(<RollCallTouchCue message={LINE} />);
    act(() => refuse());
    const line = screen.getByRole("status");
    expect(line.parentElement?.style.top).toBe("308px");
    expect(line.className).not.toMatch(/rise-in|animate-/);
  });

  it("goes to the top for a press inside the person sheet, or with no card", () => {
    pinnedCard(300);
    const sheet = document.createElement("section");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("data-fixture", "");
    document.body.append(sheet);
    render(<RollCallTouchCue message={LINE} />);
    act(() => refuse(sheet));
    expect(pill()?.parentElement?.style.top).toBe("calc(var(--chrome-h, 0px) + 1rem)");
  });

  /**
   * **Heard inside the open sheet** (#2534). The sheet is `aria-modal`, so a
   * screen reader confined to it never reached a status line painted outside
   * it. The words go into the sheet as well; the pill painted over it is then
   * hidden from assistive tech, so nobody hears them twice.
   */
  it("speaks inside the open person sheet for a press refused there", () => {
    const sheet = document.createElement("section");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("data-fixture", "");
    document.body.append(sheet);
    render(<RollCallTouchCue message={LINE} />);
    act(() => refuse(sheet));
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(sheet.contains(statuses[0] ?? null)).toBe(true);
    expect(statuses[0]).toHaveTextContent(LINE);
    expect(pill()).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps a single status line outside any sheet", () => {
    render(<RollCallTouchCue message={LINE} />);
    act(() => refuse());
    expect(screen.getAllByRole("status")).toEqual([pill()]);
    expect(pill()).not.toHaveAttribute("aria-hidden");
  });

  /**
   * **In the boat palette when raised from a boat-mode page** (#2534). The
   * pill is portalled to `body`, outside the manifest's `.boat-mode` wrapper,
   * so it painted in the office palette. It carries the class itself, with
   * the wrapper's own ground left transparent so no band crosses the screen.
   */
  it("wears the boat palette when the page it was raised from is in boat mode", () => {
    const boat = document.createElement("div");
    boat.className = "boat-mode";
    boat.setAttribute("data-fixture", "");
    document.body.append(boat);
    render(<RollCallTouchCue message={LINE} />, { container: boat });
    act(() => refuse());
    const wrapper = pill()?.parentElement;
    expect(wrapper).toHaveClass("boat-mode");
    expect(wrapper?.style.backgroundColor).toBe("transparent");
    expect(boat.contains(wrapper ?? null)).toBe(false);
  });

  it("stays in the office palette elsewhere", () => {
    render(<RollCallTouchCue message={LINE} />);
    act(() => refuse());
    expect(pill()?.parentElement).not.toHaveClass("boat-mode");
  });

  /**
   * **One line per refusal, however many manifests are on the page**
   * (dive-domain review of #2328): the paper-day page draws one per departure.
   */
  it("answers once per document, and hands over when the answering one goes", () => {
    const first = render(<RollCallTouchCue message={LINE} />);
    render(<RollCallTouchCue message={LINE} />);
    render(<RollCallTouchCue message={LINE} />);
    act(() => refuse());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    first.unmount();
    act(() => refuse());
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
