// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { INSET_NOTE_CLASS } from "@/components/ui/card";
import type { AutomatedMarineForecast } from "@/lib/marine-forecast";
import { ConditionsSection } from "./ConditionsSection";
import type { Trip } from "./types";

afterEach(cleanup);

const noop = () => {};

/** Only the conditions fields this section reads off the departure. */
const tripRow = (crewPrediction: Partial<Trip> = {}) =>
  ({
    id: "trip-1",
    conditionsHold: false,
    conditionsSummary: null,
    conditionsUpdatedAt: null,
    waterTemperatureC: null,
    visibilityMeters: null,
    surfaceConditions: null,
    ...crewPrediction,
  }) as unknown as Trip;

const forecast = (parts: Partial<AutomatedMarineForecast> = {}): AutomatedMarineForecast => ({
  waterTemperatureC: 27,
  surface: { waveHeightMeters: 0.6, waveDirection: "se", wavePeriodSeconds: 5 },
  wind: null,
  current: null,
  sun: null,
  source: "Open-Meteo marine forecast",
  validAt: new Date("2026-08-27T12:00:00Z"),
  ...parts,
});

function renderSection(trip: Trip, automatedForecast: AutomatedMarineForecast | null) {
  render(
    <ConditionsSection
      saveAction={noop}
      clearAction={noop}
      trip={trip}
      locale="en-US"
      timezone="America/New_York"
      temperatureUnit="celsius"
      depthUnit="meters"
      automatedForecast={automatedForecast}
    />,
  );
}

/**
 * **The model's read is what the crew's own prediction is written against**, so
 * it has to be legible in both states.
 *
 * The block used to render only when the forecast carried wind, current or sun,
 * and to say only those three — so the two readings the crew themselves record,
 * water temperature and the sea surface, were the two the model never showed
 * them. A forecast answering with nothing else rendered no block at all.
 */
describe("ConditionsSection — the automated outlook", () => {
  it("shows the water temperature and the seas with no crew prediction published", () => {
    renderSection(tripRow(), forecast());

    expect(screen.getByText("Automated outlook")).toBeInTheDocument();
    expect(screen.getByText("Water 27 °C")).toBeInTheDocument();
    // Significant wave height as the model publishes it, in the shop's unit —
    // a captain reads the number; the diver-facing page gets the band.
    expect(screen.getByText("Seas 0.6 m SE")).toBeInTheDocument();
  });

  it("still shows it once the crew have published their own read", () => {
    renderSection(tripRow({ waterTemperatureC: 24, surfaceConditions: "Choppy after lunch" }), {
      ...forecast(),
    });

    // The crew's own figures lead...
    expect(screen.getByText(/24 °C/)).toBeInTheDocument();
    // ...and the model's stay beside them, which is the only way to compare.
    expect(screen.getByText("Water 27 °C")).toBeInTheDocument();
    expect(screen.getByText("Seas 0.6 m SE")).toBeInTheDocument();
  });

  it("renders nothing when the model answered with nothing", () => {
    renderSection(tripRow(), forecast({ waterTemperatureC: null, surface: null }));

    expect(screen.queryByText("Automated outlook")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no forecast at all", () => {
    renderSection(tripRow(), null);

    expect(screen.queryByText("Automated outlook")).not.toBeInTheDocument();
  });

  /**
   * **The outlook is the departure's inset note** (pixel-craft class 12): it
   * was 12px all round at 12px type where every other note on the trip is
   * `px-3 py-2` at 14px. The heading line keeps the foreground ink.
   */
  it("sits in the note every departure panel draws", () => {
    renderSection(tripRow(), forecast());

    const heading = screen.getByText("Automated outlook");
    expect(heading).toHaveClass("text-foreground");
    expect(heading.parentElement).toHaveClass(...INSET_NOTE_CLASS.split(" "));
    expect(heading.parentElement).not.toHaveClass("p-3", "text-xs");
  });
});

/**
 * **Whose water the tide line is** (issue #1732). The turn it names is a
 * height turn rather than slack (ADR 20260907's 2026-09-07 amendment), so a
 * captain who knows the water applies their own site lag to it — and cannot
 * without knowing the station. Until this the name reached one surface, the
 * dive-site editor, which is the page the shop that typed a wrong id never
 * opens again.
 */
describe("ConditionsSection — whose tide", () => {
  const TIDE = "Next high water at 1:19 PM; this departure reaches the site on the flood.";

  function renderTide(station: string | null) {
    render(
      <ConditionsSection
        saveAction={noop}
        clearAction={noop}
        trip={tripRow()}
        locale="en-US"
        timezone="America/New_York"
        temperatureUnit="celsius"
        depthUnit="meters"
        automatedForecast={null}
        tideLines={[{ site: "Molasses Reef", text: TIDE, station }]}
      />,
    );
  }

  it("names the station under the site's own sentence", () => {
    renderTide("Tide at Carysfort Reef, FL");

    expect(screen.getByText("Molasses Reef")).toBeInTheDocument();
    expect(screen.getByText(TIDE, { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Tide at Carysfort Reef, FL")).toBeInTheDocument();
  });

  it("leaves the sentence exactly as it is when the lookup answered nothing", () => {
    renderTide(null);

    // The same strings queried positively above, so this absence is about the
    // station and not about a line that stopped rendering.
    expect(screen.getByText("Molasses Reef")).toBeInTheDocument();
    expect(screen.getByText(TIDE, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Carysfort/)).not.toBeInTheDocument();
  });
});
