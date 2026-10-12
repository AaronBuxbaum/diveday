// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rowReference } from "./roster-row-reference";
import { entry, readinessRow, seatFacts, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, WaiverByBooking } from "./types";

afterEach(cleanup);

/**
 * `rowReference` reads the seat's facts and one block `rowNotices` drew, so the
 * test hands it that block as a marker instead of running the builders before it.
 */
describe("rowReference, from the seat's facts and one drawn block", () => {
  const options = {
    readiness: new Map([["r", readinessRow("ready")]]) as ReadinessByBooking,
    waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
  };
  const block = <p data-testid="emergency-block">Emergency contact</p>;

  it("files the emergency-contact block among the seat's reference facts", () => {
    const seat = seatFacts(entry("r", "Rene Marsh"), options);
    render(<>{rowReference({ ...seat, emergencyContactBlock: block }).reference}</>);
    expect(screen.getByTestId("emergency-block")).toBeInTheDocument();
  });

  /** A held seat's details are the matched person's, so the block is withheld. */
  it("withholds it on a seat whose identity is not yet confirmed", () => {
    const held = entry("r", "Rene Marsh");
    (held.booking as { identityUnconfirmedAt: Date | null }).identityUnconfirmedAt = new Date(
      "2026-10-01T12:00:00Z",
    );
    const seat = seatFacts(held, options);
    render(<>{rowReference({ ...seat, emergencyContactBlock: block }).reference}</>);
    expect(screen.queryByTestId("emergency-block")).toBeNull();
  });
});
