// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckInQueueRow } from "@/db/check-in";
import { staffTranslator } from "@/i18n/staff-messages";
import { CounterQueue } from "./CounterQueue";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const t = staffTranslator("en-US");

function row(name: string, overrides: Partial<CheckInQueueRow> = {}): CheckInQueueRow {
  return {
    bookingId: `booking-${name}`,
    personId: `person-${name}`,
    personName: name,
    email: null,
    tripId: "trip-1",
    tripTitle: "Two-Tank Reef — Molasses & French",
    startsAt: new Date("2026-08-27T11:00:00.000Z"),
    endsAt: new Date("2026-08-27T14:30:00.000Z"),
    bookingStatus: "booked",
    readiness: { status: "ready", blockers: [] },
    boarded: false,
    missingEmergencyContact: false,
    firstVisit: false,
    ...overrides,
  };
}

const settled = (name: string) => row(name, { bookingStatus: "checked_in" });

function renderQueue(rows: CheckInQueueRow[], settledOpen = false) {
  return render(
    <CounterQueue
      rows={rows}
      shopSlug="blue-mantis"
      isAmbiguousName={() => false}
      checkInAction={vi.fn().mockResolvedValue({ ok: true })}
      undoAction={vi.fn().mockResolvedValue({ ok: true })}
      waiverAction={vi.fn().mockResolvedValue(undefined)}
      settledOpen={settledOpen}
      settledHeadingLevel="h3"
      t={t}
    />,
  );
}

describe("the settled group", () => {
  /**
   * The recomposition's load-bearing split (ADR
   * 20260827-clearwater-surface-language, decision 9): the working list holds
   * only the people a staffer can still do something about. Interleaving is
   * what made a twenty-six-name morning unreadable.
   */
  it("holds every checked-in row, never interleaved with the queue", () => {
    const { container } = renderQueue([
      settled("Ines Costa"),
      row("Nadia Petrov"),
      settled("June Park"),
    ]);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain("Ines Costa");
    expect(details?.textContent).toContain("June Park");
    expect(details?.textContent).not.toContain("Nadia Petrov");
    // And the waiting row is outside it, where the taps are.
    expect(screen.getByRole("button", { name: "Check in Nadia Petrov" })).toBeInTheDocument();
  });

  it("is the one disclosure spelling, labelled with its count and closed at rest", () => {
    const { container } = renderQueue([settled("Ines Costa"), settled("June Park")]);
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("Checked in — 2");
  });

  it("arrives open for a boat that has already sailed", () => {
    const { container } = renderQueue([settled("Ines Costa")], true);
    expect(container.querySelector("details")?.open).toBe(true);
  });

  it("counts the rest beyond three rather than listing forty receipts", () => {
    renderQueue(
      ["Ines Costa", "June Park", "Lena Fischer", "Marisol Vega", "Omar Haddad"].map(settled),
      true,
    );
    expect(screen.getByText("Checked in — 5")).toBeInTheDocument();
    expect(screen.getByText("and 2 more")).toBeInTheDocument();
    expect(screen.queryByText("Omar Haddad")).not.toBeInTheDocument();
  });

  it("renders nothing at all when nobody has checked in", () => {
    const { container } = renderQueue([row("Nadia Petrov")]);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByText(/Checked in —/)).not.toBeInTheDocument();
  });

  it("says nothing about a remainder when every settled row is shown", () => {
    renderQueue([settled("Ines Costa"), settled("June Park")], true);
    expect(screen.queryByText(/and \d+ more/)).not.toBeInTheDocument();
  });
});
