// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import type { TideStationEcho } from "@/lib/tide-stations";
import type { SiteFieldValues } from "./SiteFields";
import { SiteForecastFields } from "./SiteForecastFields";
import { FAR, NEAR, STORED } from "./site-fields-test-fixtures";

afterEach(cleanup);

const t = staffTranslator("en-US");

function renderFields(
  tideStation?: TideStationEcho | null,
  depthUnit: DepthUnit = "meters",
  locale: "en-US" | "es-ES" = "en-US",
  values?: SiteFieldValues,
  /** The edit page's caption over the specialty boxes; the new-site form passes none. */
  _requiredSpecialtiesLabel?: string,
) {
  const translator = locale === "en-US" ? t : staffTranslator(locale);
  render(
    <SiteForecastFields
      t={translator}
      depthUnit={depthUnit}
      tideStation={tideStation}
      values={values}
    />,
    // Inside a form, as both pages render it, so a test can read what the
    // form would submit.
    { container: document.body.appendChild(document.createElement("form")) },
  );
}

describe("SiteForecastFields — the tide station echo (issue #1468)", () => {
  it("says nothing when there is no station to say anything about", () => {
    renderFields(null);
    expect(screen.queryByText(/Carysfort/)).toBeNull();
    expect(screen.queryByText(/from this site’s coordinates/)).toBeNull();
  });

  it("names what the id NOAA answered for, and leaves a plausible station alone", () => {
    renderFields(NEAR);
    expect(screen.getByText("8723583 · Carysfort Reef, FL")).toBeInTheDocument();
    expect(screen.queryByText(/from this site’s coordinates/)).toBeNull();
  });

  /**
   * The distance is the evidence, never the whole sentence: a staffer reading
   * "81 km" has been told what a database noticed, and what they act on is
   * what that costs on the water. Eighty kilometres down the Keys moves the
   * predicted turn by the better part of an hour, on a number that is already
   * a height turn rather than slack.
   */
  it("prompts a second look at a station that sits implausibly far from the site", () => {
    renderFields(FAR);
    expect(screen.getByText("8723970 · Vaca Key, FL")).toBeInTheDocument();
    expect(
      screen.getByText(
        "That station is 81 km from this site’s coordinates, so the turn it predicts can reach this water up to an hour early or late. Check it’s the one you meant.",
      ),
    ).toBeInTheDocument();
  });

  it("reads miles to a shop that reads feet", () => {
    renderFields(FAR, "feet");
    expect(
      screen.getByText(
        "That station is 50 mi from this site’s coordinates, so the turn it predicts can reach this water up to an hour early or late. Check it’s the one you meant.",
      ),
    ).toBeInTheDocument();
  });

  /**
   * NOAA CO-OPS publishes US waters and nothing else, so a shop in Cozumel,
   * Bonaire or the Red Sea has no station to pick — and the one that types the
   * nearest US id is being asked to check something they cannot act on. The
   * field says where the list ends before the warning can accuse them of a
   * mistake, in both languages.
   */
  it("says the station list is US waters, in both bundles", () => {
    renderFields(null);
    expect(screen.getByText(/The list covers US waters only\./)).toBeInTheDocument();
    cleanup();
    renderFields(null, "meters", "es-ES");
    expect(screen.getByText(/La lista solo cubre aguas de Estados Unidos\./)).toBeInTheDocument();
  });

  it("carries the same consequence into Spanish", () => {
    renderFields(FAR, "meters", "es-ES");
    expect(
      screen.getByText(
        "Esa estación está a 81 km de las coordenadas de este sitio, así que el cambio de marea que predice puede llegar aquí hasta una hora antes o después. Verifica que es la que querías.",
      ),
    ).toBeInTheDocument();
  });

  /**
   * Advice, not a refusal: the id the staffer typed is still the field's value,
   * the control is not marked invalid, and the sentence is wired onto the input
   * so it is heard rather than only seen.
   */
  it("advises on the field without marking it invalid", () => {
    renderFields(FAR);
    const input = document.querySelector('input[name="tideStationId"]');
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    const describedBy = input?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toContain("Vaca Key");
  });
});

/**
 * **A prompt a shop can answer** — issue #1731.
 *
 * Flower Garden Banks reads Galveston at about 190 km and is right; no
 * threshold both spares that and catches the Key Largo reef reading Vaca Key,
 * so the instrument is a per-pairing acknowledgement rather than a bigger
 * number. What the box protects is the *next* warning: a sentence that is
 * always wrong is one a crew stops reading.
 */
describe("SiteForecastFields — answering the tide station prompt (issue #1731)", () => {
  const confirmedBox = () => document.querySelector('input[name="tideStationConfirmed"]');

  it("offers the box only where there is a question to answer", () => {
    renderFields(null, "meters", "en-US", STORED);
    expect(confirmedBox()).toBeNull();
    cleanup();
    // A station well inside the threshold asks nothing, so a tick box for it
    // would be furniture on a form that is already long.
    renderFields(NEAR, "meters", "en-US", STORED);
    expect(confirmedBox()).toBeNull();
    cleanup();
    renderFields(FAR, "meters", "en-US", STORED);
    expect(confirmedBox()).toBeInTheDocument();
    expect(screen.getByText("This is the right station for this site")).toBeInTheDocument();
  });

  it("stops the sentence once the shop has answered it, and keeps the station named", () => {
    renderFields(FAR, "meters", "en-US", { ...STORED, tideStationConfirmed: true });
    expect(screen.queryByText(/from this site’s coordinates/)).toBeNull();
    // The echo is not the warning: which place those seven digits name is
    // worth reading whether or not the distance has been accounted for.
    expect(screen.getByText("8723970 · Vaca Key, FL")).toBeInTheDocument();
  });

  /**
   * The box survives the answer. A checked box that vanished would leave the
   * shop no way to take the acknowledgement back, and the next staffer no way
   * to see that one had been given.
   */
  it("keeps the answered box on the page, ticked", () => {
    renderFields(FAR, "meters", "en-US", { ...STORED, tideStationConfirmed: true });
    expect(confirmedBox()).toBeChecked();
    cleanup();
    renderFields(FAR, "meters", "en-US", STORED);
    expect(confirmedBox()).not.toBeChecked();
  });

  it("asks and answers in Spanish too", () => {
    renderFields(FAR, "meters", "es-ES", STORED);
    expect(screen.getByText("Esta es la estación correcta para este sitio")).toBeInTheDocument();
    cleanup();
    renderFields(FAR, "meters", "es-ES", { ...STORED, tideStationConfirmed: true });
    expect(screen.queryByText(/de las coordenadas de este sitio/)).toBeNull();
  });

  /**
   * Still a prompt and never a refusal (ADR 20260907-noaa-tide-predictions'
   * 2026-09-10 amendment): an unanswered far pairing leaves the id the staffer
   * typed in the field and the control valid, exactly as it did before the box
   * existed.
   */
  it("does not turn the unanswered prompt into a refusal", () => {
    renderFields(FAR, "meters", "en-US", STORED);
    const input = document.querySelector('input[name="tideStationId"]');
    expect(input).toHaveValue("8723583");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(confirmedBox()).not.toBeRequired();
  });
});

/**
 * **"This is the right station" sits a field gap under the question it answers**
 * (docs/design/pixel-craft.md, class 4; K-424). It carried `mt-4` as a direct
 * item of the section's `gap-5` column, where a flex item's margin adds to the
 * gap: 36px under the warning against the section's 20px field gap, and nearer
 * the next section's rule than its own question.
 */
describe("SiteForecastFields — where the station confirmation sits (K-424)", () => {
  it("takes the section's own gap and no margin of its own", () => {
    renderFields(FAR, "meters", "en-US", STORED);
    const row = document.querySelector('input[name="tideStationConfirmed"]')?.closest("label");
    expect(row).not.toBeNull();
    expect(row?.className).not.toMatch(/(^|\s)m[ty]?-\d/);
  });
});
