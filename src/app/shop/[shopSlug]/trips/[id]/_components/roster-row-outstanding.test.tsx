// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rowOutstanding } from "./roster-row-outstanding";
import { entry, readinessRow, renderRoster, seatFacts, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, WaiverByBooking } from "./types";

afterEach(cleanup);

/**
 * **The fare stands, so the package is said first** (H-20260916-unconfirmed-identity-withhold-cost, issue #1697). A
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

/**
 * `rowOutstanding` reads the seat's facts, two lines `rowIdentity` drew and the
 * desk-private lines `rowReasonList` set aside; the test hands it those three
 * instead of running the builders before it.
 */
describe("rowOutstanding, from the seat's facts and three drawn parts", () => {
  const drawn = { identityContact: null, packageNote: null, deskPrivateLines: [] };
  const signed = new Map([["o", signedWaiver]]) as WaiverByBooking;

  it("has no work for a ready seat on a trip that takes no payment", () => {
    const seat = seatFacts(entry("o", "Rene Marsh"), {
      readiness: new Map([["o", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: signed,
    });
    expect(rowOutstanding({ ...seat, ...drawn }).hasWork).toBe(false);
  });

  it("keeps the party waiver entry on a fully signed seat", () => {
    const seat = seatFacts(entry("o", "Rene Marsh"), {
      readiness: new Map([["o", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: signed,
    });
    expect(rowOutstanding({ ...seat, ...drawn, partyLeadId: "lead" }).hasWork).toBe(true);
  });

  it("has work once the trip takes payment, so the control stays put either way", () => {
    const seat = seatFacts(entry("o", "Rene Marsh"), {
      readiness: new Map([["o", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: signed,
      requiresPayment: true,
    });
    expect(rowOutstanding({ ...seat, ...drawn }).hasWork).toBe(true);
  });

  it("has work when the desk set a line aside", () => {
    const seat = seatFacts(entry("o", "Rene Marsh"), {
      readiness: new Map([["o", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: signed,
    });
    const deskPrivateLines = [{ key: "recency", text: "Last dived long ago", tone: "warning" }];
    expect(
      rowOutstanding({ ...seat, ...drawn, deskPrivateLines } as Parameters<
        typeof rowOutstanding
      >[0]).hasWork,
    ).toBe(true);
  });
});
