// @vitest-environment jsdom
// i18n-exempt-file: test; its words are the fixtures' English.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import type { AvailabilityBlock, CrewAssignmentRequest } from "@/lib/crew-requests";
import { staffWeek, type WeekGap } from "@/lib/staffing-week";
import { StaffingRotaSheet } from "./StaffingRotaSheet";
import { GAP_WORDS, KEIKO, MONDAY, THURSDAY, TZ, WORDS } from "./staffing-week-test-fixtures";

afterEach(cleanup);

const GAP: WeekGap = {
  tripId: "trip-gap",
  title: "Spiegel Grove",
  gap: "uncrewed_departure",
  meetings: [
    {
      startsAt: new Date("2026-08-27T17:00:00.000Z"),
      endsAt: new Date("2026-08-27T21:00:00.000Z"),
    },
  ],
};

const AWAY: AvailabilityBlock = {
  id: "block-keiko",
  personId: KEIKO.personId,
  startsOn: THURSDAY,
  endsOn: THURSDAY,
  note: "Hospital appointment",
};

const ASK: CrewAssignmentRequest = {
  id: "request-1",
  tripId: GAP.tripId,
  personId: KEIKO.personId,
  personName: KEIKO.name,
  inWaterRole: "certified_assistant",
  state: "pending",
  requestedAt: new Date("2026-08-20T00:00:00.000Z"),
};

function renderSheet() {
  const week = staffWeek({
    people: [KEIKO],
    gaps: [GAP],
    weekStart: MONDAY,
    timeZone: TZ,
    today: THURSDAY,
    blocks: [AWAY],
    requests: [ASK],
    viewer: { personId: "person-owner", isCrew: true, holdsInstructorRole: false },
    now: new Date("2026-08-20T00:00:00.000Z"),
  });
  return render(
    <section className="paper-sheet">
      <StaffingRotaSheet
        week={week}
        gapWords={GAP_WORDS}
        words={WORDS}
        locale={DEFAULT_DIVER_LOCALE}
        timeZone={TZ}
        shopName="Blue Mantis Divers"
        rangeLabel="Aug 24 – 30, 2026"
        timeZoneLabel="ET"
      />
    </section>,
  );
}

/**
 * **The crew week on paper** (issue #2745, layer 2): the noticeboard's rota is
 * a sheet, so it carries the week's facts and not one control.
 */
describe("the crew rota sheet", () => {
  it("renders no control on the sheet", () => {
    const { container } = renderSheet();
    const sheet = container.querySelector(".paper-sheet");
    expect(sheet?.querySelectorAll("button, select, textarea, input, details")).toHaveLength(0);
    // Not a door either: Assign and the departure links are the screen's.
    expect(sheet?.querySelectorAll("a")).toHaveLength(0);
    expect(sheet?.innerHTML).not.toMatch(/print:/);
  });

  it("repeats whose week it is, and in which zone, in the head every page reprints", () => {
    const { container } = renderSheet();
    const context = container.querySelector("thead [data-crew-print-context]");
    expect(context).toHaveTextContent("Blue Mantis Divers");
    expect(context).toHaveTextContent("Aug 24 – 30, 2026");
    expect(context?.querySelector("[data-crew-print-zone]")).toHaveTextContent("ET");
    expect(
      within(container.querySelector("table") as HTMLElement).getAllByRole("columnheader"),
    ).toHaveLength(8);
  });

  it("says the shift, the gap and who asked for it, in the shop's zone", () => {
    renderSheet();
    expect(screen.getByRole("rowheader", { name: "Needs crew" })).toBeTruthy();
    expect(screen.getByText("No divemaster")).toBeTruthy();
    // Thursday, 1:00 PM in Key Largo, not the host's 5:00 PM.
    expect(screen.getByText("1:00 PM")).toBeTruthy();
    expect(screen.getByText("Keiko Tanaka asked")).toBeTruthy();
    expect(screen.getByText("Dock")).toBeTruthy();
  });

  it("says somebody is away, and never why, on a board everybody reads (issue 2673)", () => {
    renderSheet();
    expect(screen.getAllByText("Away").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Hospital appointment/)).toBeNull();
  });
});
