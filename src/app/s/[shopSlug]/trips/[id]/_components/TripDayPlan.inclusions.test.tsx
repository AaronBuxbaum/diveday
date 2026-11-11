// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { TripDayPlan } from "./TripDayPlan";

afterEach(cleanup);

it("leaves included gear to booking facts while retaining the course timeline", () => {
  const props: ComponentProps<typeof TripDayPlan> = {
    briefings: [],
    shop: {
      slug: "blue-mantis",
      timezone: "America/New_York",
      name: "Blue Mantis Divers",
      depthUnit: "meters",
    },
    locale: DEFAULT_DIVER_LOCALE,
    profile: {
      rhythm: {
        dockCallMinutes: 30,
        gearSetupMinutes: 0,
        briefingMinutes: 15,
        boatRideMinutes: 20,
        bottomTimeMinutes: 45,
        surfaceIntervalMinutes: 60,
      },
      depthUnit: "meters",
      diveMode: "boat",
      dayCount: 1,
      course: {
        scheduleDays: [{ title: "Your afternoon", items: ["Shallow water practice"] }],
        includedRentalKinds: ["wetsuit"],
      },
    },
  };
  const { rerender } = render(<TripDayPlan {...props} showIncludedGear={false} />);
  expect(screen.getByText("Your afternoon")).toBeInTheDocument();
  expect(screen.queryByText("Included with the course: Wetsuit.")).not.toBeInTheDocument();
  rerender(<TripDayPlan {...props} />);
  expect(screen.getByText("Included with the course: Wetsuit.")).toBeInTheDocument();
});
