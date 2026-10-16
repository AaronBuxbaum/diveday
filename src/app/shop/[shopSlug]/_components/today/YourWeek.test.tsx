// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffingGapWords } from "@/app/shop/[shopSlug]/staffing/_components/gap-words";
import { staffTranslator } from "@/i18n/staff-messages";
import { YourWeekList } from "./YourWeek";

afterEach(cleanup);

const t = staffTranslator("en-US");

describe("YourWeekList", () => {
  it("draws each departure as the boat, when, the job, and the one thing missing", () => {
    render(
      <YourWeekList
        lines={[
          {
            tripId: "t-1",
            title: "Morning reef",
            startsAt: new Date("2026-10-15T12:30:00.000Z"),
            boatName: "Reef Runner",
            tripRole: "captain",
            gap: "uncrewed_departure",
            crewCallAt: null,
          },
          {
            tripId: "t-2",
            title: "Afternoon wreck",
            startsAt: new Date("2026-10-16T18:00:00.000Z"),
            boatName: null,
            tripRole: null,
            gap: null,
            crewCallAt: null,
          },
        ]}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Your week" })).toBeInTheDocument();
    expect(screen.getByText("Reef Runner · Morning reef")).toBeInTheDocument();
    expect(screen.getByText(/8:30\sAM · Captain/)).toBeInTheDocument();
    expect(screen.getByText(t("today.actionKind.uncrewedDeparture"))).toBeInTheDocument();
    expect(screen.getByText(/On the crew/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Morning reef" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t-1",
    );
  });

  /** Dive-domain review of layer 8, F11: advice is not painted as a warning (`GAP_TONE`). */
  it("paints a gap in the tone the staffing week gives it", () => {
    const words = staffingGapWords(t);
    render(
      <YourWeekList
        lines={[
          {
            tripId: "t-1",
            title: "Morning reef",
            startsAt: new Date("2026-10-15T12:30:00.000Z"),
            boatName: null,
            tripRole: "divemaster",
            gap: "crew_below_target",
            crewCallAt: null,
          },
          {
            tripId: "t-2",
            title: "Afternoon wreck",
            startsAt: new Date("2026-10-16T18:00:00.000Z"),
            boatName: null,
            tripRole: "captain",
            gap: "no_instructor",
            crewCallAt: null,
          },
        ]}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByText(words.crew_below_target)).toHaveClass("text-muted");
    expect(screen.getByText(words.crew_below_target)).not.toHaveClass("text-warning-strong");
    expect(screen.getByText(words.no_instructor)).toHaveClass("text-warning-strong");
  });
});

/** "At the dock 6:15 AM · leaves 7:00 AM" (fifth-loop ideas, item 47). */
describe("YourWeekList's dock time", () => {
  it("says when to be at the dock and when the boat leaves", () => {
    render(
      <YourWeekList
        lines={[
          {
            tripId: "t-1",
            title: "Morning reef",
            startsAt: new Date("2026-10-15T11:00:00.000Z"),
            boatName: null,
            tripRole: "divemaster",
            gap: null,
            crewCallAt: new Date("2026-10-15T10:15:00.000Z"),
          },
        ]}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        locale="en-US"
        t={t}
      />,
    );
    expect(
      screen.getByText(/At the dock 6:15\sAM · leaves 7:00\sAM · Divemaster/),
    ).toBeInTheDocument();
  });
});
