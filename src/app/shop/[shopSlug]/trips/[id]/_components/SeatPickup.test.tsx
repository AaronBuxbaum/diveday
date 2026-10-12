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

  it("offers no form to a reader with no way to save one", () => {
    render(<SeatPickup booking={booking({ pickupTime: "07:15" })} t={t} />);
    expect(screen.getByText(`${t("trips.roster.hotelNotSpecified")} · 07:15`)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
