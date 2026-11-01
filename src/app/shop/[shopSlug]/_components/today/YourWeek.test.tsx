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
            crewCall: null,
          },
          {
            tripId: "t-2",
            title: "Afternoon wreck",
            startsAt: new Date("2026-10-16T18:00:00.000Z"),
            boatName: null,
            tripRole: null,
            gap: null,
            crewCall: null,
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
            crewCall: null,
          },
          {
            tripId: "t-2",
            title: "Afternoon wreck",
            startsAt: new Date("2026-10-16T18:00:00.000Z"),
            boatName: null,
            tripRole: "captain",
            gap: "no_instructor",
            crewCall: null,
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

/**
 * "At the dock 6:15 AM · leaves 7:00 AM" (fifth-loop ideas, item 47), and
 * "Divers at the dock …" when no shift of theirs says when the crew are due
 * (dive-domain review of layer r5-4, fix 4).
 */
describe("YourWeekList's dock time", () => {
  const line = (crewCall: { at: Date; source: "shift" | "crew" | "divers" }) => ({
    tripId: "t-1",
    title: "Morning reef",
    startsAt: new Date("2026-10-15T11:00:00.000Z"),
    boatName: null,
    tripRole: "divemaster" as const,
    gap: null,
    crewCall,
  });
  const show = (crewCall: { at: Date; source: "shift" | "crew" | "divers" }) =>
    render(
      <YourWeekList
        lines={[line(crewCall)]}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        locale="en-US"
        t={t}
      />,
    );

  it("says when their own shift has them at the dock, and when the boat leaves", () => {
    show({ at: new Date("2026-10-15T10:15:00.000Z"), source: "shift" });
    expect(
      screen.getByText(/(?<!Divers )At the dock 6:15\sAM · leaves 7:00\sAM · Divemaster/),
    ).toBeInTheDocument();
  });

  it("says the shop's crew time as the crew's own (H-20261022-crew-arrive-before-divers)", () => {
    show({ at: new Date("2026-10-15T10:00:00.000Z"), source: "crew" });
    expect(
      screen.getByText(/(?<!Divers )At the dock 6:00\sAM · leaves 7:00\sAM · Divemaster/),
    ).toBeInTheDocument();
  });

  it("names the call's own day when it falls the evening before the departure", () => {
    // Thu Oct 15 04:30 EDT departure; crew called Wed 22:30 EDT.
    render(
      <YourWeekList
        lines={[
          {
            ...line({ at: new Date("2026-10-15T02:30:00.000Z"), source: "crew" }),
            startsAt: new Date("2026-10-15T08:30:00.000Z"),
          },
        ]}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        locale="en-US"
        t={t}
      />,
    );
    expect(
      screen.getByText(/At the dock Wednesday 10:30\sPM · leaves 4:30\sAM · Divemaster/),
    ).toBeInTheDocument();
  });

  it("names the divers' call as theirs when no shift says the crew's", () => {
    show({ at: new Date("2026-10-15T10:30:00.000Z"), source: "divers" });
    expect(
      screen.getByText(/Divers at the dock 6:30\sAM · leaves 7:00\sAM · Divemaster/),
    ).toBeInTheDocument();
  });
});
