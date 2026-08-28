// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckInQueueRow } from "@/db/check-in";
import { staffTranslator } from "@/i18n/staff-messages";
import { CounterQueueRow } from "./CounterQueueRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const t = staffTranslator("en-US");

function row(overrides: Partial<CheckInQueueRow> = {}): CheckInQueueRow {
  return {
    bookingId: "booking-1",
    personId: "person-1",
    personName: "Nadia Petrov",
    email: "nadia@example.com",
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

function renderRow(overrides: Partial<CheckInQueueRow> = {}, showEmail = false) {
  return render(
    <CounterQueueRow
      row={row(overrides)}
      shopSlug="blue-mantis"
      showEmail={showEmail}
      checkInAction={vi.fn().mockResolvedValue({ ok: true })}
      undoAction={vi.fn().mockResolvedValue({ ok: true })}
      waiverAction={vi.fn().mockResolvedValue(undefined)}
      t={t}
    />,
  );
}

describe("a blocked row", () => {
  /**
   * The pin the counter's whole gate rests on: readiness decides who may
   * board, so a blocked row offers the fix and never the tap. Offering both
   * would be offering an act the server is about to refuse, in front of the
   * diver it is about.
   */
  it("exposes its one fix and never a check-in control", () => {
    renderRow({
      readiness: { status: "blocked", blockers: [{ code: "waiver_not_sent" }] },
    });
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Waiver has not been sent.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Check in / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Undo check-in / })).not.toBeInTheDocument();
  });

  it("keeps the diver's record as a door and shows every reason it has", () => {
    renderRow({
      readiness: {
        status: "blocked",
        blockers: [{ code: "waiver_not_sent" }, { code: "payment_due" }],
      },
    });
    expect(screen.getByRole("link", { name: "Nadia Petrov" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-1",
    );
    expect(screen.getByText("Payment is outstanding for this trip.")).toBeInTheDocument();
  });
});

describe("an unblocked row", () => {
  it("is one tap, named for the diver", () => {
    renderRow();
    expect(screen.getByRole("button", { name: "Check in Nadia Petrov" })).toBeInTheDocument();
  });

  it("wears the drawn check and the state in words once settled", () => {
    const { container } = renderRow({ bookingStatus: "checked_in" });
    expect(screen.getByRole("button", { name: "Undo check-in for Nadia Petrov" })).toBeVisible();
    expect(screen.getByText("Checked in")).toBeInTheDocument();
    // Drawn, never an emoji — the mark is an SVG the shared component draws.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toMatch(/[☑✅\uD83C-\uDBFF]/u);
  });
});

describe("the quiet facts a row carries", () => {
  it("says a missing emergency contact in a neutral badge, never as a blocker", () => {
    renderRow({ missingEmergencyContact: true });
    expect(screen.getByText("No emergency contact")).toBeInTheDocument();
    // Still checkable: this informs, it never gates.
    expect(screen.getByRole("button", { name: "Check in Nadia Petrov" })).toBeInTheDocument();
  });

  it("renders no contact badge when the record has one", () => {
    renderRow();
    expect(screen.queryByText("No emergency contact")).not.toBeInTheDocument();
  });

  it("says a first visit as muted text after the name, never as a badge", () => {
    renderRow({ firstVisit: true });
    const firstVisit = screen.getByText("First visit");
    expect(firstVisit).toBeInTheDocument();
    // A badge is a pill; this is a line of quiet meta. The distinction is the
    // point — boxing it would put a welcome at the volume of "Blocked".
    expect(firstVisit.className).not.toMatch(/rounded-full/);
    expect(firstVisit.className).toMatch(/text-muted/);
  });

  it("renders nothing for a diver who has been before", () => {
    renderRow({ firstVisit: false });
    expect(screen.queryByText("First visit")).not.toBeInTheDocument();
  });

  it("carries a first visit on a blocked row too", () => {
    renderRow({
      firstVisit: true,
      readiness: { status: "blocked", blockers: [{ code: "waiver_not_sent" }] },
    });
    expect(screen.getByText("First visit")).toBeInTheDocument();
  });

  it("prints an email only where two visible divers share a name", () => {
    renderRow({}, false);
    expect(screen.queryByText(/nadia@example\.com/)).not.toBeInTheDocument();
    cleanup();
    renderRow({}, true);
    expect(screen.getByText(/nadia@example\.com/)).toBeInTheDocument();
  });
});
