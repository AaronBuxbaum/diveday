// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { checkpointGapLine } from "@/components/checkpoint-gap-words";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { OfflineDeckRollCall } from "./DeckRollCall";
import { controls, savedCopy } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

function derived(change: (copy: OfflineManifestEnvelope) => void) {
  const copy = savedCopy();
  change(copy);
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("expected saved departure");
  return view;
}

it("keeps the current capacity warning visible outside Details and removes it when the count is corrected", () => {
  const view = derived((copy) => {
    const manifest = copy.snapshot.manifests[0];
    manifest.trip.certifiedTotalPersons = 2;
    for (const row of [...manifest.divers, ...manifest.crew])
      row.rollCall = {
        state: "boarded",
        occurredAt: copy.snapshot.savedAt,
        recordedByName: "Dana",
      };
  });
  if (!view.overTotalPersons) throw new Error("expected overloaded fixture");
  const ctx = controls();
  const text = ctx.t("manifest.headCountOverTotalPersonsAboard", view.overTotalPersons);
  const { rerender } = render(<OfflineDeckRollCall view={view} controls={ctx} details={null} />);
  expect(screen.getByText(text)).toBeVisible();
  rerender(
    <OfflineDeckRollCall
      view={{ ...view, overTotalPersons: null }}
      controls={ctx}
      details={null}
    />,
  );
  expect(screen.queryByText(text)).toBeNull();
});

it("keeps mixed-training and decompression safety reminders visible before opening Details", () => {
  const view = derived((copy) => {
    const manifest = copy.snapshot.manifests[0];
    manifest.trip.exceedsNoDecoLimits = true;
    manifest.divers[0].trainingDive = {
      courseTitle: "Intro",
      instructorAboard: false,
      intro: true,
    };
    manifest.divers[1].trainingDive = {
      courseTitle: "Open Water",
      instructorAboard: true,
      intro: false,
    };
  });
  const ctx = controls();
  render(<OfflineDeckRollCall view={view} controls={ctx} details={null} />);
  expect(screen.getByText(ctx.t("manifest.mixedTrainingDepthWarning"))).toBeVisible();
  expect(screen.getByText(ctx.t("manifest.decompressionReminder"))).toBeVisible();
});

it("retains participant split and the saved buddy reference caveat in Details", () => {
  const view = derived((copy) => {
    copy.snapshot.manifests[0].divers[1].participantType = "rider";
    copy.snapshot.manifests[0].divers[0].buddyTeamNames = ["Marcus Reed"];
  });
  const ctx = controls();
  render(<OfflineDeckRollCall view={view} controls={ctx} details={null} />);
  fireEvent.click(screen.getByText("Details", { selector: "summary" }));
  expect(screen.getByText(/1 diver.*1 rider/)).toBeVisible();
  expect(screen.getByText(ctx.t("shared.offlineManifest.single.buddyReadOnlyHere"))).toBeVisible();
  expect(ctx.record).not.toHaveBeenCalled();
});

it("shows the pending count once and omits redundant normal saved-copy prose", () => {
  const view = { ...derived(() => {}), freshness: "current" as const, pending: 1 };
  const ctx = controls();
  const pending = ctx.t("shared.offlineManifest.reconcile.pendingWaiting", { count: 1 });
  ctx.message = pending;
  render(<OfflineDeckRollCall view={view} controls={ctx} details={null} />);
  expect(screen.getAllByText(pending)).toHaveLength(1);
  expect(screen.queryByText(ctx.t("manifest.deck.savedCopy"))).toBeNull();
  expect(screen.getByText(ctx.t("manifest.deck.copyCaveat"))).toBeVisible();
});

it("preserves unanswered, stale and actual device-failure notices", () => {
  const view = { ...derived(() => {}), freshness: "stale" as const };
  const ctx = {
    ...controls(),
    servedWithoutAnswer: true,
    message: "A saved observation could not sync",
  };
  render(<OfflineDeckRollCall view={view} controls={ctx} details={null} />);
  expect(
    screen.getByText(ctx.t("shared.connectivity.unansweredWithCopy"), { exact: false }),
  ).toBeVisible();
  expect(
    screen.getByText(ctx.t("shared.offlineManifest.freshnessPill.stale"), { exact: false }),
  ).toBeVisible();
  expect(screen.getByText(ctx.message)).toBeVisible();
});

it.each([true, false])(
  "keeps prior missing=%s visible while ordinary earlier unmarked counts stay in Details",
  (missing) => {
    const copy = savedCopy();
    const departure = copy.snapshot.manifests[0];
    departure.trip.plannedDives = 2;
    const previous = structuredClone(departure);
    previous.checkpoint = "after_dive_1";
    previous.divers[0].rollCall = missing
      ? { state: "not_boarded", occurredAt: copy.snapshot.savedAt, recordedByName: "Dana" }
      : undefined;
    const current = structuredClone(departure);
    current.checkpoint = "after_dive_2";
    copy.snapshot.manifests = [departure, previous, current];
    const view = offlineTripView(copy, "after_dive_2");
    if (!view) throw new Error("expected later checkpoint");
    const gap = view.previousGaps.get("after_dive_2");
    if (gap?.kind !== "unmarked") throw new Error("expected earlier gap");
    expect(gap.missing).toBe(missing ? 1 : 0);
    const ctx = controls();
    render(<OfflineDeckRollCall view={view} controls={ctx} details={null} />);
    const text = checkpointGapLine(ctx.t, gap);
    if (missing) {
      expect(screen.getByText(text, { exact: false })).toBeVisible();
      fireEvent.click(
        screen.getByRole("button", { name: ctx.t("manifest.checkpointGap.back", { dive: 1 }) }),
      );
      expect(ctx.setCheckpoint).toHaveBeenCalledWith("after_dive_1");
    } else expect(screen.queryByText(text, { exact: false })).toBeNull();
    expect(ctx.record).not.toHaveBeenCalled();
  },
);
