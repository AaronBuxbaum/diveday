// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { PackingSection } from "./PackingSection";
import type { Shop, Trip } from "./types";

/**
 * Where the "what to wear" line lands, which is not the same place on both
 * pages that render this section.
 *
 * The booking page puts a conditions card above it (`ForecastSection`) and says
 * it there, under the reading it comes from. `/ready/[token]` renders no
 * conditions card anywhere — it is a rental-fit and paperwork page — so if this
 * section stays quiet there, the page a diver reads the *morning they sail*
 * says nothing at all about the water they are getting into. A visual
 * regression caught exactly that.
 */

afterEach(cleanup);

const shop = {
  timezone: "America/New_York",
  packingList: ["Swimsuit and towel"],
  briefingMinutes: 15,
  temperatureUnit: "celsius",
  dockCallMinutes: 30,
  surfaceIntervalMinutes: 60,
  bottomTimeMinutes: 45,
} as unknown as Shop;

function renderPacking(overrides: { waterTemperatureC: number | null; statedAbove: boolean }) {
  const trip = {
    startsAt: new Date("2026-08-12T12:00:00Z"),
    endsAt: new Date("2026-08-12T16:00:00Z"),
    plannedDives: 2,
    waterTemperatureC: overrides.waterTemperatureC,
  } as Trip;
  return render(
    <PackingSection
      shop={shop}
      trip={trip}
      multiDay={false}
      temperatureStatedAbove={overrides.statedAbove}
      locale={DEFAULT_DIVER_LOCALE}
    />,
  );
}

describe("PackingSection — the exposure-suit line", () => {
  it("names the suit when no conditions card above it has", () => {
    // The `/ready/[token]` case: no card on the page, so this is the only
    // chance a diver gets to be told what to bring for 19°C water.
    renderPacking({ waterTemperatureC: 19, statedAbove: false });
    expect(screen.getByText(/7 mm full suit/i)).toBeInTheDocument();
  });

  it("stays quiet when the card above already said it", () => {
    // The booking page case. Saying it twice on one page is the duplication
    // the old "use the shop's wetsuit guidance" line was guilty of.
    renderPacking({ waterTemperatureC: 19, statedAbove: true });
    expect(screen.queryByText(/mm/)).not.toBeInTheDocument();
  });

  it("says nothing when nobody has recorded a temperature", () => {
    renderPacking({ waterTemperatureC: null, statedAbove: false });
    expect(screen.queryByText(/mm/)).not.toBeInTheDocument();
    // …but the rest of the packing list is untouched, so a silent suit line is
    // not a section that failed to render.
    expect(screen.getByText("Swimsuit and towel")).toBeInTheDocument();
  });
});

/**
 * Issue #704 slice 2. Renders on both pages `PackingSection` is shared
 * between — the booking page and `/ready/[token]` — since neither has any
 * other section that reads a departure's own meeting point.
 */
describe("PackingSection — the dock-day rhythm's meeting point", () => {
  function renderRhythm(overrides: {
    meetingPointLabel: string | null;
    meetingPointAddress: string | null;
  }) {
    const trip = {
      startsAt: new Date("2026-08-12T12:00:00Z"),
      endsAt: new Date("2026-08-12T16:00:00Z"),
      plannedDives: 2,
      waterTemperatureC: null,
      course: null,
      diveMode: "boat",
      meetingPointLabel: overrides.meetingPointLabel,
      meetingPointAddress: overrides.meetingPointAddress,
    } as unknown as Trip;
    return render(
      <PackingSection
        shop={shop}
        trip={trip}
        multiDay={false}
        temperatureStatedAbove={false}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
  }

  it("names the meeting point beside the arrival line, with its address", () => {
    renderRhythm({ meetingPointLabel: "North Jetty Marina", meetingPointAddress: "12 Dock Rd" });
    expect(screen.getByText(/North Jetty Marina/)).toBeInTheDocument();
    expect(screen.getByText(/12 Dock Rd/)).toBeInTheDocument();
  });

  it("names the meeting point alone when no address is on file", () => {
    renderRhythm({ meetingPointLabel: "North Jetty Marina", meetingPointAddress: null });
    expect(screen.getByText("North Jetty Marina")).toBeInTheDocument();
  });

  it("says nothing extra when the departure has no meeting point of its own", () => {
    renderRhythm({ meetingPointLabel: null, meetingPointAddress: null });
    expect(screen.queryByText(/North Jetty/)).not.toBeInTheDocument();
  });
});
