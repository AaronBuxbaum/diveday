// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { RollCallCausalContext } from "@/lib/roll-call-causality";
import { controls, savedCopy } from "./section-fixtures";
import { OfflineTripScreen } from "./TripScreen";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

it("offers reconciliation on the full offline screen for an aboard/ashore departure conflict without another alarm", () => {
  const envelope = savedCopy();
  const manifest = envelope.snapshot.manifests[0];
  const diver = manifest?.divers[0];
  const crew = manifest?.crew[0];
  if (!manifest || !diver || !crew) throw new Error("expected saved roster");
  const context: RollCallCausalContext = {
    meetingDay: 0,
    conflict: true,
    orderingUnknown: false,
    unknownMeetingDay: false,
    observedEvidenceIds: [
      "server:10000000-0000-4000-8000-000000000001",
      "server:10000000-0000-4000-8000-000000000002",
    ],
    evidence: (["boarded", "not_boarded"] as const).map((status, index) => ({
      id: `server:10000000-0000-4000-8000-00000000000${index + 1}`,
      status,
      recordedByName: index ? "Lee" : "Dana",
      occurredAt: "2026-08-01T12:00:00.000Z",
      meetingDay: 0,
      observedEvidenceIds: [],
      note: null,
    })),
  };
  diver.rollCallContext = context;
  diver.rollCall = {
    state: "boarded",
    occurredAt: "2026-08-01T12:00:00.000Z",
    recordedByName: "Dana",
  };
  crew.rollCall = {
    state: "boarded",
    occurredAt: "2026-08-01T12:00:00.000Z",
    recordedByName: "Dana",
  };
  const view = offlineTripView(envelope, "departure");
  if (!view) throw new Error("expected departure view");
  expect(view.localStates[0]).toMatchObject({ state: "boarded", evidenceConflict: true });
  expect(view.notBackAboard).toBe(0);
  expect(view.crewMissing).toBe(false);
  expect(view.rejected).toBe(0);
  expect(view.crewWithoutId).toBe(0);
  expect(view.completeness.crewReason).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "Review reports" }));
  const details = screen.getByText("More", { selector: "summary" }).closest("details");
  const summary = screen
    .getAllByText(ctx.t("manifest.conflicts.heading", { name: diver.fullName }))
    .find((element) => !details?.contains(element));
  expect(summary).toBeVisible();
  const panel = summary?.closest("details");
  if (!panel) throw new Error("expected attention reconciliation panel outside Details");
  expect(
    within(panel).getByRole("button", { name: ctx.t("manifest.conflicts.confirmAboard") }),
  ).toBeVisible();
  expect(ctx.record).not.toHaveBeenCalled();
});
