import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IncidentReportLine } from "@/db/incident-reports";
import { staffTranslator } from "@/i18n/staff-messages";
import type { SafetyMonth } from "@/lib/safety-report";
import { SafetyLists } from "./SafetyLists";

const t = staffTranslator("en-US");
const month = {
  openRollCalls: [
    {
      tripId: "t1",
      title: "Reef at nine",
      startsAt: new Date("2026-10-03T13:00:00Z"),
      closure: "open",
    },
  ],
  noCrewDepartures: [
    { tripId: "t2", title: "Wreck run", startsAt: new Date("2026-10-04T13:00:00Z") },
  ],
  lapsedSailings: [],
  unrecordedCrew: [{ personId: "p1", name: "Zoe Zed", sailings: 2 }],
} as unknown as SafetyMonth;
const incidents = [
  {
    id: "i1",
    tripId: "t1",
    tripTitle: "Reef at nine",
    status: "filed",
    kind: null,
    severity: null,
    at: new Date("2026-10-03T15:00:00Z"),
    createdByName: "Ana",
  },
] as unknown as IncidentReportLine[];

function render(paper: boolean) {
  return renderToStaticMarkup(
    <SafetyLists
      paper={paper}
      month={month}
      incidents={incidents}
      credentialKindKeys={{}}
      shopSlug="blue-mantis"
      locale="en-US"
      timeZone="America/New_York"
      t={t}
    />,
  );
}

describe("SafetyLists on the sheet", () => {
  it("prints every row the screen lists, with no link", () => {
    const screen = render(false);
    const sheet = render(true);
    expect(screen).toContain("<a ");
    expect(sheet).not.toContain("<a ");
    for (const row of ["Reef at nine", "Wreck run", "Zoe Zed"]) {
      expect(screen).toContain(row);
      expect(sheet).toContain(row);
    }
    expect(sheet).toContain(t("incidents.safety.incidentsTitle"));
    expect(sheet).toContain(t("incidents.safety.openTitle"));
    expect(sheet).toContain(t("incidents.safety.noCrewTitle"));
    expect(sheet).toContain(t("incidents.safety.unrecordedTitle"));
  });
});
