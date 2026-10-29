import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { SafetyMonth } from "@/lib/safety-report";
import { safetyMonthTiles } from "./safety-month-tiles";

const t = staffTranslator("en-US");
const safetyCopyByLocale = [
  {
    locale: "en-US" as const,
    crewLabel: "Crew with credentials that lapsed before the departure’s final local day",
    title: "Crew with credentials that lapsed before the departure’s final local day",
    observation:
      "Credential type and dates are recorded at the live boarding mark; DiveDay review status and issuer confirmation are not recorded. Actual departure time and role fit are not recorded.",
  },
  {
    locale: "es-ES" as const,
    crewLabel: "Tripulantes con credenciales vencidas antes del último día local de la salida",
    title: "Tripulantes con credenciales vencidas antes del último día local de la salida",
    observation:
      "En el registro de embarque se guardan el tipo de credencial y sus fechas; no constan la revisión de DiveDay ni la confirmación del emisor. Tampoco constan la hora real de salida ni la función.",
  },
];

/** A month back from the water, with the crew facts each case sets. */
function month(crew: Partial<SafetyMonth>): SafetyMonth {
  return {
    rollCallsClosed: 3,
    departuresBack: 3,
    unmarkedAtDock: 0,
    certOverrides: 0,
    crewSailings: 0,
    checkedSailings: 0,
    unrecordedSailings: 0,
    lapsedSailings: [],
    unrecordedCrew: [],
    noCrewDepartures: [],
    noCrewOnRecord: false,
    ...crew,
  } as unknown as SafetyMonth;
}

function crewTile(
  safety: SafetyMonth,
  staffingHref: string | null = "/shop/blue-mantis/staffing",
  translator: typeof t = t,
) {
  const tile = safetyMonthTiles({
    t: translator,
    safety,
    filed: 0,
    drafts: 0,
    activityHref: "/shop/blue-mantis/settings/activity",
    staffingHref,
    teamHref: "/shop/blue-mantis/settings/team",
  }).find((figure) => figure.key === "crew");
  if (!tile) throw new Error("no crew tile");
  return tile;
}

/**
 * **A month with no crew on record judged nothing** (layer 3 review F3): a
 * shop that does not roster crew here reads one quiet line and a door to the
 * crew schedule, never "0 of 0" over a list the page does not draw.
 */
describe("the month's crew tile", () => {
  it.each(safetyCopyByLocale)(
    "uses the departure's final local day in $locale",
    ({ locale, crewLabel, title }) => {
      const translator = staffTranslator(locale as "en-US" | "es-ES");
      expect(translator("incidents.safety.crew")).toBe(crewLabel);
      expect(translator("incidents.safety.lapsedTitle")).toBe(title);
    },
  );

  it.each(safetyCopyByLocale)(
    "makes the limits of captured card data explicit in $locale",
    ({ locale, observation }) => {
      const translator = staffTranslator(locale);
      const tile = crewTile(
        month({ crewSailings: 1, checkedSailings: 1, unknownCredentialSailings: 0 }),
        undefined,
        translator,
      );
      expect(tile.detail).toContain(observation);
    },
  );

  it("says no crew was recorded and points at Staffing, with no figure and no dead anchor", () => {
    const tile = crewTile(month({ noCrewOnRecord: true }));
    expect(tile.value).toBe("—");
    expect(tile.value).not.toContain("0 of 0");
    expect(tile.detail).toBe(t("incidents.safety.noCrewNone"));
    expect(tile.detailTone).toBe("quiet");
    expect(tile.href).toBeUndefined();
    expect(tile.link).toEqual({
      href: "/shop/blue-mantis/staffing",
      label: t("shared.shopNavLinks.staffing"),
    });
  });

  it("draws no Staffing door for a shop that runs without the crew schedule", () => {
    expect(crewTile(month({ noCrewOnRecord: true }), null).link).toBeUndefined();
  });

  it("keeps unavailable history compact and explains its sailing count in the detail", () => {
    const tile = crewTile(
      month({ crewSailings: 4, checkedSailings: 0, unknownCredentialSailings: 4 }),
    );
    expect(tile.value).toBe(t("incidents.safety.crewHistoryUnavailableValue"));
    expect(tile.detail).toBe(t("incidents.safety.crewHistoryUnavailable", { count: 4 }));
    expect(tile.link).toEqual({
      href: "/shop/blue-mantis/settings/team",
      label: t("incidents.safety.currentCrewCredentials"),
    });
  });

  it("keeps the unavailable history count beside mixed live-state details", () => {
    const tile = crewTile(
      month({
        crewSailings: 2,
        checkedSailings: 0,
        unknownCredentialSailings: 1,
        unrecordedSailings: 1,
      }),
    );
    expect(tile.value).toBe(t("incidents.safety.crewHistoryUnavailableValue"));
    expect(tile.detail).toContain(t("incidents.safety.crewHistoryUnavailable", { count: 1 }));
    expect(tile.detail).toContain(t("incidents.safety.crewObservation"));
    expect(tile.detail).toContain(
      t("incidents.safety.crewDetailUnrecorded", {
        unrecorded: 1,
        sailings: 1,
      }),
    );
  });

  it("counts only live observations in the empty-file denominator", () => {
    const tile = crewTile(
      month({
        crewSailings: 3,
        checkedSailings: 1,
        unrecordedSailings: 1,
        unknownCredentialSailings: 1,
      }),
    );
    expect(tile.detail).toContain("No credentials on file at 1 of 2 crew boardings");
    expect(tile.detail).toContain("Credential history unavailable for 1 crew sailing");
  });

  it("keeps the lapsed count over the sailings it judged when crew are rostered", () => {
    const tile = crewTile(month({ crewSailings: 4, checkedSailings: 4 }));
    expect(tile.value).toBe("0 of 4");
    expect(tile.href).toBeUndefined();
  });
});
