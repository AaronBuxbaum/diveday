// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controls, view } from "./section-fixtures";
import { offlineRollCallRowId } from "./shared";
import { OfflineTripFoot } from "./TripFoot";

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

  it("jumps a face still to call to the row the roll call above drew", () => {
    const row = document.createElement("div");
    row.id = offlineRollCallRowId("b-priya");
    row.scrollIntoView = vi.fn();
    document.body.append(row);
    render(<OfflineTripFoot view={view()} controls={controls()} tripId="trip-1" />);
    const face = screen
      .getAllByRole("button")
      .find((button) => button.querySelector(`[title="Priya Shah"]`));
    if (!face) throw new Error("a face for Priya expected");
    fireEvent.click(face);
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
    row.remove();
  });
});
