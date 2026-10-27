// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { TrainingPlanContent } from "./TrainingPlanContent";

afterEach(cleanup);

it("names the plan, explains each affected assignment, and ties the reasons to its control", () => {
  const t = staffTranslator("en-US");
  const entry = {
    baseStudentsPerInstructor: 8,
    assistantBonusPerInstructor: 2,
    maxStudentsPerInstructor: 12,
  };
  render(
    <TrainingPlanContent
      t={t}
      canEdit
      action={vi.fn()}
      plan={{
        instructors: [{ id: "teacher", name: "Dana" }],
        assistants: [{ id: "helper", name: "Rae", instructorPersonId: null }],
        students: [
          {
            id: "missing",
            name: "Maya",
            instructorPersonId: null,
            sessionTripId: "course",
            eligible: ["teacher"],
            rule: entry,
            markValid: true,
          },
          {
            id: "stale",
            name: "Noah",
            instructorPersonId: "former",
            sessionTripId: "course",
            eligible: ["teacher"],
            rule: entry,
            markValid: true,
          },
          {
            id: "limit",
            name: "Alex",
            instructorPersonId: "teacher",
            sessionTripId: "course",
            eligible: ["teacher"],
            rule: null,
            markValid: true,
          },
          {
            id: "mark",
            name: "Lee",
            instructorPersonId: null,
            sessionTripId: "course",
            eligible: [],
            rule: null,
            markValid: false,
          },
        ],
        allocation: {
          groups: new Map(),
          unresolvedStudents: new Set(["missing", "stale", "limit", "mark"]),
          unresolvedAssistants: new Set(["helper"]),
        },
      }}
    />,
  );
  expect(screen.getByRole("heading", { name: t("trips.trainingPlan.title") })).toBeTruthy();
  expect(screen.getByText(t("trips.trainingPlan.scope"))).toBeTruthy();
  expect(screen.getByText(t("trips.trainingPlan.limitsUnavailable"))).toBeTruthy();
  const describe = (name: string, text: string) => {
    const select = screen.getByRole("combobox", {
      name: t("trips.trainingPlan.instructor", { name }),
    });
    expect(select.getAttribute("aria-describedby")).toBeTruthy();
    expect(within(select.closest("form") as HTMLElement).getByText(text)).toBeTruthy();
  };
  describe("Rae", t("trips.trainingPlan.chooseInstructor"));
  describe("Maya", t("trips.trainingPlan.chooseInstructor"));
  describe("Noah", t("trips.trainingPlan.instructorUnavailable"));
  describe("Alex", t("trips.trainingPlan.checkCourseLimit"));
  describe("Lee", t("trips.trainingPlan.checkTrainingMark"));
});

it("gives a specific next step when no course instructor is available, in Spanish", () => {
  const t = staffTranslator("es-ES");
  render(
    <TrainingPlanContent
      t={t}
      canEdit
      action={vi.fn()}
      plan={{
        instructors: [],
        assistants: [{ id: "helper", name: "Rae", instructorPersonId: null }],
        students: [
          {
            id: "student",
            name: "Maya",
            instructorPersonId: null,
            sessionTripId: "course",
            eligible: [],
            rule: {
              baseStudentsPerInstructor: 8,
              assistantBonusPerInstructor: 2,
              maxStudentsPerInstructor: 12,
            },
            markValid: true,
          },
        ],
        allocation: {
          groups: new Map(),
          unresolvedStudents: new Set(["student"]),
          unresolvedAssistants: new Set(["helper"]),
        },
      }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Asignaciones previstas de instructores" }),
  ).toBeTruthy();
  expect(screen.getByText(t("trips.trainingPlan.noInstructor"))).toBeTruthy();
  expect(screen.getByText(t("trips.trainingPlan.noCourseInstructor"))).toBeTruthy();
  expect(screen.queryByText(t("trips.trainingPlan.limitsUnavailable"))).toBeNull();
});
