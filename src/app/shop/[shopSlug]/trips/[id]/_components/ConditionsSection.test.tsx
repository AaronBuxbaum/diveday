// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
