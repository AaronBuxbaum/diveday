// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCROLL_SETTLED_ATTRIBUTE } from "@/components/PreserveFormScroll";
import { FormStatus } from "./form";

afterEach(cleanup);

/**
 * **An outcome that lands below the fold says nothing at all.**
 *
 * A section's outcome renders inside that section rather than in one banner at
 * the top, which fixed the confirmation appearing off-screen *above* a reader
 * who saved halfway down. `PreserveFormScroll` then puts them back exactly
 * where they submitted from, so the same confirmation can land below the fold
 * instead — the same silence, from the other direction. Measured on the diver
 * record's gear group at 1280×720, the notice sat 26px above the fold, and
 * clearing the sticky bar for anchor landings (#1941) spent that margin.
 *
 * jsdom lays nothing out, so every rectangle here is stubbed: what is under
 * test is the *decision* — when to move the page and when to leave it alone —
 * and that is arithmetic over rectangles rather than anything a browser has to
 * answer. `e2e/divers.spec.ts` holds the rendered half.
 */
const scrollIntoView = vi.fn();

/** The status `<p>` this component reveals — its own previous sibling. */
function statusElement(container: HTMLElement): HTMLElement {
  const status = container.querySelector("p");
  if (!status) throw new Error("FormStatus rendered no paragraph");
  return status;
}

/** Pin the status's box, run the frame the effect defers to, and report. */
function reveal(container: HTMLElement, box: { top: number; bottom: number }) {
  const status = statusElement(container);
  status.scrollIntoView = scrollIntoView;
  status.getBoundingClientRect = () => ({ ...box, height: box.bottom - box.top }) as DOMRect;
  // The effect waits one frame, because `PreserveFormScroll` restores the
  // submit-time position inside a frame of its own.
  vi.runAllTimers();
}

beforeEach(() => {
  scrollIntoView.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    Number(setTimeout(() => fn(0), 0)),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  // A 720px viewport, and a chrome bar's worth of it spent before the usable
  // part begins — `html { scroll-padding-top: var(--chrome-h) }`.
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(720);
  vi.stubGlobal("getComputedStyle", () => ({ scrollPaddingTop: "56px" }) as CSSStyleDeclaration);
  // `PreserveFormScroll` has put the viewport where it is going. Without this
  // every test below would pass by exhausting the frame budget rather than by
  // the signal, which is a slower way of asserting nothing.
  document.documentElement.setAttribute(SCROLL_SETTLED_ATTRIBUTE, "true");
});

afterEach(() => {
  document.documentElement.removeAttribute(SCROLL_SETTLED_ATTRIBUTE);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a form's outcome that lands where nobody can read it", () => {
  it("brings itself into view when it is below the fold", () => {
    const { container } = render(<FormStatus tone="success">Rental fit profile saved.</FormStatus>);
    reveal(container, { top: 750, bottom: 770 });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("brings itself into view when it is above the fold", () => {
    // The original complaint, and still a case: a save from far down the page
    // that leaves the confirmation behind the reader.
    const { container } = render(<FormStatus tone="success">Saved.</FormStatus>);
    reveal(container, { top: -120, bottom: -100 });
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  /**
   * The paired negative, and the load-bearing one: an outcome that yanks the
   * viewport when the reader can already read it is worse than one that does
   * nothing at all.
   */
  it("leaves the page alone when it is already on screen", () => {
    const { container } = render(<FormStatus tone="success">Saved.</FormStatus>);
    reveal(container, { top: 300, bottom: 320 });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * The sticky bar is not viewport. A status sitting under it is unreadable in
   * exactly the way this rule is about, so `scroll-padding-top` — not zero —
   * is where the usable viewport starts.
   */
  it("counts a status hidden behind the chrome bar as off screen", () => {
    const { container } = render(<FormStatus tone="success">Saved.</FormStatus>);
    reveal(container, { top: 20, bottom: 40 });
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("stays out of a refusal's way, which has a better destination", () => {
    // `FieldErrorFocus` scrolls the offending control into view and focuses
    // it. Two scrolls aimed at different elements in one frame is a page that
    // jumps twice, and the field is what the reader has to act on.
    const { container } = render(<FormStatus tone="danger">That email is taken.</FormStatus>);
    expect(container.querySelector("span[hidden]")).toBeNull();
    reveal(container, { top: 750, bottom: 770 });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * The reveal is only as good as its timing, and this is the failure that
   * shape is for: `PreserveFormScroll` restores the submit-time position in a
   * frame of its own, and a measurement taken first reads a viewport that is
   * about to move. Measured on the diver record, the status was at 138 when the
   * check ran and 748 once the restore had landed.
   */
  it("waits for the page to say where the viewport has settled", () => {
    document.documentElement.removeAttribute(SCROLL_SETTLED_ATTRIBUTE);
    const { container } = render(<FormStatus tone="success">Saved.</FormStatus>);
    const status = statusElement(container);
    status.scrollIntoView = scrollIntoView;
    // On screen *now*, off screen once the restore has run — the exact trap.
    let box = { top: 138, bottom: 160 };
    status.getBoundingClientRect = () => ({ ...box, height: box.bottom - box.top }) as DOMRect;

    vi.advanceTimersByTime(0);
    expect(scrollIntoView, "measured before the restore had happened").not.toHaveBeenCalled();

    box = { top: 748, bottom: 770 };
    document.documentElement.setAttribute(SCROLL_SETTLED_ATTRIBUTE, "true");
    vi.runAllTimers();
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  /**
   * **And for the page to have stopped moving.** Three things scroll the diver
   * record in the same moment — the disclosure opening its group, the restore,
   * and the browser's smooth animation between them — so a measurement taken
   * mid-flight reads an offset no reader ever sees. Recorded there: viewport
   * 138 while the page was still travelling, 748 once it had landed.
   */
  it("waits for the page to stop moving before it measures", () => {
    const { container } = render(<FormStatus tone="success">Saved.</FormStatus>);
    const status = statusElement(container);
    status.scrollIntoView = scrollIntoView;
    // On screen at the offset the page is passing through, off screen at the
    // one it settles on.
    let y = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
    let box = { top: 138, bottom: 160 };
    status.getBoundingClientRect = () => ({ ...box, height: box.bottom - box.top }) as DOMRect;

    // Still travelling: a different offset every frame.
    for (let frame = 0; frame < 4; frame += 1) {
      y += 120;
      vi.advanceTimersByTime(0);
    }
    expect(scrollIntoView, "measured while the page was still scrolling").not.toHaveBeenCalled();

    // Landed, and the status is not where it looked like it would be.
    box = { top: 748, bottom: 770 };
    vi.runAllTimers();
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("renders nothing at all, and reveals nothing, with no message", () => {
    const { container } = render(<FormStatus tone="success">{undefined}</FormStatus>);
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("span[hidden]")).toBeNull();
  });
});
