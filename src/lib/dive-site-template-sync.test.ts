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
  depthMinMeters: 6,
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
    expect(diff.some((change) => change.field === "conservationNote")).toBe(false);
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
    expect(merged.conservationNote).toBe("Use mooring buoys.");
  });

  it("preserves an empty local conservation note for either update mode", () => {
    const baseline = diveSiteTemplateSnapshot(source);
    const current = diveSiteTemplateSnapshotFromSite({ ...baseline, conservationNote: "" });
    const latest = diveSiteTemplateSnapshot({ ...source, conservationNote: "New template note." });

    expect(diveSiteTemplateDiff(current, baseline, latest)).toEqual([]);
    expect(
      mergedDiveSiteTemplateSnapshot(current, baseline, latest, "preserve-shop-edits")
        .conservationNote,
    ).toBe("");
    expect(
      mergedDiveSiteTemplateSnapshot(current, baseline, latest, "replace-template-copy")
        .conservationNote,
    ).toBe("");
  });

  it("never merges a shop's shallow end below a deeper point the template moved", () => {
    const baseline = diveSiteTemplateSnapshot(source);
    // The shop edited the shallow end to 10 m; the template then shortened the site to 9 m.
    const current = diveSiteTemplateSnapshotFromSite({ ...baseline, depthMinMeters: 10 });
    const latest = diveSiteTemplateSnapshot({ ...source, maxDepthMeters: 9 });
    const merged = mergedDiveSiteTemplateSnapshot(current, baseline, latest, "preserve-shop-edits");
    expect(merged.maxDepthMeters).toBe(9);
    expect(merged.depthMinMeters).toBeNull();
    // Taken whole, the template's own pair stands.
    expect(
      mergedDiveSiteTemplateSnapshot(current, baseline, latest, "replace-template-copy"),
    ).toMatchObject({ depthMinMeters: 6, maxDepthMeters: 9 });
  });
});
