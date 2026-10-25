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
  boatChanged: false,
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
  const draw = (
    boatSafety: IncidentBoatSafety | null,
    absence: "no_boat" | "not_kept" | null = null,
  ) =>
    render(
      <BoatAtDeparture
        doc={{ boatSafety, boatSafetyAbsence: absence }}
        locale={locale}
        dateTime={() => "WHEN"}
        t={t}
      />,
    );

  describe(`BoatAtDeparture (${locale})`, () => {
    it("says nothing was kept, without guessing why", () => {
      draw(null, "not_kept");
      expect(screen.getByRole("heading", { name: t("incidentExport.boatHeading") })).toBeVisible();
      expect(screen.getByText(t("incidentExport.boatNotKept"))).toBeInTheDocument();
    });

    it("says the departure names no boat", () => {
      draw(null, "no_boat");
      expect(screen.getByText(t("incidentExport.boatNoBoat"))).toBeInTheDocument();
      expect(screen.queryByText(t("incidentExport.boatNotKept"))).toBeNull();
    });

    it("says when the departure has since moved to another boat", () => {
      draw({ ...SNAPSHOT, boatChanged: true });
      expect(screen.getByRole("status")).toHaveTextContent(
        t("incidentExport.boatChanged", { boatName: SNAPSHOT.boatName }),
      );
      expect(screen.getByRole("status")).toHaveClass("text-danger");
      draw(SNAPSHOT);
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });

    it("sets the kept papers, says which were not recorded, and words each notice", () => {
      draw(SNAPSHOT);
      expect(
        screen.getByText(
          t("incidentExport.boatCaptured", { boatName: "Reef Runner", date: "WHEN" }),
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      // Total persons, registration and insurance were never recorded, and
      // this snapshot kept no radio fact.
      expect(screen.getAllByText(t("incidentExport.boatNotRecorded"))).toHaveLength(6);
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      // The notices are what the register showed, not what was aboard.
      expect(screen.getByText(t("incidentExport.boatNoticesLabel"))).toBeInTheDocument();
    });

    it("sets the radio identity the card printed, each under its own label (records review S1)", () => {
      draw({
        ...SNAPSHOT,
        radio: { callSign: "WDM2201", mmsi: "338055502", workingChannel: null },
      });
      expect(screen.getByText(t("boats.callSignLabel")).nextSibling?.textContent).toBe("WDM2201");
      expect(screen.getByText(t("boats.mmsiLabel")).nextSibling?.textContent).toBe("338055502");
      expect(screen.getByText(t("boats.workingChannelLabel")).nextSibling?.textContent).toBe(
        t("incidentExport.boatNotRecorded"),
      );
    });

    it("says a snapshot that kept no radio fact recorded none", () => {
      draw(SNAPSHOT);
      for (const label of [
        "boats.callSignLabel",
        "boats.mmsiLabel",
        "boats.workingChannelLabel",
      ] as const) {
        expect(screen.getByText(t(label)).nextSibling?.textContent).toBe(
          t("incidentExport.boatNotRecorded"),
        );
      }
    });

    it("sets the checklist answer kept with the snapshot beside the notices (issue 2725)", () => {
      draw({ ...SNAPSHOT, checklist: { itemCount: 3, unchecked: ["Flares in date"] } });
      const notices = screen.getByText(t("incidentExport.boatNoticesLabel")).parentElement;
      const answer = screen.getByText(t("incidentExport.boatChecklistLabel")).parentElement;
      expect(answer?.parentElement).toBe(notices?.parentElement);
      expect(answer).toHaveTextContent(
        t("incidentExport.boatChecklistCount", { checked: 2, total: 3 }),
      );
      expect(
        screen.getByRole("list", { name: t("incidentExport.boatChecklistUnchecked") }),
      ).toHaveTextContent("Flares in date");
    });

    it("says every line was checked when none was left", () => {
      draw({ ...SNAPSHOT, checklist: { itemCount: 2, unchecked: [] } });
      expect(
        screen.getByText(t("incidentExport.boatChecklistCount", { checked: 2, total: 2 })),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("list", { name: t("incidentExport.boatChecklistUnchecked") }),
      ).toBeNull();
    });

    it("says the shop kept no checklist when it had none", () => {
      draw({ ...SNAPSHOT, checklist: { itemCount: 0, unchecked: [] } });
      expect(screen.getByText(t("incidentExport.boatChecklistNone"))).toBeInTheDocument();
    });

    it("says a snapshot kept before the answer existed did not record it", () => {
      draw(SNAPSHOT);
      expect(screen.getByText(t("incidentExport.boatChecklistLabel"))).toBeInTheDocument();
      expect(screen.getByText(t("incidentExport.boatChecklistNotKept"))).toBeInTheDocument();
    });

    it("says the boat carried no notice when it carried none", () => {
      draw({ ...SNAPSHOT, notices: [] });
      expect(screen.getByText(t("incidentExport.boatNoNotices"))).toBeInTheDocument();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    });
  });
}
