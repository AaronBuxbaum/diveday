// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { controls, savedCopy } from "./section-fixtures";
import { OfflineTripScreen } from "./TripScreen";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

it.each(["unassigned", "ashore", "legacy"] as const)(
  "explains the actual %s crew cause when opening attention",
  (cause) => {
    const copy = savedCopy();
    const manifest = copy.snapshot.manifests[0];
    if (cause === "unassigned") manifest.crew = [];
    if (cause === "ashore")
      manifest.crew[0].rollCall = {
        state: "not_boarded",
        occurredAt: copy.snapshot.savedAt,
        recordedByName: "Dana",
      };
    if (cause === "legacy") delete manifest.crew[0].id;
    const view = offlineTripView(copy, "departure");
    if (!view) throw new Error("expected saved departure");
    const ctx = controls();
    render(
      <OfflineTripScreen
        view={view}
        controls={ctx}
        tripId="trip-1"
        foreignPendingChanges={false}
        noteLossMessage=""
        shellVersionCopy={{ updateBanner: "", refreshButton: "", staleBanner: "" }}
        discardNotice={null}
        reconcile={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
    const message =
      cause === "legacy"
        ? ctx.t("shared.offlineManifest.single.crewOlderCopy", { count: 1 })
        : ctx.t(
            cause === "unassigned"
              ? "shared.offlineManifest.single.crewNoneAssigned"
              : "shared.offlineManifest.single.crewNoneAboard",
          );
    expect(screen.getByText(message)).toBeVisible();
    expect(ctx.record).not.toHaveBeenCalled();
  },
);

it.each(["capacity", "prior missing"] as const)(
  "prioritizes %s attention even when the current individual count is complete",
  (cause) => {
    const copy = savedCopy();
    const departure = copy.snapshot.manifests[0];
    for (const row of [...departure.divers, ...departure.crew])
      row.rollCall = {
        state: "boarded",
        occurredAt: copy.snapshot.savedAt,
        recordedByName: "Dana",
      };
    if (cause === "capacity") departure.trip.certifiedTotalPersons = 2;
    if (cause === "prior missing") {
      departure.trip.plannedDives = 2;
      const previous = structuredClone(departure);
      previous.checkpoint = "after_dive_1";
      previous.divers[0].rollCall = {
        state: "not_boarded",
        occurredAt: copy.snapshot.savedAt,
        recordedByName: "Dana",
      };
      const current = structuredClone(departure);
      current.checkpoint = "after_dive_2";
      copy.snapshot.manifests = [departure, previous, current];
    }
    const view = offlineTripView(copy, cause === "capacity" ? "departure" : "after_dive_2");
    if (!view) throw new Error("expected saved count");
    expect(view.rollCallComplete).toBe(true);
    const gap = view.previousGaps.get(view.checkpoint);
    if (cause === "prior missing") expect(gap).toMatchObject({ kind: "unmarked", missing: 1 });
    else expect(view.overTotalPersons).toEqual({ aboard: 3, limit: 2 });
    const ctx = controls();
    render(
      <OfflineTripScreen
        view={view}
        controls={ctx}
        tripId="trip-1"
        foreignPendingChanges={false}
        noteLossMessage=""
        shellVersionCopy={{ updateBanner: "", refreshButton: "", staleBanner: "" }}
        discardNotice={null}
        reconcile={async () => {}}
      />,
    );
    expect(screen.queryByText(ctx.t("manifest.deck.complete"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review reports" }));
    expect(screen.queryByText(ctx.t("manifest.deck.complete"))).toBeNull();
    expect(ctx.record).not.toHaveBeenCalled();
  },
);
