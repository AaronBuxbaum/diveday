// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { OfflineRollCallSection } from "./RollCallSection";
import { controls, diver, savedCopy } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

const words = offlineManifestTranslator(DEFAULT_DIVER_LOCALE)("manifest.decompressionReminder");

function draw(
  edit: (manifest: ReturnType<typeof savedCopy>["snapshot"]["manifests"][number]) => void,
  checkpoint: "departure" | "after_dive_1" = "departure",
) {
  const copy = savedCopy();
  const manifest = copy.snapshot.manifests[0];
  manifest.checkpoint = checkpoint;
  edit(manifest);
  const view = offlineTripView(copy, checkpoint);
  if (!view) throw new Error("the fixture carries a manifest");
  return render(<OfflineRollCallSection view={view} controls={controls()} />);
}

describe("the decompression reminder on the offline copy", () => {
  it("shows once on a marked departure with divers", () => {
    draw((m) => {
      m.trip.exceedsNoDecoLimits = true;
    });
    expect(screen.getAllByText(words)).toHaveLength(1);
  });

  it("is silent on a copy saved before the flag existed", () => {
    draw(() => {});
    expect(screen.queryByText(words)).toBeNull();
  });

  it("is silent for snorkelers and riders only, with no guide in the water", () => {
    draw((m) => {
      m.trip.exceedsNoDecoLimits = true;
      m.crew = [{ id: "c", fullName: "Cal", roles: ["captain"] }];
      m.divers = [{ ...diver("b1", "Sam"), participantType: "snorkeler" }];
    });
    expect(screen.queryByText(words)).toBeNull();
  });

  it("shows for a divemaster beside snorkelers only", () => {
    draw((m) => {
      m.trip.exceedsNoDecoLimits = true;
      m.divers = [{ ...diver("b1", "Sam"), participantType: "snorkeler" }];
    });
    expect(screen.getAllByText(words)).toHaveLength(1);
  });

  it("is silent once the last diver is released", () => {
    draw((m) => {
      m.trip.exceedsNoDecoLimits = true;
      m.crew = [];
      m.divers = [{ ...diver("b1", "Sam"), notHere: true }];
    });
    expect(screen.queryByText(words)).toBeNull();
  });

  it("is silent after a dive", () => {
    draw((m) => {
      m.trip.exceedsNoDecoLimits = true;
    }, "after_dive_1");
    expect(screen.queryByText(words)).toBeNull();
  });
});
