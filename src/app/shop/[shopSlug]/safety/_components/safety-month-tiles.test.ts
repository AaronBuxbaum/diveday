import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { SafetyMonth } from "../../../../../features/safety/safety-report/rules";
import { SAFETY_LIST_IDS } from "./SafetyLists";
import { safetyMonthTiles } from "./safety-month-tiles";

const t = staffTranslator("en-US");

function month(crew: Partial<SafetyMonth>): SafetyMonth {
  return {
    rollCallsClosed: 3,
    departuresBack: 3,
    boardedAtDock: 8,
    unmarkedAtDock: 0,
    certOverrides: 0,
    crewSailings: 0,
    crewCredentialStates: [],
    checkedSailings: 0,
    unknownCredentialSailings: 0,
    unrecordedSailings: 0,
    lapsedSailings: [],
    openRollCalls: [],
    unrecordedCrew: [],
    noCrewDepartures: [],
    noCrewOnRecord: false,
    ...crew,
  } as unknown as SafetyMonth;
}

function tiles(safety: SafetyMonth, staffingHref: string | null = "/shop/blue-mantis/staffing") {
  return safetyMonthTiles({
    t,
    safety,
    filed: 0,
    drafts: 0,
    activityHref: "/shop/blue-mantis/settings/activity",
    staffingHref,
  });
}

function crewTile(safety: SafetyMonth, staffingHref?: string | null) {
  const tile = tiles(safety, staffingHref).find((figure) => figure.key === "crew");
  if (!tile) throw new Error("no crew tile");
  return tile;
}

describe("the month's crew tile", () => {
  it("shows a positive count of distinct crew without explanatory copy", () => {
    const tile = crewTile(
      month({
        crewSailings: 4,
        checkedSailings: 4,
        crewCredentialStates: [
          { personId: "a", credentialed: true },
          { personId: "b", credentialed: true },
        ],
      }),
    );
    expect(tile.label).toBe("Credentialed crew");
    expect(tile.value).toBe("2 of 2");
    expect(tile.detail).toBeFalsy();
    expect(tile.link).toBeUndefined();
  });

  it("says when no crew was recorded and points to Staffing", () => {
    const tile = crewTile(month({ noCrewOnRecord: true }));
    expect(tile.value).toBe("—");
    expect(tile.detail).toBe(t("incidents.safety.noCrewNone"));
    expect(tile.link).toEqual({
      href: "/shop/blue-mantis/staffing",
      label: t("shared.shopNavLinks.staffing"),
    });
    expect(crewTile(month({ noCrewOnRecord: true }), null).link).toBeUndefined();
  });

  it("does not claim that unavailable history is credentialed", () => {
    const tile = crewTile(
      month({
        crewSailings: 2,
        unknownCredentialSailings: 2,
        crewCredentialStates: [{ personId: "a", credentialed: false }],
      }),
    );
    expect(tile.value).toBe("Unavailable");
    expect(tile.detail).toBe(t("incidents.safety.crewHistoryUnavailable", { count: 2 }));
    expect(tile.link).toBeUndefined();
  });

  it("keeps unknown and missing records out of the positive count", () => {
    const tile = crewTile(
      month({
        crewSailings: 3,
        checkedSailings: 1,
        unknownCredentialSailings: 1,
        unrecordedSailings: 1,
        crewCredentialStates: [
          { personId: "a", credentialed: true },
          { personId: "b", credentialed: false },
          { personId: "c", credentialed: false },
        ],
      }),
    );
    expect(tile.value).toBe("1 of 3");
    expect(tile.detail).toContain("Credential history unavailable for 1 crew sailing");
    expect(tile.detail).toContain("No credentials on file at 1 of 2 crew boardings");
  });
});

it("includes all yearly figures and links the lists that have entries", () => {
  const figures = tiles(
    month({
      openRollCalls: [{}] as SafetyMonth["openRollCalls"],
      noCrewDepartures: [{}] as SafetyMonth["noCrewDepartures"],
    }),
  );
  expect(figures.map((figure) => figure.key)).toEqual([
    "rollCalls",
    "boarded",
    "certOverrides",
    "crew",
    "noCrew",
    "incidents",
  ]);
  expect(figures.find((figure) => figure.key === "boarded")?.value).toBe("8");
  expect(figures.find((figure) => figure.key === "rollCalls")?.href).toBe(
    `#${SAFETY_LIST_IDS.open}`,
  );
  expect(figures.find((figure) => figure.key === "noCrew")?.href).toBe(
    `#${SAFETY_LIST_IDS.noCrew}`,
  );
  expect(figures.find((figure) => figure.key === "incidents")?.href).toBeUndefined();
});
