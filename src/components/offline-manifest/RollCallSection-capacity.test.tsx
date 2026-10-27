// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { OfflineRollCallSection } from "./RollCallSection";
import { controls, diver, savedCopy } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

for (const locale of ["en-US", "es-ES"] as const) {
  describe(`offline certified total warning (${locale})`, () => {
    it("states actual persons and limit in danger ink while keeping boarding controls", () => {
      const copy = savedCopy();
      const manifest = copy.snapshot.manifests[0];
      if (!manifest) throw new Error("manifest missing");
      manifest.trip.certifiedTotalPersons = 2;
      const aboard = {
        state: "boarded" as const,
        occurredAt: copy.snapshot.savedAt,
        recordedByName: "Captain",
      };
      manifest.divers = manifest.divers.map((diver) => ({ ...diver, rollCall: aboard }));
      manifest.divers.push(diver("awaiting-passenger", "Awaiting Passenger"));
      manifest.summary.totalDivers = manifest.divers.length;
      manifest.crew = manifest.crew.map((member) => ({ ...member, rollCall: aboard }));
      const view = offlineTripView(copy, "departure");
      if (!view) throw new Error("view missing");
      const t = offlineManifestTranslator(locale);
      render(<OfflineRollCallSection view={view} controls={{ ...controls(), t, locale }} />);
      const warning = screen.getByText(
        t("manifest.headCountOverTotalPersonsAboard", { aboard: 3, limit: 2 }),
      );
      expect(warning).toHaveAttribute("role", "status");
      expect(warning).toHaveClass("text-danger", "border-danger", "bg-danger-tint");
      expect(
        screen.getAllByRole("button", { name: t("shared.offlineManifest.single.markBoarded") })
          .length,
      ).toBeGreaterThan(0);
    });
  });
}

it("shows the depth check from a saved mixed-training manifest", () => {
  const copy = savedCopy();
  const manifest = copy.snapshot.manifests[0];
  if (!manifest?.divers[0] || !manifest.divers[1]) throw new Error("divers missing");
  manifest.divers[0].trainingDive = { courseTitle: "Intro", instructorAboard: false, intro: true };
  manifest.divers[1].trainingDive = {
    courseTitle: "Open Water",
    instructorAboard: false,
    intro: false,
  };
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("view missing");
  render(<OfflineRollCallSection view={view} controls={controls()} />);
  expect(
    screen.getByText(
      /If intro participants dive with other students, check the intro program’s depth limit/,
    ),
  ).toBeVisible();
});

it("still prompts for older saved copies with two course marks of unknown type", () => {
  const copy = savedCopy();
  const manifest = copy.snapshot.manifests[0];
  if (!manifest?.divers[0] || !manifest.divers[1]) throw new Error("divers missing");
  manifest.divers[0].trainingDive = { courseTitle: "Intro", instructorAboard: false };
  manifest.divers[1].trainingDive = { courseTitle: "Open Water", instructorAboard: false };
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("view missing");
  render(<OfflineRollCallSection view={view} controls={controls()} />);
  expect(screen.getByText(/intro program’s depth limit/)).toBeVisible();
});

it("does not use a legacy held seat’s course in the depth warning", () => {
  const copy = savedCopy();
  const manifest = copy.snapshot.manifests[0];
  if (!manifest?.divers[0] || !manifest.divers[1]) throw new Error("divers missing");
  manifest.divers[0].readiness = {
    status: "blocked",
    blockers: [{ code: "identity_unconfirmed", text: "Confirm identity" }],
  };
  manifest.divers[0].trainingDive = { courseTitle: "Intro", instructorAboard: false, intro: true };
  manifest.divers[1].trainingDive = {
    courseTitle: "Open Water",
    instructorAboard: false,
    intro: false,
  };
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("view missing");
  render(<OfflineRollCallSection view={view} controls={controls()} />);
  expect(screen.queryByText(/intro program’s depth limit/)).not.toBeInTheDocument();
});

it("does not expose a stale advisory attached to a held identity", () => {
  const copy = savedCopy();
  const person = copy.snapshot.manifests[0]?.divers[0];
  if (!person) throw new Error("diver missing");
  person.readiness = {
    status: "blocked",
    blockers: [{ code: "identity_unconfirmed", text: "Confirm identity" }],
  };
  person.safetyAdvisoryText = "Check this diver’s dive plan and supervision with the crew.";
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("view missing");
  render(<OfflineRollCallSection view={view} controls={controls()} />);
  expect(screen.queryByText(person.safetyAdvisoryText)).not.toBeInTheDocument();
});
