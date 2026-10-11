// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { entry, readinessRow, renderRoster, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, WaiverByBooking } from "./types";

afterEach(cleanup);

/**
 * **The fare stands, so the package is said first** (H-79, issue #1697). A
 * fare taken at the desk is never unwound for a package, so the payment
 * control names the diver's unused dives while there is still money to take.
 */
describe("unused package dives on the payment control", () => {
  const renderSeat = (
    paymentStatus: "unpaid" | "paid",
    options: { held?: boolean; dives?: number } = {},
  ) => {
    const seat = entry("k", "Rosa Regular");
    if (options.held) {
      (seat.booking as { identityUnconfirmedAt: Date | null }).identityUnconfirmedAt = new Date(
        "2026-10-01T12:00:00Z",
      );
    }
    return renderRoster({
      roster: [seat],
      readiness: new Map([
        ["k", { ...readinessRow("ready"), paymentStatus }],
      ]) as ReadinessByBooking,
      waivers: new Map([["k", signedWaiver]]) as WaiverByBooking,
      requiresPayment: true,
      packageDivesByBooking: new Map(options.dives === 0 ? [] : [["k", options.dives ?? 4]]),
    });
  };

  it("names the count beside an unpaid seat", () => {
    renderSeat("unpaid");
    expect(screen.getByTestId("payment-package-note")).toHaveTextContent(
      "Has 4 unused package dives for this trip",
    );
  });

  it("says nothing once the seat is paid: that fare stands", () => {
    renderSeat("paid");
    expect(screen.queryByTestId("payment-package-note")).toBeNull();
  });

  it("says nothing for a diver with no dives this trip could take", () => {
    renderSeat("unpaid", { dives: 0 });
    expect(screen.queryByTestId("payment-package-note")).toBeNull();
  });

  it("on a held seat, sends the desk to the identity question first and names no count", () => {
    renderSeat("unpaid", { held: true });
    const note = screen.getByTestId("payment-package-note");
    expect(note).toHaveTextContent(
      "Rosa Regular has unused package dives. Confirm who this is before taking payment.",
    );
    expect(note).not.toHaveTextContent(/\d/);
  });
});
