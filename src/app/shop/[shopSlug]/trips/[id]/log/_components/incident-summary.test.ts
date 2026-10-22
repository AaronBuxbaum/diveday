import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { IncidentExportDocument } from "@/lib/incident-export";
import { incidentSummaryRows } from "./incident-summary";

const mixedPassengers: IncidentExportDocument["departureSummary"] = {
  totalDivers: 6,
  byType: { diver: 4, snorkeler: 1, rider: 1 },
  boarded: 5,
  notBoarded: 0,
  awaiting: 1,
  crewAssigned: 2,
};

describe("the departure log's summary tiles", () => {
  for (const locale of ["en-US", "es-ES"] as const) {
    it(`keeps the passenger figure numeric and the complete breakdown in detail (${locale})`, () => {
      const t = staffTranslator(locale);
      const rows = incidentSummaryRows(t, mixedPassengers);

      expect(rows[0]).toEqual([
        t("incidentExport.summaryDivers"),
        6,
        locale === "es-ES"
          ? "6 (4 buceadores · 1 de snorkel · 1 acompañante)"
          : "6 (4 divers · 1 snorkeler · 1 rider)",
      ]);
      expect(rows.slice(1)).toEqual([
        [t("incidentExport.summaryBoarded"), 5],
        [t("incidentExport.summaryNotBoarded"), 0],
        [t("incidentExport.summaryAwaiting"), 1],
        [t("incidentExport.summaryCrewAssigned"), 2],
      ]);
    });
  }

  it("does not duplicate an all-diver count as detail or include crew in the passenger figure", () => {
    const t = staffTranslator("en-US");
    const rows = incidentSummaryRows(t, {
      ...mixedPassengers,
      byType: { diver: 6, snorkeler: 0, rider: 0 },
    });

    expect(rows[0]).toEqual([t("incidentExport.summaryDivers"), 6, undefined]);
    expect(rows[4]).toEqual([t("incidentExport.summaryCrewAssigned"), 2]);
  });
});
