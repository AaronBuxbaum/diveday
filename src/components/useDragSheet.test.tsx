// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissOnRelease, useDragSheet } from "./useDragSheet";

/**
 * The gesture's whole job is to decide two things from a hand: **is this a
 * drag** (rather than a tap, or a scroll the list should have) and **did the
 * release mean to close it** (rather than to put it back). Both are decided
 * from numbers, which is what makes them testable without a real finger.
 */

function Sheet({ onDismiss, height = 400 }: { onDismiss: () => void; height?: number }) {
  const drag = useDragSheet({ onDismiss });
  return (
    <div
      data-testid="sheet"
      {...drag.handlers}
      style={drag.style}
      ref={(node) => {
        if (node) node.getBoundingClientRect = () => ({ height }) as DOMRect;
      }}
    >
      <div data-sheet-handle data-testid="handle" />
      <div data-testid="list">a list</div>
      <span data-testid="scrim">{drag.scrim}</span>
      <span data-testid="dragging">{String(drag.dragging)}</span>
    </div>
  );
}

/**
 * A press, a travel and a release, in one gesture. Every event lands in the
 * same millisecond, so the hook reads no speed from it — which is the point:
 * these tests are about the distance half and about what starts a gesture.
 */
const drag = (to: number, { from = 0 }: { from?: number } = {}) => {
  const sheet = screen.getByTestId("sheet");
  fireEvent.pointerDown(sheet, { clientY: from, pointerType: "touch", button: -1 });
  fireEvent.pointerMove(sheet, { clientY: to, pointerType: "touch" });
  fireEvent.pointerUp(sheet, { clientY: to, pointerType: "touch" });
};

afterEach(cleanup);

/**
 * The release decision is pure and tested as a table, because a hand's *speed*
 * is the one input a DOM test cannot express: `fireEvent` ignores a `timeStamp`
 * in its init dict, so every synthetic event in a test carries the wall clock
 * and two of them are usually the same millisecond.
 */
describe("dismissOnRelease", () => {
  const sheet = { height: 400 };

  it("leaves when the finger took it past the line", () => {
    expect(dismissOnRelease({ ...sheet, travelled: 200, velocity: 0 })).toBe(true);
  });

  it("settles back from short of the line at no speed", () => {
    expect(dismissOnRelease({ ...sheet, travelled: 80, velocity: 0 })).toBe(false);
  });

  /** A hand that flicks means it, whatever distance the flick covered. */
  it("leaves on a throw that never reached the line", () => {
    expect(dismissOnRelease({ ...sheet, travelled: 90, velocity: 3 })).toBe(true);
  });

  it("keeps a sheet a slow hand nudged and let go of", () => {
    expect(dismissOnRelease({ ...sheet, travelled: 90, velocity: 0.2 })).toBe(false);
  });

  it("never leaves upward, however fast the hand was going", () => {
    expect(dismissOnRelease({ ...sheet, travelled: -120, velocity: 9 })).toBe(false);
  });

  /** The line is a share of the sheet, so a short sheet is not harder to close. */
  it("measures the line against the sheet's own height", () => {
    expect(dismissOnRelease({ height: 200, travelled: 90, velocity: 0 })).toBe(true);
    expect(dismissOnRelease({ height: 600, travelled: 90, velocity: 0 })).toBe(false);
  });
});

describe("useDragSheet", () => {
  it("leaves when the finger took it past the line", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    drag(200); // half of a 400px sheet, past the 40% line
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("settles back when the finger stopped short", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    drag(80); // a fifth of the sheet
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId("sheet").style.transform).toBe("");
  });

  it("does nothing for a tap: below the slop there is no gesture", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    drag(3);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId("dragging").textContent).toBe("false");
  });

  /**
   * The contract every gesture in this app shares: it never fights a scroll.
   * A sheet whose list has been scrolled is one the finger is reading.
   */
  it("gives a downward drag to the list when the list is scrolled", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const list = screen.getByTestId("list");
    Object.defineProperty(list, "scrollTop", { value: 120, configurable: true });
    drag(300);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("takes a drag from the handle however far the list has scrolled", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const list = screen.getByTestId("list");
    Object.defineProperty(list, "scrollTop", { value: 120, configurable: true });
    const sheet = screen.getByTestId("sheet");
    // Dispatched on the handle itself and caught by the sheet's handler as it
    // bubbles, which is the real shape of the gesture: `target` is the handle,
    // `currentTarget` is the sheet.
    fireEvent.pointerDown(screen.getByTestId("handle"), {
      clientY: 0,
      pointerType: "touch",
      button: -1,
    });
    fireEvent.pointerMove(sheet, { clientY: 300, pointerType: "touch" });
    fireEvent.pointerUp(sheet, { clientY: 300, pointerType: "touch" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  /**
   * **A tap has to reach the row underneath**, which is the regression that got
   * this hook onto a real page and straight into a red `staff-nav.spec.ts`:
   * capturing the pointer on `pointerdown` retargets every later pointer event
   * to the sheet, so a tap that never moves produces no `click` on the link it
   * landed on — and every destination in the More sheet silently stopped
   * navigating. Below the slop there is no gesture, so there is nothing to
   * capture.
   */
  it("captures the pointer only once a drag begins, so a tap still clicks through", () => {
    render(<Sheet onDismiss={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    const captured: number[] = [];
    sheet.setPointerCapture = (id: number) => captured.push(id);
    sheet.releasePointerCapture = () => {};

    fireEvent.pointerDown(sheet, { clientY: 0, pointerType: "touch", button: -1, pointerId: 7 });
    expect(captured, "a press is not yet a gesture").toEqual([]);

    fireEvent.pointerMove(sheet, { clientY: 3, pointerType: "touch", pointerId: 7 });
    expect(captured, "still inside the slop").toEqual([]);

    fireEvent.pointerMove(sheet, { clientY: 60, pointerType: "touch", pointerId: 7 });
    expect(captured, "now it is a drag").toEqual([7]);
  });

  it("runs no transition while a finger is on it: the finger is the clock", () => {
    render(<Sheet onDismiss={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    fireEvent.pointerDown(sheet, { clientY: 0, pointerType: "touch", button: -1 });
    fireEvent.pointerMove(sheet, { clientY: 100, pointerType: "touch" });
    expect(sheet.style.transition).toBe("none");
    expect(sheet.style.transform).toBe("translateY(100px)");
  });

  it("resists an upward pull instead of following it", () => {
    render(<Sheet onDismiss={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    fireEvent.pointerDown(sheet, { clientY: 200, pointerType: "touch", button: -1 });
    fireEvent.pointerMove(sheet, { clientY: 100, pointerType: "touch" });
    expect(sheet.style.transform, "100px of pull moved it 40").toBe("translateY(-40px)");
  });

  it("ignores a non-primary mouse button", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const sheet = screen.getByTestId("sheet");
    fireEvent.pointerDown(sheet, { clientY: 0, pointerType: "mouse", button: 2 });
    fireEvent.pointerMove(sheet, { clientY: 300, pointerType: "mouse" });
    fireEvent.pointerUp(sheet, { clientY: 300, pointerType: "mouse" });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
