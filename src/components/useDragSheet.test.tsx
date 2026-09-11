// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissOnRelease, useDragSheet } from "./useDragSheet";

/**
 * The gesture's whole job is to decide two things from a hand: **is this a
 * drag** (rather than a tap, or a scroll the list should have) and **did the
 * release mean to close it** (rather than to put it back). Both are decided
 * from numbers, which is what makes them testable without a real finger.
 */

function Sheet({
  onDismiss,
  height = 400,
  overflowing = false,
}: {
  onDismiss: () => void;
  height?: number;
  /** The real sheet: `max-h` and `overflow-y-auto`, with more rows than fit. */
  overflowing?: boolean;
}) {
  const drag = useDragSheet({ onDismiss });
  return (
    <div
      data-testid="sheet"
      {...drag.handlers}
      style={{ ...drag.style, overflowY: "auto" }}
      ref={(node) => {
        if (node) {
          node.getBoundingClientRect = () => ({ height }) as DOMRect;
          // jsdom lays nothing out, so the one measurement the gate reads has
          // to be stated. Both, because the gate compares them.
          for (const [prop, value] of [
            ["scrollHeight", overflowing ? height * 2 : height],
            ["clientHeight", height],
          ] as const) {
            Object.defineProperty(node, prop, { value, configurable: true });
          }
        }
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
 * `fireEvent` stamps a synthetic event with the wall clock and ignores a
 * `timeStamp` in its init dict, so the only way to hold a gesture's speed still
 * is to stamp the event after building it.
 */
const at = <E extends Event>(event: E, ms: number): E => {
  Object.defineProperty(event, "timeStamp", { value: ms, configurable: true });
  return event;
};

/** Any instant; the hook only ever reads differences. */
const PRESSED_AT = 1_000;

/**
 * A press, a travel and a release, in one gesture, over a span this helper
 * decides. `overMs` defaults to none, so the hook reads no speed and the
 * distance half of the decision is the only variable — which is what most of
 * these tests are about.
 *
 * It used to hope for that rather than hold it. The three events were left to
 * the wall clock on the assumption that they would land in the same
 * millisecond, and on an unloaded machine they do. On a loaded CI runner they
 * do not: press and release straddling 8ms is enough for the hook to divide the
 * whole 80px travel by the gap, read 10px/ms, and call a deliberate nudge a
 * throw. That is how "settles back when the finger stopped short" failed once
 * on PR #1443 while passing on every other branch built from the same commit.
 */
const drag = (to: number, { from = 0, overMs = 0 }: { from?: number; overMs?: number } = {}) => {
  const sheet = screen.getByTestId("sheet");
  const touch = { pointerType: "touch" } as const;
  fireEvent(
    sheet,
    at(createEvent.pointerDown(sheet, { ...touch, clientY: from, button: -1 }), PRESSED_AT),
  );
  fireEvent(
    sheet,
    at(createEvent.pointerMove(sheet, { ...touch, clientY: to }), PRESSED_AT + overMs),
  );
  fireEvent(
    sheet,
    at(createEvent.pointerUp(sheet, { ...touch, clientY: to }), PRESSED_AT + overMs),
  );
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

  /**
   * The same 80px, read two ways. Slow, it is a nudge and the sheet comes back;
   * covered in 20ms it is 4px per millisecond and the hand meant it. Both are
   * the hook working as designed — the point of pinning them together is that
   * the *test* now decides which one it is asking for, rather than inheriting
   * whatever gap the machine happened to leave between two synthetic events.
   */
  it("reads the same short travel as a throw only when it was fast", () => {
    const slow = vi.fn();
    render(<Sheet onDismiss={slow} />);
    drag(80);
    expect(slow).not.toHaveBeenCalled();
    cleanup();

    const thrown = vi.fn();
    render(<Sheet onDismiss={thrown} />);
    drag(80, { overMs: 20 });
    expect(thrown).toHaveBeenCalledOnce();
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
   * **A list that can scroll owns the press before it has scrolled** (#1512).
   * The shop's fifteenth destination took the sheet's content past its
   * `max-h-[calc(100dvh-8rem)]` cap; a thumb on a row there used to start a
   * gesture, receive one `pointermove`, and lose the pointer to the browser's
   * scroller — leaving the sheet open under a thumb that meant to close it.
   * Nothing starts now, so nothing half-starts.
   */
  it("starts no drag off the handle once the list can scroll at all", () => {
    const onDismiss = vi.fn();
    const listeners = vi.spyOn(document, "addEventListener");
    render(<Sheet onDismiss={onDismiss} overflowing />);
    drag(300);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId("dragging").textContent).toBe("false");
    expect(listeners, "a refused press leaves nothing on the document").not.toHaveBeenCalled();
    listeners.mockRestore();
  });

  it("still takes the drag from the handle of a sheet that overflows", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} overflowing />);
    const sheet = screen.getByTestId("sheet");
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
   * `setPointerCapture` on the press retargets every later pointer event to the
   * sheet, so a tap that never moves produces no `click` on the link it landed
   * on — and every destination in the More sheet silently stopped navigating.
   * Nothing is captured now, at any point in the gesture.
   */
  it("never captures the pointer, so a tap still clicks through to the row", () => {
    render(<Sheet onDismiss={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    const captured: number[] = [];
    sheet.setPointerCapture = (id: number) => captured.push(id);

    fireEvent.pointerDown(sheet, { clientY: 0, pointerType: "touch", button: -1, pointerId: 7 });
    fireEvent.pointerMove(sheet, { clientY: 3, pointerType: "touch", pointerId: 7 });
    fireEvent.pointerMove(sheet, { clientY: 90, pointerType: "touch", pointerId: 7 });
    fireEvent.pointerUp(sheet, { clientY: 90, pointerType: "touch", pointerId: 7 });
    expect(captured).toEqual([]);
  });

  /**
   * The hole that capturing-on-drag opened and the document listeners close: a
   * finger starting near the sheet's bottom edge crosses the slop over the dock
   * below it, so every move after the first lands on an element the sheet's own
   * handlers never hear from. The gesture has to survive leaving the sheet.
   */
  it("keeps following a finger that has left the sheet", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const sheet = screen.getByTestId("sheet");
    const elsewhere = document.body;

    fireEvent.pointerDown(sheet, { clientY: 0, pointerType: "touch", button: -1, pointerId: 3 });
    // Every move and the release land outside the sheet entirely.
    fireEvent.pointerMove(elsewhere, { clientY: 120, pointerType: "touch", pointerId: 3 });
    expect(sheet.style.transform, "the sheet followed a finger it cannot see").toBe(
      "translateY(120px)",
    );
    fireEvent.pointerUp(elsewhere, { clientY: 220, pointerType: "touch", pointerId: 3 });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  /** A second finger's events are not this gesture's. */
  it("ignores a pointer that is not the one that started the gesture", () => {
    render(<Sheet onDismiss={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    fireEvent.pointerDown(sheet, { clientY: 0, pointerType: "touch", button: -1, pointerId: 1 });
    fireEvent.pointerMove(sheet, { clientY: 200, pointerType: "touch", pointerId: 2 });
    expect(sheet.style.transform).toBe("");
  });

  it("stops listening once the sheet unmounts under the finger", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Sheet onDismiss={onDismiss} />);
    const sheet = screen.getByTestId("sheet");
    fireEvent.pointerDown(sheet, { clientY: 0, pointerType: "touch", button: -1, pointerId: 5 });
    unmount();
    // A tap that navigated away takes the sheet with it; the release that
    // follows must not reach a hook that is gone.
    fireEvent.pointerUp(document.body, { clientY: 300, pointerType: "touch", pointerId: 5 });
    expect(onDismiss).not.toHaveBeenCalled();
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
