import { describe, expect, it } from "vitest";
import {
  diveSiteTemplateDiff,
  diveSiteTemplateSnapshot,
  diveSiteTemplateSnapshotFromSite,
  mergedDiveSiteTemplateSnapshot,
} from "./dive-site-template-sync";

const source = {
  description: "The original briefing.",
  locationName: "Key Largo",
  forecastLatitude: 25,
  forecastLongitude: -80,
  marineLife: "Parrotfish",
  difficultyLevel: "beginner" as const,
  depthRange: "6–12 m",
  maxDepthMeters: 12,
  currentNote: "Usually gentle.",
  divePlan: "Follow the ridge.",
  fitTone: "welcoming" as const,
  conservationNote: "Use mooring buoys.",
  landmarks: [{ name: "The ridge", kind: "reefFormation" as const, note: "Turn here." }],
  creatureSlugs: ["blue-tang"],
};

describe("dive-site template sync", () => {
  it("preserves fields a shop changed while taking untouched fields forward", () => {
    const baseline = diveSiteTemplateSnapshot(source);
    const current = diveSiteTemplateSnapshotFromSite({
      ...baseline,
      description: "Our local briefing.",
      divePlan: baseline.divePlan,
    });
    const latest = diveSiteTemplateSnapshot({
      ...source,
      description: "The expanded published briefing.",
      divePlan: "Follow the ridge, then return along the sand.",
    });

    const diff = diveSiteTemplateDiff(current, baseline, latest);
    expect(diff.map((change) => [change.field, change.shopChanged])).toEqual([
      ["description", true],
      ["divePlan", false],
    ]);
    const merged = mergedDiveSiteTemplateSnapshot(current, baseline, latest, "preserve-shop-edits");
    expect(merged.description).toBe("Our local briefing.");
    expect(merged.divePlan).toBe("Follow the ridge, then return along the sand.");
    expect(merged.conservationNote).toBe("Use mooring buoys.");
  });

  it("can intentionally replace template-managed copy", () => {
    const baseline = diveSiteTemplateSnapshot(source);
    const current = diveSiteTemplateSnapshotFromSite({
      ...baseline,
      description: "Our local briefing.",
      creatures: ["blue-tang"],
    });
    const latest = diveSiteTemplateSnapshot({
      ...source,
      description: "The expanded published briefing.",
      creatureSlugs: ["blue-tang", "southern-stingray"],
    });
    const merged = mergedDiveSiteTemplateSnapshot(
      current,
      baseline,
      latest,
      "replace-template-copy",
    );
    expect(merged.description).toBe(latest.description);
    expect(merged.creatures).toEqual(["blue-tang", "southern-stingray"]);
  });
});
