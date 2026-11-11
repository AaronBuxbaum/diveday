// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { SessionDayPlan } from "./SessionDayPlan";

const t = diverTranslator("en-US");

afterEach(cleanup);

const afternoon = {
  title: "Your afternoon",
  timeNote: "about 3 hours",
  items: ["Briefing: how the gear works", "One shallow open-water dive, maximum {depth12}"],
};

/**
 * **The session's own afternoon on the thread** (issue #2795): the one day of
 * the course's plan this session is, read off the course row as the trip page
 * reads it (`courseDayPlan`), its depth said in the shop's unit.
 */
describe("SessionDayPlan", () => {
  it("lays out a one-meeting session's day of a one-day plan", () => {
    render(
      <SessionDayPlan
        course={{ scheduleDays: [afternoon], includedRentalKinds: ["bcd", "regulator", "weights"] }}
        meetingDays={1}
        depthUnit="feet"
        t={t}
        locale="en-US"
      />,
    );
    const section = screen.getByRole("region", { name: "Your afternoon" });
    expect(within(section).getByText("about 3 hours")).toBeInTheDocument();
    const items = within(section)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "Briefing: how the gear works",
      "One shallow open-water dive, maximum 40 feet",
    ]);
    // The gear line is the gear step's and the packing list's, not this block's.
    expect(section.textContent).not.toContain(t("trip.courseGearIncluded"));
  });

  it("says nothing on a session that meets on more than one day", () => {
    const { container } = render(
      <SessionDayPlan
        course={{ scheduleDays: [afternoon], includedRentalKinds: ["bcd", "regulator", "weights"] }}
        meetingDays={2}
        depthUnit="meters"
        t={t}
        locale="en-US"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing on an ordinary departure", () => {
    const { container } = render(
      <SessionDayPlan course={null} meetingDays={1} depthUnit="meters" t={t} locale="en-US" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

it("shows every course day when this booking covers the full plan", () => {
  render(
    <SessionDayPlan
      course={{
        scheduleDays: [
          { title: "Day 1: pool", meetingPlace: "Training pool entrance", items: ["Pool skills"] },
          { title: "Day 2: ocean", meetingPlace: "Shop dock", items: ["Open-water dives"] },
        ],
        includedRentalKinds: [],
      }}
      meetingDays={2}
      depthUnit="meters"
      t={t}
      locale="en-US"
    />,
  );
  expect(screen.getByText("Training pool entrance")).toBeVisible();
  expect(screen.getByText("Shop dock")).toBeVisible();
  expect(screen.getByText("Pool skills")).toBeVisible();
  expect(screen.getByText("Open-water dives")).toBeVisible();
});
