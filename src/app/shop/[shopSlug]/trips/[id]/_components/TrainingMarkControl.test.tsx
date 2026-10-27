// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrainingMarkRosterSeat } from "@/db/training-marks";
import { staffTranslator } from "@/i18n/staff-messages";
import { TrainingMarkControl } from "./TrainingMarkControl";

afterEach(cleanup);

const t = staffTranslator("en-US");
const BOOKING = "00000000-0000-4000-8000-0000000000c1";
const ENROLLMENT = "00000000-0000-4000-8000-0000000000e1";
const at = new Date("2026-10-20T13:00:00.000Z");

function draw(training: TrainingMarkRosterSeat) {
  render(
    <TrainingMarkControl
      bookingId={BOOKING}
      training={training}
      markAction={vi.fn()}
      clearAction={vi.fn()}
      locale="en-US"
      timezone="America/New_York"
      t={t}
    />,
  );
}

const mark = {
  enrollmentBookingId: ENROLLMENT,
  courseTitle: "Advanced Open Water",
  sessionStartsAt: at,
  valid: true,
  courseInstructorAboard: true,
  markedAt: at,
  markedByName: "Dana",
};

describe("a training mark on a charter seat's row (issue #2275)", () => {
  it("offers only the diver's own course seats, naming each course", () => {
    draw({
      mark: null,
      options: [
        {
          enrollmentBookingId: ENROLLMENT,
          courseTitle: "Advanced Open Water",
          sessionStartsAt: at,
        },
      ],
      clearedWithFormsOwed: null,
    });
    const select = screen.getByRole("combobox", { name: "Counts toward" }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual([ENROLLMENT]);
    expect(select.options[0]?.textContent).toContain("Advanced Open Water");
    expect(screen.getByRole("button", { name: "Mark as training dive" })).toBeTruthy();
  });

  it("names the course once marked, offers the clear, and warns with no instructor aboard", () => {
    draw({
      mark: { ...mark, courseInstructorAboard: false },
      options: [],
      clearedWithFormsOwed: null,
    });
    expect(screen.getByText(/Training dive for Advanced Open Water/)).toBeTruthy();
    expect(
      screen.getByText(
        "No instructor of the course is aboard for this seat (rostered by someone else, counted aboard, within the course ratio), so the departure’s own level applies.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear training mark" })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("explains why an unassigned multi-dive mark cannot lower site requirements", () => {
    draw({
      mark: { ...mark, siteAttributionUnknown: true },
      options: [],
      clearedWithFormsOwed: null,
    });
    expect(screen.getByText(t("trips.roster.trainingMark.siteAttributionUnknown"))).toBeTruthy();
  });

  it("says nothing of a course on a mark that no longer stands: the blocker line speaks", () => {
    draw({
      mark: { ...mark, valid: false, courseInstructorAboard: false },
      options: [],
      clearedWithFormsOwed: null,
    });
    expect(screen.queryByText(/Training dive for/)).toBeNull();
    expect(screen.queryByText(/No instructor of the course/)).toBeNull();
    expect(screen.getByRole("button", { name: "Clear training mark" })).toBeTruthy();
  });

  it("names who cleared a mark with forms owed", () => {
    draw({ mark: null, options: [], clearedWithFormsOwed: { at, byName: "Dana Reyes" } });
    expect(
      screen.getByText(
        t("trips.roster.trainingMark.clearedWithFormsOwed", {
          hasName: "yes",
          name: "Dana Reyes",
        }),
        { exact: true },
      ),
    ).toBeTruthy();
  });
});
