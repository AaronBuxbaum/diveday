// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
          },
          {
            tripId: "t-2",
            title: "Afternoon wreck",
            startsAt: new Date("2026-10-16T18:00:00.000Z"),
            boatName: null,
            tripRole: null,
            gap: null,
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
});
