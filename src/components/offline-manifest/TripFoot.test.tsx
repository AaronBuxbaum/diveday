// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { controls, view } from "./section-fixtures";
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

  it("offers the live destination without links to unmounted roll-call rows", () => {
    const { t } = controls();
    render(<OfflineTripFoot view={view()} controls={controls()} tripId="trip-1" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(t("shared.offlineManifest.single.openLiveManifest"));
    expect(screen.queryByRole("link", { name: /^Still to board:/ })).not.toBeInTheDocument();
  });
});
