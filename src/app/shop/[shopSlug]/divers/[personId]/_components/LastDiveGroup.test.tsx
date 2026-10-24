// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LastKnownDive } from "@/db/last-dive";
import { staffTranslator } from "@/i18n/staff-messages";
import { LastDiveGroup, monthsSince, newerSaid } from "./LastDiveGroup";
import type { DiverProfile } from "./shared";

vi.mock("../last-dive-actions", () => ({ saveLastDiveAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
const day = (date: Date) => date.toISOString().slice(0, 10);

function seat(startsAt: string, band: string | null, status = "booked", held = false) {
  return {
    booking: { lastDivedBand: band, status, identityUnconfirmedAt: held ? new Date() : null },
    trip: { startsAt: new Date(startsAt) },
  };
}

function diver(bookings: ReturnType<typeof seat>[] = []) {
  return { person: { id: "p1" }, bookings } as unknown as DiverProfile;
}

function known(overrides: Partial<LastKnownDive> = {}): LastKnownDive {
  return {
    on: null,
    source: null,
    recorded: null,
    withShop: null,
    imported: null,
    ...overrides,
  };
}

function renderGroup(profile: DiverProfile, lastDive: LastKnownDive) {
  return render(
    <LastDiveGroup
      diver={profile}
      known={lastDive}
      shopSlug="blue-mantis"
      personId="p1"
      today="2026-10-23"
      timezoneDay={day}
      locale="en-US"
      t={t}
      removed={false}
    />,
  );
}

describe("monthsSince", () => {
  it("counts whole months, and never below zero", () => {
    expect(monthsSince("2026-10-01", "2026-10-23")).toBe(0);
    expect(monthsSince("2026-09-23", "2026-10-23")).toBe(1);
    expect(monthsSince("2026-09-24", "2026-10-23")).toBe(0);
    expect(monthsSince("2024-03-14", "2026-10-23")).toBe(31);
    expect(monthsSince("2026-11-01", "2026-10-23")).toBe(0);
  });
});

describe("newerSaid", () => {
  it("shows the diver's band only when it was given for a trip after the known day", () => {
    const profile = diver([
      seat("2026-10-20T13:00:00Z", "this_season"),
      seat("2026-06-01T13:00:00Z", "within_a_year"),
    ]);
    expect(newerSaid(profile, "2024-03-14", day)).toEqual({
      band: "this_season",
      day: "2026-10-20",
    });
    expect(newerSaid(profile, "2026-10-20", day)).toBeNull();
    expect(newerSaid(profile, null, day)?.band).toBe("this_season");
  });

  it("ignores a cancelled seat's answer, a held seat's, and a seat with none", () => {
    const profile = diver([
      seat("2026-10-20T13:00:00Z", "never", "cancelled"),
      seat("2026-10-22T13:00:00Z", "this_season", "booked", true),
      seat("2026-10-21T13:00:00Z", null),
    ]);
    expect(newerSaid(profile, null, day)).toBeNull();
  });
});

describe("the Last dive row", () => {
  it("puts the date and how long ago on the closed row", () => {
    renderGroup(diver(), known({ on: "2024-03-14", source: "recorded", recorded: "2024-03-14" }));
    expect(screen.getByText("Mar 14, 2024 · 2 years ago")).toBeInTheDocument();
    expect(screen.getByText("Mar 14, 2024 · 2 years ago").className).not.toMatch(/warning/);
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("wears warning ink at five years and more, and gates nothing", () => {
    renderGroup(diver(), known({ on: "2020-06-01", source: "recorded", recorded: "2020-06-01" }));
    expect(screen.getByText("Jun 1, 2020 · 6 years ago").className).toMatch(/warning/);
  });

  it("says Not known, and offers no Clear for a date nobody recorded", () => {
    renderGroup(diver(), known());
    expect(screen.getByText("None on file")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("says where a date from the shop's own trips came from, and the newer band beside it", () => {
    renderGroup(
      diver([seat("2026-10-20T13:00:00Z", "this_season")]),
      known({ on: "2026-08-02", source: "with_shop", withShop: "2026-08-02" }),
    );
    expect(screen.getByText("Aug 2, 2026 · 2 months ago")).toBeInTheDocument();
    expect(screen.getByText("Their last dive with you.")).toBeInTheDocument();
    expect(
      screen.getByText("For their Oct 20, 2026 trip: Last dived this season — unverified"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Last dive anywhere")).toHaveValue("2026-08-02");
  });
});
