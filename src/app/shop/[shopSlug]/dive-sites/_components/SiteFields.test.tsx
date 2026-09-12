// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import type { TideStationEcho } from "@/lib/tide-stations";
import { routeEditorCopy } from "./route-editor-copy";
import { SiteFields } from "./SiteFields";
import { fieldGuideEditorCopy, landmarkEditorCopy } from "./site-editor-copy";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** Carysfort Reef beside Molasses Reef: the pairing a Key Largo shop actually wants. */
const NEAR: TideStationEcho = {
  id: "8723583",
  name: "Carysfort Reef",
  state: "FL",
  latitude: 25.2217,
  longitude: -80.2117,
  distanceKm: 28.6,
  far: false,
};

/** Vaca Key at Marathon on the same reef: seven digits, answers, eighty kilometres off. */
const FAR: TideStationEcho = {
  id: "8723970",
  name: "Vaca Key",
  state: "FL",
  latitude: 24.7113,
  longitude: -81.1065,
  distanceKm: 80.9,
  far: true,
};

function renderFields(
  tideStation?: TideStationEcho | null,
  depthUnit: DepthUnit = "meters",
  locale: "en-US" | "es-ES" = "en-US",
) {
  const translator = locale === "en-US" ? t : staffTranslator(locale);
  render(
    <SiteFields
      t={translator}
      depthUnit={depthUnit}
      tideStation={tideStation}
      certificationDescription="Who can dive this site."
      routeCopy={routeEditorCopy(translator)}
      landmarkCopy={landmarkEditorCopy(translator)}
      fieldGuideCopy={fieldGuideEditorCopy(translator)}
      marineLifeCatalog={[]}
      locale={locale}
      timezone="America/New_York"
    />,
  );
}

describe("SiteFields — the tide station echo (issue #1468)", () => {
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
        "Esa estación está a 81 km de las coordenadas de este sitio, así que el cambio de marea que predice puede llegar aquí hasta una hora antes o después. Comprueba que es la que querías.",
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
