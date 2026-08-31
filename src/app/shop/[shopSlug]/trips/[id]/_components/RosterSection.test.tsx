// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RosterSection } from "./RosterSection";
import type {
  NitroxByBooking,
  ReadinessByBooking,
  RentalFitByBooking,
  RosterEntry,
  WaiverByBooking,
} from "./types";

afterEach(cleanup);

/**
 * The rules slice 5d ships on (ADR
 * 20260827-the-departure-is-two-working-surfaces): the roster is **one
 * grouped ledger** whose group bands own the state word and the count, a
 * cleared seat is a name and a drawn mark with no per-row state word, open
 * work keeps its sentence and its fix in the open, and the filter chips are
 * gone because the groups are the filter. Pinned as rules, never pixels —
 * a restyle may move everything here except what these assert.
 */

const noop = () => {};

function entry(
  id: string,
  fullName: string,
  over: { emergencyContactName?: string; emergencyContactPhone?: string } = {},
): RosterEntry {
  return {
    booking: {
      id,
      status: "booked",
      groupPreference: null,
      lastDivedBand: null,
      hotelPickupLocation: null,
      pickupTime: null,
    } as unknown as RosterEntry["booking"],
    person: {
      id: `p-${id}`,
      fullName,
      email: `${id}@example.com`,
      dateOfBirth: null,
      emergencyContactName: over.emergencyContactName ?? "Ada Contact",
      emergencyContactPhone: over.emergencyContactPhone ?? "+1 555 0100",
    } as unknown as RosterEntry["person"],
  };
}

const signedWaiver = {
  waiver: {
    id: "w-1",
    status: "completed",
    completedAt: new Date("2026-08-20T15:00:00Z"),
    signatureMethod: "digital",
    expiresAt: new Date("2027-08-20T15:00:00Z"),
    medicalAnswers: null,
  },
} as unknown as WaiverByBooking extends Map<string, infer V> ? V : never;

function readinessRow(status: "ready" | "blocked", blockers: unknown[] = []) {
  return {
    readiness: { status, blockers },
    paymentStatus: "paid",
    paymentProvider: null,
    depthAdvisory: null,
  } as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;
}

function renderRoster({
  roster,
  readiness,
  waivers,
  compact = false,
  addDiverGroup,
}: {
  roster: RosterEntry[];
  readiness: ReadinessByBooking;
  waivers: WaiverByBooking;
  compact?: boolean;
  addDiverGroup?: ReactNode;
}) {
  return render(
    <RosterSection
      shopSlug="blue-mantis"
      shopTimezone="America/New_York"
      locale="en-US"
      tripId="trip-1"
      booked={roster.length}
      capacity={12}
      roster={roster}
      readinessByBooking={readiness}
      waiverByBooking={waivers}
      rentalFitByBooking={new Map() as RentalFitByBooking}
      nitroxByBooking={new Map() as NitroxByBooking}
      requiresPayment={false}
      paymentsConnected={false}
      cancellationDeadline={null}
      markWaiverInPersonAction={noop}
      markPaymentAction={noop}
      mayWriteOffPayment={false}
      removeBookingAction={noop}
      confirmIdentityAction={noop}
      notesByBooking={new Map()}
      addNoteAction={noop}
      deleteNoteAction={noop}
      saveEmergencyContactAction={noop}
      depthUnit="meters"
      tripDate="2026-08-28"
      compact={compact}
      addDiverGroup={addDiverGroup}
    />,
  );
}

const blocked = entry("a", "Asha Osei");
const ready = entry("b", "Rene Marsh");
const fixtures = {
  roster: [blocked, ready],
  readiness: new Map([
    ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
    ["b", readinessRow("ready")],
  ]) as ReadinessByBooking,
  waivers: new Map([
    ["a", signedWaiver],
    ["b", signedWaiver],
  ]) as WaiverByBooking,
};

describe("the guests ledger (slice 5d)", () => {
  it("files every seat under a group band that owns the state word and the count", () => {
    renderRoster(fixtures);

    // The band is a real heading, once per group — the word plus the tally.
    expect(screen.getByRole("heading", { name: "Still to clear · 1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ready · 1" })).toBeVisible();
  });

  it("never repeats the group's state word down its rows: a cleared seat is a name and a drawn mark", () => {
    const { container } = renderRoster(fixtures);

    // "Ready" appears exactly once on the surface — the group band. The old
    // roster printed it (with a 🌊) beside all seven cleared rows, which is
    // the repetition principle 9 forbids and this ledger removes.
    const readyWords = screen.getAllByText(/^Ready/);
    expect(readyWords).toHaveLength(1);

    // The cleared seat's mark is drawn SVG (decision 5) — no emoji anywhere
    // on the ledger, in any state.
    const row = container.querySelector(`#booking-${ready.booking.id}`);
    expect(row).not.toBeNull();
    expect(row?.querySelector("summary svg")).not.toBeNull();
    expect(container.textContent).not.toMatch(/[\u{1F30A}\u{1F382}\u{2705}\u{26A0}\u{274C}]/u);
  });

  it("keeps a blocked seat's sentence and its fix in the open, ahead of the cleared rows", () => {
    renderRoster(fixtures);

    // The blocker sentence renders without any tap...
    expect(screen.getByText("No certification is on file for this trip.")).toBeVisible();
    // ...with its one fix beside it, pointing at the record that clears it.
    expect(screen.getByRole("link", { name: /Review certifications/ })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/divers/${blocked.person.id}#cards`,
    );

    // And the groups order the page's answer: open work above cleared seats.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf("Still to clear · 1")).toBeLessThan(headings.indexOf("Ready · 1"));
  });

  it("keeps critical names readable and shared blockers on their group band", () => {
    const secondBlocked = entry("c", "Mina Patel");
    const thirdBlocked = entry("d", "Owen Reed");
    const roster = [blocked, secondBlocked, thirdBlocked];
    const readiness = new Map([
      ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
      ["c", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
      ["d", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
    ]) as ReadinessByBooking;
    const { container } = renderRoster({
      roster,
      readiness,
      waivers: new Map([
        ["a", signedWaiver],
        ["c", signedWaiver],
        ["d", signedWaiver],
      ]) as WaiverByBooking,
      compact: true,
    });

    expect(screen.getByRole("link", { name: "Asha Osei" })).toHaveClass(
      "text-base",
      "font-semibold",
    );
    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).not.toBeNull();
    expect(within(band as HTMLElement).getByText(/3 divers: No certification/)).toBeVisible();
    expect(container.querySelector("#roster > div.mt-5")).toBeNull();
  });

  it("offers no filter chips: the groups are the filter", () => {
    renderRoster(fixtures);

    expect(screen.queryByRole("navigation", { name: /filter/i })).toBeNull();
  });

  it("makes add diver the terminal ledger group, including on an empty roster", () => {
    const { container } = renderRoster({
      roster: [],
      readiness: new Map() as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      addDiverGroup: <p data-testid="add-diver-form">Find a returning diver</p>,
    });

    const addDiver = container.querySelector("#add-diver");
    expect(addDiver).not.toBeNull();
    expect(
      within(addDiver as HTMLElement).getByRole("heading", { name: "Add a diver" }),
    ).toBeVisible();
    expect(within(addDiver as HTMLElement).getByTestId("add-diver-form")).toBeVisible();
    expect(screen.queryByText("No one on this boat yet")).toBeNull();
  });
});
