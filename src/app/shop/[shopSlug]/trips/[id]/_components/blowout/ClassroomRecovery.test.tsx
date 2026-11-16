// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { escapeRegExp } from "@/lib/escape-regexp";
import { ClassroomRecovery } from "./ClassroomRecovery";

vi.mock("../../blowout-actions", () => ({
  createClassroomActivityAction: vi.fn(),
  transitionClassroomActivityAction: vi.fn(),
}));
afterEach(cleanup);

it("identifies classroom capacity by its full Field accessible name", () => {
  const t = staffTranslator("en-US");
  // This empty creation form reads only these page fields; trip/roster and
  // permissions are enforced by the containing page and are not rendered here.
  const page = {
    classroomActivities: [],
    classroomCoordinators: [],
    blowout: null,
  };
  render(
    <ClassroomRecovery
      page={page}
      shopSlug="blue-mantis"
      tripId="trip-classroom"
      locale="en-US"
      timezone="America/New_York"
      dateRequestsEnabled={false}
      contactEmail={null}
      contactPhone={null}
      t={t}
    />,
  );
  fireEvent.click(screen.getByText(t("blowout.classroom.add"), { exact: true }));
  const capacity = screen.getByRole("spinbutton", {
    name: new RegExp(
      `^${escapeRegExp(t("blowout.classroom.capacity"))}\\s*${escapeRegExp(t("blowout.classroom.capacityHint"))}$`,
    ),
  });
  expect(screen.queryByRole("spinbutton", { name: t("blowout.classroom.capacity") })).toBeNull();
  expect(capacity).toHaveAttribute("name", "capacity");
  expect(capacity).toBeRequired();
  expect(capacity).toHaveAttribute("min", "1");
  expect(capacity).toHaveAttribute("max", "500");
});
