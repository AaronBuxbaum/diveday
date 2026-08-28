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

function renderQueue(rows: CheckInQueueRow[], settledOpen = false, showFirstVisit = true) {
  return render(
    <CounterQueue
      rows={rows}
      shopSlug="blue-mantis"
      isAmbiguousName={() => false}
      showFirstVisit={showFirstVisit}
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

  /**
   * The group used to slice itself to three and print "and 2 more" as inert
   * text with no control to reveal the rest — so on a boat with twelve aboard,
   * opening the receipts showed three names and a number. Worse, the three it
   * kept were the alphabetically first, while its own comment claimed they were
   * the ones a mis-tap is most likely to be about. Folding at rest is what the
   * forty-receipts problem actually needed; nothing is withheld once it opens.
   */
  it("lists every settled row once the group is open, never a truncated preview", () => {
    renderQueue(
      ["Ines Costa", "June Park", "Lena Fischer", "Marisol Vega", "Omar Haddad"].map(settled),
      true,
    );
    expect(screen.getByText("Checked in — 5")).toBeInTheDocument();
    expect(screen.getByText("Omar Haddad")).toBeInTheDocument();
    expect(screen.queryByText(/and \d+ more/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when nobody has checked in", () => {
    const { container } = renderQueue([row("Nadia Petrov")]);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByText(/Checked in —/)).not.toBeInTheDocument();
  });

  /**
   * **The counter's most dangerous silence.** Readiness is re-read on every
   * render and a check-in does not freeze it, so a refund landing or a captain
   * moving the second tank to a deeper site blocks a diver who came through the
   * door an hour ago. That row used to sink into the folded group wearing no
   * badge and no reasons, and the instrument above it painted green. The
   * manifest would still refuse them at the rail; catching it ashore, while the
   * diver is standing in front of somebody, is this surface's whole job.
   */
  it("keeps a checked-in diver who has gone blocked in the working list", () => {
    const { container } = renderQueue([
      settled("Ines Costa"),
      row("Amara Osei", {
        bookingStatus: "checked_in",
        readiness: { status: "blocked", blockers: [{ code: "payment_due" }] },
      }),
    ]);
    const details = container.querySelector("details");
    expect(details?.textContent).not.toContain("Amara Osei");
    expect(details?.querySelector("summary")?.textContent).toContain("Checked in — 1");
    // Out here with its badge and its reason, where a staffer can act on it.
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Payment is outstanding for this trip.")).toBeInTheDocument();
  });
});
