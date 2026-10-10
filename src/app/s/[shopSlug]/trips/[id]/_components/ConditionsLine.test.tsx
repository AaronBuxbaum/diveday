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

/**
 * **A wrap never strands a "·"** (pixel-craft class 8, K-483). Each dot was a
 * flex item of its own, so a line could end on it: "…18 m visibility ·" over
 * "Glassy" at 390. Each reading now carries the dot before it in one item, so
 * the two wrap together, and the row stands the dot and its gap (12px) left of
 * the column inside a line that clips there: the dot that starts a line — the
 * first reading's, and any a wrap moves to the front — is cut, and every other
 * sits between two readings as it did.
 */
describe("ConditionsLine — the separators", () => {
  it("keeps each dot with the reading after it, and clips the one that starts a line", () => {
    renderAutomated();
    const item = screen.getByText("Light chop").parentElement;
    expect(item).toHaveClass("inline-flex", "gap-x-2");
    const row = item?.parentElement;
    expect(row).toHaveClass("flex", "flex-wrap", "gap-x-2", "-ms-3");
    expect(row?.parentElement).toHaveClass("overflow-x-clip");
    expect(row?.children).toHaveLength(2);
    for (const reading of row?.children ?? []) {
      // The dot is a sibling of the reading, never inside it, and a 4px box:
      // with the 8px gap, exactly the row's 12px shift.
      const [dot, words] = [...reading.children];
      expect(dot).toHaveTextContent("·");
      expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(dot).toHaveClass("w-1");
      expect(words).not.toHaveTextContent("·");
    }
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
   * **The page sets its distance, the line opens on its rule** (pixel-craft
   * class 4, K-162). The trip page's `space-y-10` stands it a section below
   * what precedes it, and puts it flush under the pitch's door, where its rule
   * is the door's close (class 6). It carried its own `mt-6`, 24px where the
   * page's other sections stood 32 and 40.
   */
  it("opens on its rule and carries no margin of its own", () => {
    const { container } = renderAutomated();
    const section = container.querySelector("section");
    expect(section).toHaveClass("border-t", "pt-4");
    expect([...(section?.classList ?? [])].filter((token) => /^-?m[ty]?-/.test(token))).toEqual([]);
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
 * **The outlook never holds the page** (code review 2026-10-10, item 1). The
 * page hands over the provider call still in flight; until it answers, the line
 * shows what it already knows — here, the languages aboard — and no credit for
 * a forecast that has not arrived.
 */
describe("ConditionsLine — a forecast still on its way", () => {
  it("holds the languages line inside a Suspense boundary until the outlook answers", () => {
    const element = ConditionsLine({
      shop,
      trip: { waterTemperatureC: null } as Trip,
      crewPrediction: false,
      automatedForecast: new Promise<AutomatedForecast>(() => {}),
      crewLanguages: "English and Spanish",
      locale: DEFAULT_DIVER_LOCALE,
    });

    render(<>{element.props.fallback}</>);
    expect(screen.getByText(/English and Spanish/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open-Meteo" })).not.toBeInTheDocument();
  });
});
