// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { IncidentBoatSafety } from "@/lib/incident-export";
import { BoatAtDeparture } from "./BoatAtDeparture";

/**
 * The departure log's boat section (#2300): the snapshot's facts, and an
 * absence stated in words rather than a missing section.
 */

afterEach(cleanup);

const SNAPSHOT: IncidentBoatSafety = {
  boatName: "Reef Runner",
  judgedOn: "2026-08-04",
  capturedAt: "2026-08-04T12:40:00.000Z",
  papers: {
    certifiedPassengers: 12,
    certifiedTotalPersons: null,
    coiExpiresOn: "2027-05-01",
    inspectionDueOn: "2026-08-01",
    registrationExpiresOn: null,
    insuranceExpiresOn: null,
  },
  notices: [{ code: "paper", paper: "inspection", dueOn: "2026-08-01", expired: true, days: 3 }],
};

for (const locale of ["en-US", "es-ES"] as const) {
  const t = staffTranslator(locale);
  const draw = (boatSafety: IncidentBoatSafety | null) =>
    render(
      <BoatAtDeparture boatSafety={boatSafety} locale={locale} dateTime={() => "WHEN"} t={t} />,
    );

  describe(`BoatAtDeparture (${locale})`, () => {
    it("states that nothing was kept when there is no snapshot", () => {
      draw(null);
      expect(screen.getByRole("heading", { name: t("incidentExport.boatHeading") })).toBeVisible();
      expect(screen.getByText(t("incidentExport.boatNotCaptured"))).toBeInTheDocument();
    });

    it("sets the kept papers, says which were not recorded, and words each notice", () => {
      draw(SNAPSHOT);
      expect(
        screen.getByText(
          t("incidentExport.boatCaptured", { boatName: "Reef Runner", date: "WHEN" }),
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      // Total persons, registration and insurance were never recorded.
      expect(screen.getAllByText(t("incidentExport.boatNotRecorded"))).toHaveLength(3);
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });

    it("says the boat carried no notice when it carried none", () => {
      draw({ ...SNAPSHOT, notices: [] });
      expect(screen.getByText(t("incidentExport.boatNoNotices"))).toBeInTheDocument();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    });
  });
}
