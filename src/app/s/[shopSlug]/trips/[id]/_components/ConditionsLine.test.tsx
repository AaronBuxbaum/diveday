// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { ConditionsLine } from "./ConditionsLine";
import type { AutomatedForecast, Shop, Trip } from "./types";

/**
 * What a diver reads about the day, in one line above the form.
 *
 * Two completely different sources share it — the crew's own typed prediction
 * and the automated marine model — and the rules for what each may say are not
 * the same. The automated path in particular used to print the model's raw
 * output ("0.7 m seas from E · 7 s period"), which is a statistic about the
 * highest third of waves and a bearing nobody on a booking page asked for.
 *
 * The one thing that is not a design choice: **Open-Meteo's licence requires
 * attribution with its link**, so the credit survives verbatim on that path.
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

function renderAutomated(
  forecast: AutomatedForecast = automated(),
  crewLanguages: string | null = null,
) {
  return render(
    <ConditionsLine
      shop={shop}
      trip={{ waterTemperatureC: null } as Trip}
      crewPrediction={false}
      automatedForecast={forecast}
      crewLanguages={crewLanguages}
      locale={DEFAULT_DIVER_LOCALE}
    />,
  );
}

describe("ConditionsLine — the automated marine outlook", () => {
  it("reads the sea out instead of measuring it out", () => {
    renderAutomated();
    expect(screen.getByText("Light chop")).toBeInTheDocument();
    expect(screen.queryByText(/0\.7 m/)).not.toBeInTheDocument();
    expect(screen.queryByText(/7 s period/)).not.toBeInTheDocument();
  });

  it("reads the wind out as a diver reading rather than raw numbers", () => {
    renderAutomated(automated({ wind: { speedKnots: 18, gustsKnots: 24, direction: "e" } }));
    expect(screen.getByText("Breezy")).toBeInTheDocument();
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
    expect(screen.queryByText(/visibility/i)).not.toBeInTheDocument();
  });

  it("names who makes the call and credits the model, with its link", () => {
    renderAutomated();
    expect(screen.getByText(/final call at the dock/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open-Meteo" })).toHaveAttribute(
      "href",
      "https://open-meteo.com/",
    );
  });

  it("names the water temperature without the suit advice, which is prep", () => {
    // What to wear moved to the thread with `PackingSection` — it is
    // preparation, and preparation belongs to a diver who has a seat.
    renderAutomated();
    expect(screen.getByText("27°C water")).toBeInTheDocument();
    expect(screen.queryByText(/mm/)).not.toBeInTheDocument();
  });
});

describe("ConditionsLine — the crew's own prediction", () => {
  const trip = {
    conditionsSummary: "Calm morning, building after lunch.",
    waterTemperatureC: 26,
    visibilityMeters: 18,
    surfaceConditions: "gentle chop",
    conditionsUpdatedAt: new Date("2026-08-11T12:00:00Z"),
  } as Trip;

  function renderCrew() {
    return render(
      <ConditionsLine
        shop={shop}
        trip={trip}
        crewPrediction
        automatedForecast={null}
        crewLanguages={null}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
  }

  it("shows what the crew typed, word for word, and their visibility", () => {
    renderCrew();
    // Free text the crew wrote about their own reef: never translated, never
    // re-banded into one of the automated readings.
    expect(screen.getByText("gentle chop")).toBeInTheDocument();
    expect(screen.getByText("Calm morning, building after lunch.")).toBeInTheDocument();
    expect(screen.getByText("18 m visibility")).toBeInTheDocument();
  });

  it("carries no forecast credit — the reading is the shop's own", () => {
    renderCrew();
    expect(screen.queryByRole("link", { name: "Open-Meteo" })).not.toBeInTheDocument();
    expect(screen.getByText(/supplied by the crew/i)).toBeInTheDocument();
  });
});

describe("ConditionsLine — with no forecast at all", () => {
  it("still names the languages aboard, and nothing else", () => {
    render(
      <ConditionsLine
        shop={shop}
        trip={{} as Trip}
        crewPrediction={false}
        automatedForecast={null}
        crewLanguages="English and Spanish"
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(screen.getByText("English and Spanish aboard")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open-Meteo" })).not.toBeInTheDocument();
    expect(screen.queryByText(/water/)).not.toBeInTheDocument();
  });

  /**
   * **Flush under the pitch's door, its rule is the door's close** (pixel-craft
   * class 6). 24px below it, the door's label sat in an 80px band between two
   * rules, 29px under one and 51px over the other.
   */
  it("stands 24px below the page above it, or flush under the pitch's door", () => {
    const props = {
      shop,
      trip: { waterTemperatureC: null } as Trip,
      crewPrediction: false,
      automatedForecast: automated(),
      crewLanguages: null,
      locale: DEFAULT_DIVER_LOCALE,
    };
    const { container, rerender } = render(<ConditionsLine {...props} />);
    const section = () => container.querySelector("section");
    expect(section()).toHaveClass("mt-6", "border-t");
    rerender(<ConditionsLine {...props} underDoor />);
    expect(section()).toHaveClass("border-t");
    expect(section()).not.toHaveClass("mt-6");
  });

  it("renders nothing at all when there is neither a forecast nor a language", () => {
    const { container } = render(
      <ConditionsLine
        shop={shop}
        trip={{} as Trip}
        crewPrediction={false}
        automatedForecast={null}
        crewLanguages={null}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * **Whose water the tide line is** (issue #1732). The turn it names is a
 * height turn rather than slack (ADR 20260907's 2026-09-07 amendment), so the
 * station is what lets anyone who knows the water apply their own lag to it.
 * Until this the name reached one surface, the dive-site editor — the page the
 * shop that typed a wrong id never opens again.
 */
describe("ConditionsLine — whose tide", () => {
  const TIDE = "Next high water at 1:19 PM; the boat reaches the site on the flood.";

  function renderTide(station: string | null) {
    return render(
      <ConditionsLine
        shop={shop}
        trip={{} as Trip}
        crewPrediction={false}
        automatedForecast={null}
        crewLanguages={null}
        tideLines={[{ site: "Molasses Reef", text: TIDE, station }]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
  }

  it("names the station under the sentence it came from", () => {
    renderTide("Tide at Carysfort Reef, FL");
    expect(screen.getByText(TIDE, { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Tide at Carysfort Reef, FL")).toBeInTheDocument();
  });

  it("leaves the sentence exactly as it is when the lookup answered nothing", () => {
    renderTide(null);
    // The same string queried positively above, so this absence is about the
    // station and not about a line that stopped rendering.
    expect(screen.getByText(TIDE, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Carysfort/)).not.toBeInTheDocument();
  });
});
