// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { TripMoreActions } from "./TripMoreActions";

vi.mock("../details-actions", () => {
  const action = async () => {};
  return {
    applySeriesDetailsAction: action,
    cancelSeriesAction: action,
    setSeriesRepeatAction: action,
    cancelTripAction: action,
  };
});
vi.mock("./SeriesSection", () => ({ SeriesMoreActions: () => <p>series-actions</p> }));
vi.mock("./BlowoutDoors", () => ({ BlowoutDoors: () => <p>blowout</p> }));

const t = staffTranslator("en-US");

afterEach(cleanup);

function show(over: Partial<React.ComponentProps<typeof TripMoreActions>> = {}) {
  return render(
    <TripMoreActions
      shop={{} as never}
      personId="person"
      shopSlug="blue-mantis"
      tripId="trip-1"
      startsAt={new Date("2026-07-25T12:00:00Z")}
      series={null}
      lifecycleStatus={undefined}
      locale="en-US"
      t={t}
      {...over}
    />,
  );
}

describe("TripMoreActions", () => {
  it("holds the blow-out doors and the cancel behind its own confirm, shut at rest", () => {
    const { container } = show();
    expect(screen.getByText("blowout")).toBeTruthy();
    expect(screen.getByRole("button", { name: t("trips.about.cancel") })).toBeTruthy();
    expect(screen.queryByText("series-actions")).toBeNull();
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("offers the series doors only with a series in hand", () => {
    show({ series: { id: "s1", futureScheduledCount: 3, endsOn: null } as never });
    expect(screen.getByText("series-actions")).toBeTruthy();
  });

  it("opens itself on a lifecycle form's report", () => {
    const { container } = show({
      lifecycleStatus: { form: "lifecycle", tone: "danger", text: "Could not cancel." },
    });
    expect(container.querySelector("details")?.open).toBe(true);
    expect(screen.getByText("Could not cancel.")).toBeTruthy();
  });
});
