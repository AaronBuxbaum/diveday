// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { fixtures, renderRoster } from "./roster-test-fixtures";
import { SeatCourseControls } from "./SeatCourseControls";

afterEach(cleanup);

describe("certifying a student from a course session's roster (issue #2059)", () => {
  /** One per student row; every one of them opens the same way. */
  function awardSelects() {
    const selects = screen.getAllByRole("combobox", { name: /^Level/ }) as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    return selects;
  }

  it("opens on the level the course issues", () => {
    renderRoster({ ...fixtures, certifyDefaultLevel: "advanced_open_water" });
    for (const select of awardSelects()) expect(select.value).toBe("advanced_open_water");
  });

  /**
   * **No level is put in front of the instructor when the course issues
   * none** (dive-domain review). Opening on Open Water there turned a stray
   * "Certify" tap into a verified card nobody chose.
   */
  it("opens on an empty, required choice when the course issues no level", () => {
    renderRoster({ ...fixtures, certifyDefaultLevel: null });
    const [select] = awardSelects();
    expect(select?.value).toBe("");
    expect(select).toBeRequired();
    expect(select?.options[0]?.value).toBe("");
    expect(select?.options[0]?.disabled).toBe(true);
    expect([...(select?.options ?? [])].map((option) => option.value)).toContain(
      "advanced_open_water",
    );
  });

  it("draws no Certify control where the session certifies nobody", () => {
    renderRoster({ ...fixtures });
    expect(screen.queryByText("Certify")).toBeNull();
    expect(screen.queryAllByRole("combobox", { name: /^Level/ })).toHaveLength(0);
  });
});

// Loop 5, row 10: a referral student and the two papers the desk collects.
describe("a referral student on a course session's roster", () => {
  const t = staffTranslator("en-US");
  const action = async () => {};
  const base = { bookingId: "b1", personId: "p1", t, certifyDefaultLevel: null, nextStep: "" };

  it("offers one tap to mark the seat, and nothing without the action", () => {
    render(
      <SeatCourseControls {...base} materialsDoneLine={null} referralStudentAction={action} />,
    );
    expect(screen.getByRole("button", { name: t("trips.roster.referralMark") })).toBeTruthy();
    cleanup();
    render(<SeatCourseControls {...base} materialsDoneLine={null} />);
    expect(screen.queryByRole("button", { name: t("trips.roster.referralMark") })).toBeNull();
  });

  it("lists each paper, collected or still owed, and the way back", () => {
    render(
      <SeatCourseControls
        {...base}
        materialsDoneLine={null}
        referralStudentAction={action}
        referral={{
          markedLine: "Referral student, marked Nov 5",
          papers: [
            { paper: "form", label: "Referral form", doneLine: "Collected Nov 5" },
            { paper: "record", label: "eLearning record", doneLine: null },
          ],
        }}
      />,
    );
    const block = screen.getByTestId("referral-student");
    expect(block.textContent).toContain("Referral form");
    expect(block.textContent).toContain("Collected Nov 5");
    expect(screen.getAllByRole("button", { name: t("trips.roster.referralCollect") })).toHaveLength(
      1,
    );
    expect(screen.getByRole("button", { name: t("trips.roster.referralUncollect") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("trips.roster.referralUnmark") })).toBeTruthy();
  });
});
