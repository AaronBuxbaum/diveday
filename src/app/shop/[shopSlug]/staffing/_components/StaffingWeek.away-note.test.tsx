// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type AvailabilityBlock, type AwayNoteReader, awayNoteFor } from "@/lib/crew-requests";
import { KEIKO, renderWeek, THURSDAY } from "./staffing-week-test-fixtures";

afterEach(cleanup);

/**
 * **Why somebody is away is theirs** (issue #2673, decided by Aaron
 * 2026-10-17). The week is drawn from the blocks the page was sent, and the
 * reader decides what those carry (`listCrewAvailabilityBlocks` with
 * `awayNoteFor`): Keiko and an owner or manager read her reason, a colleague
 * reads that she is away and nothing more.
 */
describe("StaffingWeek away note", () => {
  const AWAY: AvailabilityBlock = {
    id: "block-keiko",
    personId: KEIKO.personId,
    startsOn: THURSDAY,
    endsOn: THURSDAY,
    note: "Hospital appointment",
  };
  const weekAs = (reader: AwayNoteReader) =>
    renderWeek({ blocks: [{ ...AWAY, note: awayNoteFor(AWAY, reader) }] });

  it("shows the note to the person themself", () => {
    weekAs({ personId: KEIKO.personId, canReadCrewAwayNote: false });
    expect(screen.getAllByText(/Hospital appointment/).length).toBeGreaterThan(0);
  });

  it("shows the note to an owner or manager", () => {
    weekAs({ personId: "person-owner", canReadCrewAwayNote: true });
    expect(screen.getAllByText(/Hospital appointment/).length).toBeGreaterThan(0);
  });

  it("keeps a privileged reader's note off the shared printed noticeboard", () => {
    const { container } = weekAs({ personId: "person-owner", canReadCrewAwayNote: true });
    const grid = container.querySelector(".staffing-print-grid");
    if (!grid) throw new Error("the week must have a printable rota");
    const note = [...grid.querySelectorAll("span")].find((span) => span.textContent === AWAY.note);
    expect(note).toBeDefined();
    expect(note).toHaveClass("print:hidden");
    expect(grid).toHaveTextContent("Away");
    expect(grid).toHaveTextContent("Thu, Aug 27");
  });

  it("shows a colleague that she is away, and not why", () => {
    weekAs({ personId: "person-colleague", canReadCrewAwayNote: false });
    expect(screen.getAllByText(/Away/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Hospital appointment/)).toBeNull();
  });
});
