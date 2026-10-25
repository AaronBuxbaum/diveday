// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { controls, view } from "./section-fixtures";
import { offlineRollCallRowId } from "./shared";
import { OfflineTripFoot, stillToCallLine } from "./TripFoot";

afterEach(cleanup);

describe("OfflineTripFoot", () => {
  it("points the live manifest link at this trip and checkpoint", () => {
    const { t } = controls();
    render(<OfflineTripFoot view={view()} controls={controls()} tripId="trip-1" />);
    const live = screen.getByRole("link", {
      name: t("shared.offlineManifest.single.openLiveManifest"),
    });
    expect(live.getAttribute("href")).toBe(
      "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=departure",
    );
  });

  it("links one still-to-board line to the first uncalled diver's row (B02)", () => {
    render(<OfflineTripFoot view={view()} controls={controls()} tripId="trip-1" />);
    const line = screen.getByRole("link", { name: /^Still to board: \d+$/ });
    expect(line.getAttribute("href")).toBe(`#${offlineRollCallRowId("b-priya")}`);
  });
});

describe("stillToCallLine", () => {
  it("says nothing when nobody is left to call, never '0'", () => {
    expect(stillToCallLine([])).toBeNull();
  });

  it("counts everyone still to call and points at the first in roster order", () => {
    expect(stillToCallLine([{ bookingId: "b-2" }, { bookingId: "b-1" }])).toEqual({
      count: 2,
      href: `#${offlineRollCallRowId("b-2")}`,
    });
  });

  it("counts a soul with no name like any other", () => {
    expect(stillToCallLine([{ bookingId: "b-nameless" }])?.count).toBe(1);
  });
});
