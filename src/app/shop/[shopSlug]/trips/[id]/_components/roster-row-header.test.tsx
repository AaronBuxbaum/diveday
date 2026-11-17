// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rowHeader } from "./roster-row-header";
import { entry, readinessRow, seatFacts, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, WaiverByBooking } from "./types";

afterEach(cleanup);

/** `rowHeader` reads only the seat's own facts, so `seatFacts` is its whole input. */
describe("rowHeader, from the seat's facts alone", () => {
  it("links the name at the diver's record", () => {
    const seat = seatFacts(entry("h", "Rene Marsh"), {
      readiness: new Map([["h", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["h", signedWaiver]]) as WaiverByBooking,
    });
    render(rowHeader(seat).headerLeft);
    expect(screen.getByRole("link", { name: "Rene Marsh" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/p-h",
    );
  });

  it("draws the diver's photo, but never a held seat's matched record's", () => {
    const withPhoto = (held: boolean) => {
      const row = entry("h", "Rene Marsh");
      row.person = { ...row.person, staffPhotoPath: "/demo-staff/dana-reyes.webp" };
      if (held)
        row.booking = { ...row.booking, identityUnconfirmedAt: new Date() } as typeof row.booking;
      return seatFacts(row, {
        readiness: new Map([["h", readinessRow("ready")]]) as ReadinessByBooking,
        waivers: new Map([["h", signedWaiver]]) as WaiverByBooking,
      });
    };
    const open = render(rowHeader(withPhoto(false)).headerLeft);
    expect(open.container.querySelector("img")).not.toBeNull();
    cleanup();
    const held = render(rowHeader(withPhoto(true)).headerLeft);
    expect(held.container.querySelector("img")).toBeNull();
    expect(screen.getByText("RM")).toBeInTheDocument();
  });
});
