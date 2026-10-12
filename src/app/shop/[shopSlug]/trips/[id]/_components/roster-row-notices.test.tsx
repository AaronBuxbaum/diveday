// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rowNotices } from "./roster-row-notices";
import { entry, readinessRow, seatFacts, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, WaiverByBooking } from "./types";

afterEach(cleanup);

const options = {
  readiness: new Map([["n", readinessRow("ready")]]) as ReadinessByBooking,
  waivers: new Map([["n", signedWaiver]]) as WaiverByBooking,
};

/** `rowNotices` reads only the seat's own facts, so `seatFacts` is its whole input. */
describe("rowNotices, from the seat's facts alone", () => {
  it("says a returning diver's own ask under the name", () => {
    const seat = seatFacts(entry("n", "Rene Marsh", { reEntryAsk: "easy_first_dive" }), options);
    const { container } = render(rowNotices(seat).reEntryNote);
    expect(container.textContent).not.toBe("");
  });

  it("leaves the ask to the desk's own band once arrivals open", () => {
    const seat = seatFacts(entry("n", "Rene Marsh", { reEntryAsk: "easy_first_dive" }), {
      ...options,
      arrival: { controls: new Map(), below: new Map(), boarded: new Set() },
    });
    const { container } = render(rowNotices(seat).reEntryNote);
    expect(container.textContent).toBe("");
  });

  it("has no medical doors for a seat whose release is signed", () => {
    const seat = seatFacts(entry("n", "Rene Marsh"), options);
    expect(rowNotices(seat).medicalActions).toBeNull();
  });
});
