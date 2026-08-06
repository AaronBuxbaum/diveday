// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingDiversGrid, type MissingDiversGridCopy } from "./MissingDiversGrid";

/**
 * The roll-call "who is still not aboard" grid.
 *
 * This is a safety-critical surface — it is the list a crew member scans on a
 * dock before casting off — and its whole job is a *jump*: tap a face, land on
 * that diver's row in the manifest below. That behaviour (find the row,
 * scroll it into view, flash it, un-flash it two seconds later) is invisible to
 * a screenshot and awkward for e2e, so it is unproven anywhere else.
 *
 * The failure that matters is the quiet one: a diver whose row id does not
 * match, where the tap does nothing at all and a crew member concludes the
 * person is not on the manifest.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // The stub manifest rows below are appended to `document.body`, which
  // `cleanup()` does not own. Left behind, a row from an earlier test keeps its
  // id and `getElementById` returns *it* — so the next test's assertions would
  // silently be about a stale node.
  for (const row of document.querySelectorAll('[id^="diver-row-"]')) row.remove();
});

const COPY: MissingDiversGridCopy = {
  heading: "Still ashore",
  awaitingBoarding: "Awaiting boarding",
  tapHint: "Tap a diver to find them on the manifest.",
  rentsKitLabel: "Rental",
  ownKitLabel: "Own kit",
};

const DIVERS = [
  { bookingId: "booking-1", fullName: "Priya Raman", rentsKit: true },
  { bookingId: "booking-2", fullName: "Tomas Ek", rentsKit: false },
];

/** A stand-in for the manifest row the grid jumps to. */
function mountRow(bookingId: string) {
  const row = document.createElement("div");
  row.id = `diver-row-${bookingId}`;
  row.scrollIntoView = vi.fn();
  document.body.append(row);
  return row;
}

describe("what the grid shows", () => {
  it("renders one tappable diver per person still ashore", () => {
    render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(within(buttons[0]).getByText("Priya")).toBeInTheDocument();
    expect(within(buttons[1]).getByText("Tomas")).toBeInTheDocument();
  });

  it("disappears entirely once everyone is aboard", () => {
    // Not an empty card with a cheerful heading — the section is gone, because
    // "Awaiting boarding" next to nobody is a contradiction on a dock.
    const { container } = render(<MissingDiversGrid divers={[]} copy={COPY} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(COPY.heading)).not.toBeInTheDocument();
  });

  it("shows initials, first name, and whether the diver needs kit", () => {
    // The three facts a crew member needs to find a face and pull gear.
    render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);
    const priya = screen.getAllByRole("button")[0];
    expect(within(priya).getByText("PR")).toBeInTheDocument();
    expect(within(priya).getByText("Priya")).toBeInTheDocument();
    expect(within(priya).getByText(COPY.rentsKitLabel)).toBeInTheDocument();

    const tomas = screen.getAllByRole("button")[1];
    expect(within(tomas).getByText("TE")).toBeInTheDocument();
    expect(within(tomas).getByText(COPY.ownKitLabel)).toBeInTheDocument();
  });

  it("keeps the whole name reachable even though only the first is shown", () => {
    // The visible label is truncated to a first name to fit the tile; the full
    // name has to survive somewhere or two Priyas are indistinguishable.
    render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);
    expect(within(screen.getAllByRole("button")[0]).getByTitle("Priya Raman")).toBeInTheDocument();
  });

  it("takes at most two initials from a long name", () => {
    render(
      <MissingDiversGrid
        divers={[{ bookingId: "b", fullName: "Ana Maria Sofia Delgado", rentsKit: false }]}
        copy={COPY}
      />,
    );
    expect(screen.getByText("AM")).toBeInTheDocument();
  });

  it("survives a single-word name without crashing or rendering blanks", () => {
    // Real rosters carry mononyms and walk-in placeholders.
    render(
      <MissingDiversGrid
        divers={[{ bookingId: "b", fullName: "Kai", rentsKit: false }]}
        copy={COPY}
      />,
    );
    const tile = screen.getByRole("button");
    expect(within(tile).getByText("K")).toBeInTheDocument();
    expect(within(tile).getByText("Kai")).toBeInTheDocument();
  });

  it("hides the whole grid from print, where the manifest is the record", () => {
    const { container } = render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);
    expect(container.querySelector("section")).toHaveClass("print:hidden");
  });
});

describe("tapping a diver jumps to their manifest row", () => {
  it("scrolls that diver's row into view and flashes it", async () => {
    const user = userEvent.setup();
    const row = mountRow("booking-2");
    render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);

    await user.click(screen.getAllByRole("button")[1]);

    expect(row.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(row.classList.contains("ring-4")).toBe(true);
  });

  it("jumps to the tapped diver, not merely to the first row on the page", () => {
    // The bug this guards is an off-by-one or a shared id: with two rows
    // mounted, tapping the second must leave the first alone.
    const first = mountRow("booking-1");
    const second = mountRow("booking-2");
    render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);

    fireEvent.click(screen.getAllByRole("button")[1]);

    expect(second.scrollIntoView).toHaveBeenCalled();
    expect(first.scrollIntoView).not.toHaveBeenCalled();
    expect(second.classList.contains("ring-4")).toBe(true);
    expect(first.classList.contains("ring-4")).toBe(false);
  });

  it("clears the flash after two seconds so the highlight does not stick", () => {
    vi.useFakeTimers();
    const row = mountRow("booking-1");
    render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(row.classList.contains("ring-4")).toBe(true);

    vi.advanceTimersByTime(2000);

    // A ring left behind reads as "this diver is flagged" on a surface where
    // colour and emphasis mean readiness.
    expect(row.classList.contains("ring-4")).toBe(false);
    expect(row.classList.contains("ring-offset-2")).toBe(false);
  });

  it("does nothing when the diver has no row on the page", () => {
    // A booking present in the grid but absent from the manifest below. The tap
    // must be a no-op, never a crash that takes the whole roll-call down.
    render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);
    expect(() => fireEvent.click(screen.getAllByRole("button")[0])).not.toThrow();
  });
});

describe("the avatar colour is decoration, never status", () => {
  beforeEach(() => {
    cleanup();
  });

  it("never uses the readiness tones that mean flagged, ready, or blocked", () => {
    // This grid sits beside a manifest that colours rows by readiness. An
    // avatar tinted success/warning/danger would read as a status by accident.
    const many = Array.from({ length: 24 }, (_, index) => ({
      bookingId: `booking-${index}`,
      fullName: `Diver Number${index}`,
      rentsKit: index % 2 === 0,
    }));
    render(<MissingDiversGrid divers={many} copy={COPY} />);

    const classes = screen
      .getAllByRole("button")
      .map((button) => button.firstElementChild?.className ?? "");
    expect(classes).toHaveLength(24);
    for (const className of classes) {
      expect(className).not.toMatch(/\b(bg|text|border)-(success|warning|danger)\b/);
    }
  });

  it("gives the same diver the same colour every render", () => {
    // The colour is a hash of the name, so a re-render must not reshuffle the
    // grid under a crew member's finger.
    const first = render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);
    const before = screen.getAllByRole("button").map((b) => b.firstElementChild?.className);
    first.unmount();

    render(<MissingDiversGrid divers={DIVERS} copy={COPY} />);
    const after = screen.getAllByRole("button").map((b) => b.firstElementChild?.className);
    expect(after).toEqual(before);
  });
});
