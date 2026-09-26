// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelHeight, ROLL_CALL_PANEL_HEIGHT_VAR } from "./PanelHeight";

/**
 * **The pinned count card tells the rows under it how tall it is.**
 *
 * A roll-call row that a chip jumps to has to land below the card, and the
 * card's height is content: danger lines, the chips naming who is missing,
 * and on a phone each of them stacked and wrapped. A written-down height was
 * 240px against a 426px card at 390 (pixel-craft class 9). jsdom has no
 * layout, so the observer is a stub standing in for the browser's.
 */

type Entries = Array<Partial<ResizeObserverEntry>>;

interface StubRecord {
  callback: (entries: Entries) => void;
  observed: Array<{ target: Element; options?: ResizeObserverOptions }>;
  disconnected: boolean;
}

let observers: StubRecord[] = [];

class StubResizeObserver {
  private readonly record: StubRecord;
  constructor(callback: (entries: Entries) => void) {
    this.record = { callback, observed: [], disconnected: false };
    observers.push(this.record);
  }
  observe(target: Element, options?: ResizeObserverOptions) {
    this.record.observed.push({ target, options });
  }
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  observers = [];
});

function renderInColumn() {
  return render(
    <div data-testid="column">
      <PanelHeight labelledBy="progress-heading" className="sticky top-(--chrome-h)">
        <h2 id="progress-heading">After dive 1</h2>
      </PanelHeight>
    </div>,
  );
}

describe("the pinned card publishes its own height", () => {
  it("renders the card itself, with no wrapper between it and the column", () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    renderInColumn();
    const card = screen.getByRole("region", { name: "After dive 1" });
    // A wrapper would bound `sticky` to itself and un-pin the card a few rows
    // down (`SummaryPanel`, and e2e/manifest.spec.ts's pinned-panel test).
    expect(card.parentElement).toBe(screen.getByTestId("column"));
    expect(card).toHaveClass("sticky", "top-(--chrome-h)");
  });

  it("writes the border-box height it is observed at, rounded up, on the column", () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    renderInColumn();
    const card = screen.getByRole("region", { name: "After dive 1" });
    const column = screen.getByTestId("column");
    const [observer] = observers;
    expect(observer?.observed).toEqual([{ target: card, options: { box: "border-box" } }]);

    observer?.callback([{ target: card, borderBoxSize: [{ blockSize: 425.4, inlineSize: 350 }] }]);
    expect(column.style.getPropertyValue(ROLL_CALL_PANEL_HEIGHT_VAR)).toBe("426px");

    // It follows the card: a danger line clearing shrinks it.
    observer?.callback([{ target: card, borderBoxSize: [{ blockSize: 342, inlineSize: 350 }] }]);
    expect(column.style.getPropertyValue(ROLL_CALL_PANEL_HEIGHT_VAR)).toBe("342px");
  });

  it("takes the height back when the card goes, so no row clears a card that is not there", () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    const { unmount } = renderInColumn();
    const column = screen.getByTestId("column");
    const [observer] = observers;
    observer?.callback([{ borderBoxSize: [{ blockSize: 300, inlineSize: 350 }] }]);
    expect(column.style.getPropertyValue(ROLL_CALL_PANEL_HEIGHT_VAR)).toBe("300px");

    // Unmounting removes the column too, so hold on to it and look after.
    unmount();
    expect(observer?.disconnected).toBe(true);
    expect(column.style.getPropertyValue(ROLL_CALL_PANEL_HEIGHT_VAR)).toBe("");
  });

  it("leaves the rows' fallback standing where the browser has no ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    renderInColumn();
    expect(screen.getByRole("region", { name: "After dive 1" })).toBeInTheDocument();
    expect(screen.getByTestId("column").style.getPropertyValue(ROLL_CALL_PANEL_HEIGHT_VAR)).toBe(
      "",
    );
  });
});
