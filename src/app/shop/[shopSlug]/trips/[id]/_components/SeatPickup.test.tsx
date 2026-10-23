// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { entry } from "./roster-test-fixtures";
import { SeatPickup } from "./SeatPickup";
import type { RosterEntry } from "./types";

afterEach(cleanup);

const t = staffTranslator("en-US");

function booking(over: Partial<RosterEntry["booking"]> = {}) {
  return { ...entry("a", "Asha Osei").booking, ...over } as RosterEntry["booking"];
}

describe("SeatPickup", () => {
  it("states the hotel and time, and offers to edit them", () => {
    render(
      <SeatPickup
        booking={booking({ hotelPickupLocation: "Harbor Inn", pickupTime: "07:15" })}
        t={t}
        updatePickupAction={() => {}}
      />,
    );
    expect(screen.getByText("Harbor Inn · 07:15")).toBeTruthy();
    expect(screen.getByText(t("trips.roster.editPickup"))).toBeTruthy();
  });

  it("says no pickup is scheduled, and offers to set one", () => {
    render(<SeatPickup booking={booking()} t={t} updatePickupAction={() => {}} />);
    expect(screen.getByText(t("trips.roster.noPickupScheduled"))).toBeTruthy();
    expect(screen.getByText(t("trips.roster.setPickup"))).toBeTruthy();
  });

  // Hotel pickups switched off (the Features page): the roster passes no
  // action, and the seat says nothing about pickups, even one already set.
  it("draws nothing while the shop does not offer hotel pickups", () => {
    const { container } = render(<SeatPickup booking={booking({ pickupTime: "07:15" })} t={t} />);
    expect(container.innerHTML).toBe("");
  });
});
