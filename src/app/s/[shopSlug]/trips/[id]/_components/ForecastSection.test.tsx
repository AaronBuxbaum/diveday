// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { ForecastSection } from "./ForecastSection";
import type { AutomatedForecast, Shop, Trip } from "./types";

/**
 * What a diver actually reads off the conditions card.
 *
 * This block has two completely different sources behind one layout — the
 * crew's own typed prediction, and the automated marine model — and the rules
 * for what each may say are not the same. The automated path in particular
 * used to print the model's raw output ("0.7 m seas from E · 7 s period"), an
 * hour stamp for when that reading was valid, and a line explaining that
 * underwater visibility comes from the crew, which is a sentence about an
 * absence on a card that has no visibility to show.
 */

afterEach(() => {
  cleanup();
});

const shop = { timezone: "America/New_York", depthUnit: "meters" } as Shop;

function automated(overrides: Partial<NonNullable<AutomatedForecast>> = {}): AutomatedForecast {
  return {
    waterTemperatureC: 27,
    surface: { waveHeightMeters: 0.7, waveDirection: "e", wavePeriodSeconds: 7 },
    wind: null,
    current: null,
    sun: null,
    source: "Open-Meteo marine forecast",
    validAt: new Date("2026-08-11T15:00:00Z"),
    ...overrides,
  };
}

function renderAutomated(forecast: AutomatedForecast = automated()) {
  render(
    <ForecastSection
      shop={shop}
      trip={{ waterTemperatureC: null } as Trip}
      crewPrediction={false}
      automatedForecast={forecast}
      locale={DEFAULT_DIVER_LOCALE}
    />,
  );
}

describe("ForecastSection — the automated marine outlook", () => {
  it("reads the sea out instead of measuring it out", () => {
    renderAutomated();

    // The band, plus what it means for the day. A diver deciding whether to
    // bring a seasickness tablet cannot do anything with a significant wave
    // height, a bearing, or a period in seconds.
    expect(screen.getByText("Light chop")).toBeInTheDocument();
    expect(screen.getByText(/small waves/i)).toBeInTheDocument();
    expect(screen.queryByText(/0\.7 m/)).not.toBeInTheDocument();
    expect(screen.queryByText(/7 s period/)).not.toBeInTheDocument();
  });

  it("reads the wind out as a diver reading rather than raw numbers", () => {
    renderAutomated(
      automated({
        wind: { speedKnots: 18, gustsKnots: 24, direction: "e" },
      }),
    );

    expect(screen.getByText("Breezy")).toBeInTheDocument();
    expect(screen.getByText(/breezy morning/i)).toBeInTheDocument();
    expect(screen.queryByText(/18 kt/)).not.toBeInTheDocument();
  });

  it("reads the same height differently once the period changes it", () => {
    renderAutomated(
      automated({ surface: { waveHeightMeters: 0.7, waveDirection: "e", wavePeriodSeconds: 4 } }),
    );
    expect(screen.getByText("Choppy")).toBeInTheDocument();
  });

  it("says nothing about visibility, which this source does not have", () => {
    renderAutomated();
    // The marine model publishes no underwater visibility, so there is no tile
    // — and a line explaining that absence is the absence formatted as
    // information (docs/design/principles.md #9).
    expect(screen.queryByText("Visibility")).not.toBeInTheDocument();
    expect(screen.queryByText(/visibility comes from the crew/i)).not.toBeInTheDocument();
  });

  it("names who makes the call and credits the model, with no hour stamp", () => {
    renderAutomated();
    expect(screen.getByText(/final call at the dock/i)).toBeInTheDocument();
    // Open-Meteo's licence requires attribution *with a link*, so the credit
    // survives — as fine print, not as the paragraph that used to lead the card.
    expect(screen.getByRole("link", { name: "Open-Meteo" })).toHaveAttribute(
      "href",
      "https://open-meteo.com/",
    );
    expect(screen.queryByText(/^For /)).not.toBeInTheDocument();
  });

  it("says what the water temperature means for what to wear", () => {
    // A reading is a number a diver has to translate before it is any use,
    // and the translation is the reason they opened the card. It rides under
    // the temperature itself, on both sources — the automated model supplies a
    // water temperature on plenty of departures no crew has looked at yet.
    renderAutomated();
    expect(screen.getByText("27°C")).toBeInTheDocument();
    expect(screen.getByText(/3 mm shorty or full suit/i)).toBeInTheDocument();
  });

  it("names a thicker suit as the water gets colder", () => {
    renderAutomated(automated({ waterTemperatureC: 19 }));
    expect(screen.getByText(/7 mm full suit/i)).toBeInTheDocument();
    expect(screen.getByText(/hood and gloves/i)).toBeInTheDocument();
  });

  it("keeps its counsel when no source has a temperature", () => {
    renderAutomated(automated({ waterTemperatureC: null }));
    expect(screen.queryByText(/mm/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when there is neither source", () => {
    const { container } = render(
      <ForecastSection
        shop={shop}
        trip={{} as Trip}
        crewPrediction={false}
        automatedForecast={null}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ForecastSection — the crew's own prediction", () => {
  const trip = {
    conditionsSummary: "Calm morning, building after lunch.",
    waterTemperatureC: 26,
    visibilityMeters: 18,
    surfaceConditions: "gentle chop",
    conditionsUpdatedAt: new Date("2026-08-11T12:00:00Z"),
  } as Trip;

  it("shows what the crew typed, word for word, and their visibility", () => {
    render(
      <ForecastSection
        shop={shop}
        trip={trip}
        crewPrediction
        automatedForecast={null}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );

    // Free text the crew wrote about their own reef: never translated, never
    // re-banded into one of the automated readings.
    expect(screen.getByText("gentle chop")).toBeInTheDocument();
    expect(screen.getByText("Calm morning, building after lunch.")).toBeInTheDocument();
    expect(screen.getByText("18 m")).toBeInTheDocument();
    // No band detail underneath: the crew already said it in their own words.
    expect(screen.queryByText(/small waves/i)).not.toBeInTheDocument();
  });
});
