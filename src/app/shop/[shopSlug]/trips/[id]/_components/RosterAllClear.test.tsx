// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RosterAllClear } from "./RosterAllClear";

afterEach(cleanup);

/**
 * The all-clear moment is a *transition*, and every interesting case here is
 * about what it refuses to celebrate. Tested at this level rather than in `e2e/`
 * on purpose: the moment lives for four seconds behind a timer, and asserting on
 * a self-expiring element in a browser is the shape `pnpm check:e2e-hygiene`
 * exists to refuse. Fake timers make the same behaviour deterministic.
 */
const LABEL = "Everyone's cleared to dive";

describe("RosterAllClear", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays quiet on a roster that was already clear when the page loaded", () => {
    // The difference between "this staffer just finished the job" and "nothing
    // needed doing" is the whole feature. Only the first is a finished thing.
    render(<RosterAllClear blockedCount={0} label={LABEL} />);
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it("stays quiet while divers are still blocked", () => {
    render(<RosterAllClear blockedCount={3} label={LABEL} />);
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it("celebrates when the last blocker clears", () => {
    const view = render(<RosterAllClear blockedCount={1} label={LABEL} />);
    view.rerender(<RosterAllClear blockedCount={0} label={LABEL} />);
    expect(screen.getByText(LABEL)).toBeVisible();
  });

  it("stays quiet when a blocker clears but others remain", () => {
    const view = render(<RosterAllClear blockedCount={3} label={LABEL} />);
    view.rerender(<RosterAllClear blockedCount={2} label={LABEL} />);
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it("is a moment, not a status — it leaves on its own", () => {
    const view = render(<RosterAllClear blockedCount={2} label={LABEL} />);
    view.rerender(<RosterAllClear blockedCount={0} label={LABEL} />);
    expect(screen.getByText(LABEL)).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it("gets out of the way the instant someone becomes blocked again", () => {
    // A seat added mid-celebration puts a blocker back on the list right below
    // this line; the line has to go with it rather than wait out its timer.
    const view = render(<RosterAllClear blockedCount={1} label={LABEL} />);
    view.rerender(<RosterAllClear blockedCount={0} label={LABEL} />);
    expect(screen.getByText(LABEL)).toBeVisible();
    view.rerender(<RosterAllClear blockedCount={1} label={LABEL} />);
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});
