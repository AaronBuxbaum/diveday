// @vitest-environment jsdom
// i18n-exempt-file: test; it reads the English bundle the device falls back to.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OfflineManifestEnvelope, OfflineRollCallEvent } from "@/lib/offline-manifests";
import { OfflineCheckpointNav } from "./CheckpointNav";
import { controls, savedCopy } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

/**
 * **The offline checkpoint switch asks before it goes on** (issue #2599): the
 * live page's `CheckpointGapGuard` for a copy read with no signal. A warning,
 * never a refusal, and read off this device's own taps.
 */

/** Two planned dives, so the copy carries a dock count and two after-dive ones. */
function twoDiveCopy(events: OfflineRollCallEvent[] = []): OfflineManifestEnvelope {
  const copy = savedCopy();
  const [dock] = copy.snapshot.manifests;
  const at = (checkpoint: "departure" | "after_dive_1" | "after_dive_2") => ({
    ...dock,
    trip: { ...dock.trip, plannedDives: 2 },
    checkpoint,
  });
  return {
    ...copy,
    snapshot: {
      ...copy.snapshot,
      manifests: [at("departure"), at("after_dive_1"), at("after_dive_2")],
    },
    events,
  };
}

function tap(
  checkpoint: OfflineRollCallEvent["checkpoint"],
  who: { bookingId: string } | { crewPersonId: string },
  status: "boarded" | "not_boarded" = "boarded",
): OfflineRollCallEvent {
  const subject = "bookingId" in who ? who.bookingId : who.crewPersonId;
  return {
    clientEventId: `${checkpoint}-${subject}`,
    snapshotId: "snap-trip-1",
    snapshotSavedAt: "2026-08-01T12:00:00.000Z",
    tripId: "trip-1",
    checkpoint,
    status,
    occurredAt: "2026-08-01T14:30:00.000Z",
    syncStatus: "pending",
    ...who,
  };
}

function open(
  envelope: OfflineManifestEnvelope,
  shown: "departure" | "after_dive_1" | "after_dive_2",
) {
  const view = offlineTripView(envelope, shown);
  if (!view) throw new Error("the fixture carries a manifest");
  const trip = controls();
  render(<OfflineCheckpointNav view={view} controls={trip} />);
  return trip;
}

const priyaAndMarcusAboard = (checkpoint: "after_dive_1") => [
  tap(checkpoint, { bookingId: "b-priya" }),
  tap(checkpoint, { bookingId: "b-marcus" }),
];

afterEach(cleanup);

describe("OfflineCheckpointNav", () => {
  it("asks first when the count before is open, and names the people unmarked", () => {
    const trip = open(twoDiveCopy(), "after_dive_1");
    fireEvent.click(screen.getByRole("button", { name: /after dive 2/i }));
    expect(screen.getByRole("alert").textContent).toBe("2 people not marked after dive 1.");
    expect(trip.setCheckpoint).not.toHaveBeenCalled();
  });

  it("leaves crew with no dock result out of the count", () => {
    open(twoDiveCopy([tap("after_dive_1", { bookingId: "b-priya" })]), "after_dive_1");
    fireEvent.click(screen.getByRole("button", { name: /after dive 2/i }));
    expect(screen.getByRole("alert").textContent).toBe("1 person not marked after dive 1.");
  });

  it("counts a crew member boarded at the dock who has no result after the dive", () => {
    open(
      twoDiveCopy([
        ...priyaAndMarcusAboard("after_dive_1"),
        tap("departure", { crewPersonId: "crew-dana" }),
      ]),
      "after_dive_1",
    );
    fireEvent.click(screen.getByRole("button", { name: /after dive 2/i }));
    expect(screen.getByRole("alert").textContent).toBe("1 crew not marked after dive 1.");
  });

  // Marked, but not back aboard: said on its own, never as "not marked"
  // (dive-domain review, 2026-10-16).
  it("names a diver recorded not back aboard as not back aboard", () => {
    open(
      twoDiveCopy([
        tap("after_dive_1", { bookingId: "b-priya" }),
        tap("after_dive_1", { bookingId: "b-marcus" }, "not_boarded"),
      ]),
      "after_dive_1",
    );
    fireEvent.click(screen.getByRole("button", { name: /after dive 2/i }));
    expect(screen.getByRole("alert").textContent).toBe("1 person not back aboard after dive 1.");
  });

  it("opens straight away when nobody is unmarked", () => {
    const trip = open(twoDiveCopy(priyaAndMarcusAboard("after_dive_1")), "after_dive_1");
    fireEvent.click(screen.getByRole("button", { name: /after dive 2/i }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(trip.setCheckpoint).toHaveBeenCalledWith("after_dive_2");
  });

  it("never asks about the dock count, and never refuses", () => {
    const trip = open(twoDiveCopy(), "after_dive_2");
    fireEvent.click(screen.getByRole("button", { name: /after dive 1/i }));
    expect(screen.queryByRole("alert")).toBeNull();
    // The first after-dive count settles who is aboard whatever the dock said.
    expect(trip.setCheckpoint).toHaveBeenCalledWith("after_dive_1");
  });

  it("goes on after Open anyway, and back to the open count after Back", () => {
    const trip = open(twoDiveCopy(), "after_dive_1");
    fireEvent.click(screen.getByRole("button", { name: /after dive 2/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open anyway" }));
    expect(trip.setCheckpoint).toHaveBeenCalledWith("after_dive_2");
    fireEvent.click(screen.getByRole("button", { name: /after dive 2/i }));
    fireEvent.click(screen.getByRole("button", { name: "Back to dive 1" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps saying the line on the checkpoint it opened", () => {
    const trip = open(twoDiveCopy([tap("after_dive_1", { bookingId: "b-priya" })]), "after_dive_2");
    expect(screen.getByText(/1 person not marked after dive 1\./).textContent).toContain(
      "Back to dive 1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to dive 1" }));
    expect(trip.setCheckpoint).toHaveBeenCalledWith("after_dive_1");
  });

  it("says nothing on a copy whose counts are all in", () => {
    open(twoDiveCopy(priyaAndMarcusAboard("after_dive_1")), "after_dive_2");
    expect(screen.queryByText(/not marked/)).toBeNull();
  });
});
