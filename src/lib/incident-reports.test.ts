import { describe, expect, it } from "vitest";
import {
  type IncidentDraftFields,
  incidentFilingGaps,
  mayReadIncidentReport,
  mayStartIncidentReport,
  mayWriteIncidentReport,
  parseIncidentDraft,
  yesNo,
} from "./incident-reports";

const blank: IncidentDraftFields = {
  occurredAt: null,
  diveSiteId: null,
  locationText: null,
  whatHappened: null,
  kind: null,
  severity: null,
  firstAidGiven: null,
  oxygenGiven: null,
  oxygenMinutes: null,
  emergencyServicesCalled: null,
  handoverKind: null,
  handoverDetail: null,
  handedOverAt: null,
  followUp: null,
};

const emptyForm = {
  occurredOn: "",
  occurredTime: "",
  diveSiteId: "",
  locationText: "",
  whatHappened: "",
  kind: "",
  severity: "",
  firstAidGiven: "",
  oxygenGiven: "",
  oxygenMinutes: "",
  emergencyServicesCalled: "",
  handoverKind: "",
  handoverDetail: "",
  handedOverOn: "",
  handedOverTime: "",
  followUp: "",
};

/** A stand-in for the shop's zone: the wall clock read as UTC. */
const utc = (date: string, time: string) => {
  const value = new Date(`${date}T${time}:00Z`);
  return Number.isNaN(value.getTime()) ? null : value;
};

describe("who may do what with an incident report", () => {
  const author = "author";
  const report = { createdByPersonId: author };

  it("lets the departure's crew start one, and owners and managers without being aboard", () => {
    expect(mayStartIncidentReport({ personId: "p", roles: ["divemaster"], onCrew: true })).toBe(
      true,
    );
    expect(mayStartIncidentReport({ personId: "p", roles: ["manager"], onCrew: false })).toBe(true);
    expect(mayStartIncidentReport({ personId: "p", roles: ["owner"], onCrew: false })).toBe(true);
  });

  it("refuses staff who were not on the departure, and anyone who is not active staff", () => {
    expect(mayStartIncidentReport({ personId: "p", roles: ["captain"], onCrew: false })).toBe(
      false,
    );
    // A crew row outlives a disabled login: the live roles decide.
    expect(mayStartIncidentReport({ personId: "p", roles: null, onCrew: true })).toBe(false);
  });

  it("lets a crew member read and write only the reports they started", () => {
    const crew = { personId: author, roles: ["crew"] as const, onCrew: true };
    expect(mayReadIncidentReport({ ...crew, roles: [...crew.roles] }, report)).toBe(true);
    expect(mayWriteIncidentReport({ ...crew, roles: [...crew.roles] }, report)).toBe(true);
    const other = { personId: "someone-else", roles: ["divemaster" as const], onCrew: true };
    expect(mayReadIncidentReport(other, report)).toBe(false);
    expect(mayWriteIncidentReport(other, report)).toBe(false);
  });

  it("closes every door to roles that are not staff, whatever the crew list says", () => {
    for (const roles of [["diver"], []] as const) {
      const viewer = { personId: author, roles: [...roles], onCrew: true };
      expect(mayStartIncidentReport(viewer)).toBe(false);
      expect(mayReadIncidentReport(viewer, report)).toBe(false);
      expect(mayWriteIncidentReport(viewer, report)).toBe(false);
    }
  });

  it("lets owners and managers read every report", () => {
    expect(
      mayReadIncidentReport({ personId: "m", roles: ["manager"], onCrew: false }, report),
    ).toBe(true);
  });

  it("closes every door to an author whose staff login is gone", () => {
    expect(mayReadIncidentReport({ personId: author, roles: null, onCrew: true }, report)).toBe(
      false,
    );
  });
});

describe("incidentFilingGaps", () => {
  it("names everything a blank draft still needs", () => {
    expect(incidentFilingGaps(blank)).toEqual([
      "occurred_at",
      "location",
      "what_happened",
      "kind",
      "severity",
      "first_aid",
      "oxygen",
      "emergency_services",
    ]);
  });

  it("counts an answered no as answered", () => {
    expect(
      incidentFilingGaps({
        ...blank,
        occurredAt: new Date("2026-10-01T10:00:00Z"),
        locationText: "Boat deck",
        whatHappened: "Diver surfaced coughing.",
        kind: "near_miss",
        severity: "minor",
        firstAidGiven: false,
        oxygenGiven: false,
        emergencyServicesCalled: false,
      }),
    ).toEqual([]);
  });

  it("takes a listed dive site as the place", () => {
    expect(incidentFilingGaps({ ...blank, diveSiteId: "site" })).not.toContain("location");
  });

  it("asks who took over care once emergency services were called or oxygen was given", () => {
    const answered = {
      ...blank,
      occurredAt: new Date("2026-10-01T10:00:00Z"),
      locationText: "Boat deck",
      whatHappened: "Diver surfaced coughing.",
      kind: "injury" as const,
      severity: "moderate" as const,
      firstAidGiven: true,
      oxygenGiven: false,
      emergencyServicesCalled: true,
    };
    expect(incidentFilingGaps(answered)).toEqual(["handover"]);
    expect(
      incidentFilingGaps({ ...answered, emergencyServicesCalled: false, oxygenGiven: true }),
    ).toEqual(["handover"]);
    // "Stayed with the crew" is an answer.
    expect(incidentFilingGaps({ ...answered, handoverKind: "none" })).toEqual([]);
    expect(
      incidentFilingGaps({ ...answered, emergencyServicesCalled: false, oxygenGiven: false }),
    ).toEqual([]);
  });

  it("asks what kind of incident it was and how serious, each on its own", () => {
    // Batch 6, item 7. Neither is assumed: a report with no kind is not a
    // report of "other".
    expect(incidentFilingGaps({ ...blank, kind: "missing_diver" })).not.toContain("kind");
    expect(incidentFilingGaps({ ...blank, kind: "missing_diver" })).toContain("severity");
    expect(incidentFilingGaps({ ...blank, severity: "serious" })).toContain("kind");
  });

  it("does not count whitespace as an account of what happened", () => {
    expect(incidentFilingGaps({ ...blank, whatHappened: "   " })).toContain("what_happened");
  });
});

describe("yesNo", () => {
  it("reads only an explicit yes or no", () => {
    expect(yesNo("yes")).toBe(true);
    expect(yesNo("no")).toBe(false);
    expect(yesNo("")).toBeNull();
    expect(yesNo("true")).toBeNull();
    expect(yesNo(undefined)).toBeNull();
  });
});

describe("parseIncidentDraft", () => {
  it("keeps a blank form blank rather than assuming no", () => {
    const parsed = parseIncidentDraft(emptyForm, utc);
    expect(parsed).toEqual({ ok: true, fields: blank });
  });

  it("reads times in the zone it is handed and trims text", () => {
    const parsed = parseIncidentDraft(
      {
        ...emptyForm,
        occurredOn: "2026-10-01",
        occurredTime: "10:15",
        whatHappened: "  Rapid ascent from 18 m.  ",
        oxygenGiven: "yes",
        oxygenMinutes: "20",
        handoverKind: "ems",
        handedOverOn: "2026-10-01",
        handedOverTime: "10:50",
      },
      utc,
    );
    expect(parsed).toMatchObject({
      ok: true,
      fields: {
        occurredAt: new Date("2026-10-01T10:15:00Z"),
        whatHappened: "Rapid ascent from 18 m.",
        oxygenGiven: true,
        oxygenMinutes: 20,
        handoverKind: "ems",
        handedOverAt: new Date("2026-10-01T10:50:00Z"),
      },
    });
  });

  it("refuses half a time instead of quietly dropping it", () => {
    expect(parseIncidentDraft({ ...emptyForm, occurredOn: "2026-10-01" }, utc)).toEqual({
      ok: false,
      reason: "occurred_at_invalid",
    });
    expect(parseIncidentDraft({ ...emptyForm, handedOverTime: "09:00" }, utc)).toEqual({
      ok: false,
      reason: "handed_over_at_invalid",
    });
  });

  it("refuses a handover before the incident", () => {
    expect(
      parseIncidentDraft(
        {
          ...emptyForm,
          occurredOn: "2026-10-01",
          occurredTime: "10:00",
          handedOverOn: "2026-10-01",
          handedOverTime: "09:59",
        },
        utc,
      ),
    ).toEqual({ ok: false, reason: "handed_over_before_incident" });
  });

  it("keeps oxygen minutes only beside a yes, and refuses nonsense", () => {
    const noOxygen = parseIncidentDraft(
      { ...emptyForm, oxygenGiven: "no", oxygenMinutes: "15" },
      utc,
    );
    expect(noOxygen).toMatchObject({ ok: true, fields: { oxygenMinutes: null } });
    for (const minutes of ["0", "-5", "2.5", "lots", "1441"]) {
      expect(
        parseIncidentDraft({ ...emptyForm, oxygenGiven: "yes", oxygenMinutes: minutes }, utc),
      ).toEqual({ ok: false, reason: "oxygen_minutes_invalid" });
    }
  });

  it("keeps an explicit nobody-took-over answer", () => {
    expect(parseIncidentDraft({ ...emptyForm, handoverKind: "none" }, utc)).toMatchObject({
      ok: true,
      fields: { handoverKind: "none" },
    });
  });

  it("reads a kind and a severity it knows, and drops any other", () => {
    expect(
      parseIncidentDraft({ ...emptyForm, kind: "missing_diver", severity: "serious" }, utc),
    ).toMatchObject({ ok: true, fields: { kind: "missing_diver", severity: "serious" } });
    expect(
      parseIncidentDraft({ ...emptyForm, kind: "shark", severity: "catastrophic" }, utc),
    ).toMatchObject({ ok: true, fields: { kind: null, severity: null } });
  });

  it("drops a handover code it does not know", () => {
    expect(parseIncidentDraft({ ...emptyForm, handoverKind: "helicopter" }, utc)).toMatchObject({
      ok: true,
      fields: { handoverKind: null },
    });
  });

  it("refuses text past the limit", () => {
    expect(parseIncidentDraft({ ...emptyForm, whatHappened: "x".repeat(5001) }, utc)).toEqual({
      ok: false,
      reason: "text_too_long",
    });
    expect(parseIncidentDraft({ ...emptyForm, locationText: "x".repeat(201) }, utc)).toEqual({
      ok: false,
      reason: "text_too_long",
    });
  });
});
