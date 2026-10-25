// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { IncidentLogReport, IncidentTimelineEntry } from "@/lib/incident-export";
import { IncidentReportsSection } from "./IncidentReportsSection";
import { TimelineEntryText } from "./TimelineEntryText";

/**
 * The departure log's last section and its seat-change lines (safety sheet
 * 2026-10-15, items 5 and 7). The facts are the export's
 * (`src/lib/incident-export-log.test.ts`); this pins the words on the page.
 */

afterEach(cleanup);

const draft: IncidentLogReport = {
  reportId: "report-1",
  status: "draft",
  kind: null,
  severity: null,
  filedAt: null,
  filedByName: null,
  addendaCount: 0,
  createdAt: "2026-10-12T14:00:00.000Z",
  createdByName: "Sal Rivera",
  deletedAt: null,
  deletedByName: null,
};

const filed: IncidentLogReport = {
  ...draft,
  reportId: "report-2",
  status: "filed",
  kind: "injury",
  severity: "moderate",
  filedAt: "2026-10-12T18:30:00.000Z",
  filedByName: "Rae Owner",
  addendaCount: 2,
};

function renderSection(reports: IncidentLogReport[], locale = "en-US") {
  return render(
    <IncidentReportsSection
      reports={reports}
      reportHref={(id) => `/shop/blue-mantis/trips/trip-1/incidents/${id}`}
      t={staffTranslator(locale)}
      locale={locale}
      timeZone="America/New_York"
    />,
  );
}

describe("IncidentReportsSection", () => {
  it("says a draft is not filed and who started it, when in the shop's zone, and links to it", () => {
    // Domain review 2026-10-16: the draft's date named no zone.
    const { container } = renderSection([draft]);
    expect(container.textContent).toMatch(
      /Draft not filed, started by Sal Rivera on Oct\s12, 10:00\sAM\sEDT\./,
    );
    const link = screen.getByRole("link", { name: "Kind and severity not stated yet" });
    expect(link.getAttribute("href")).toBe("/shop/blue-mantis/trips/trip-1/incidents/report-1");
  });

  it("names a filed report's kind, severity, filer, time with its zone, and later notes", () => {
    const { container } = renderSection([filed]);
    expect(screen.getByRole("link", { name: "Injury or illness — Moderate" })).toBeTruthy();
    expect(container.textContent).toMatch(/Filed Oct\s12, 2:30\sPM\sEDT by Rae Owner/);
    expect(container.textContent).toContain("2 later notes");
  });

  it("lists a deleted draft as one, by whom and when, with no link to it", () => {
    // ADR 20261016-incident-drafts: a draft deleted unfiled stays on the log.
    const { container } = renderSection([
      { ...draft, deletedAt: "2026-10-13T13:00:00.000Z", deletedByName: "Rae Owner" },
    ]);
    expect(container.textContent).toMatch(
      /Draft started by Sal Rivera, deleted unfiled by Rae Owner on Oct\s13, 9:00\sAM\sEDT\./,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("states that there is none rather than leaving the section blank", () => {
    renderSection([]);
    expect(
      screen.getByText("No incident report has been started for this departure."),
    ).toBeTruthy();
  });

  it("speaks Spanish", () => {
    renderSection([draft], "es-ES");
    expect(screen.getByText(/^Borrador sin presentar, empezado por Sal Rivera el /)).toBeTruthy();
  });
});

describe("TimelineEntryText for a seat change", () => {
  const entry: IncidentTimelineEntry = {
    kind: "roster_change",
    occurredAt: "2026-10-12T13:20:00.000Z",
    checkpoint: null,
    action: "removed",
    subjectName: "Ben Cho",
    recordedByName: "Rae Owner",
  };

  it("reads like a buddy-team line: whose seat, what happened, who recorded it", () => {
    const { container } = render(
      <TimelineEntryText
        entry={entry}
        t={staffTranslator("en-US")}
        memberList={new Intl.ListFormat("en-US")}
      />,
    );
    expect(container.textContent).toBe("Ben Cho — Seat removedRecorded by Rae Owner");
  });
});

/** Issue 2808: a team made on the recorder's word that everyone is 18 or over says so. */
describe("TimelineEntryText for a buddy team formed on an 18-or-over attestation", () => {
  const entry: IncidentTimelineEntry = {
    kind: "buddy_team",
    occurredAt: "2026-10-12T08:12:00.000Z",
    checkpoint: null,
    action: "formed",
    teamNumber: 1,
    memberNames: ["Ana Diaz", "Ben Cho"],
    recordedByName: "Rae Owner",
  };
  const text = (line: IncidentTimelineEntry) =>
    render(
      <TimelineEntryText
        entry={line}
        t={staffTranslator("en-US")}
        memberList={new Intl.ListFormat("en-US")}
      />,
    ).container.textContent;

  it("says the recorder confirmed everyone is 18 or over, and only on that line", () => {
    const confirmed = staffTranslator("en-US")("incidentExport.timelineBuddyAdultsConfirmed");
    expect(text({ ...entry, adultsConfirmed: true })).toContain(confirmed);
    cleanup();
    expect(text(entry)).not.toContain(confirmed);
  });
});
