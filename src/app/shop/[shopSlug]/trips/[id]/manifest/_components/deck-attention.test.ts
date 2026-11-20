import { describe, expect, it } from "vitest";
import type { TripManifest } from "@/lib/manifests";
import { deckAttentionNeeded } from "./deck-attention";
import { diver } from "./diver-roll-call-test-fixtures";
import { headCountView } from "./head-count-view";
import { crewMember, tripManifest } from "./manifest-page-test-fixtures";

const aboard = {
  state: "boarded" as const,
  occurredAt: new Date(0),
  recordedByName: "Crew",
  note: null,
};
function accountedManifest(overrides: Partial<TripManifest> = {}): TripManifest {
  const base = tripManifest();
  return tripManifest({
    divers: [diver({ personId: "guest-1", rollCall: aboard })],
    crew: [crewMember({ rollCall: aboard })],
    summary: { ...base.summary, totalDivers: 1, ready: 1, boarded: 1, overCapacity: 0 },
    completeness: {
      ...base.completeness,
      complete: true,
      diversAccountedFor: true,
      crewAccountedFor: true,
      reason: null,
      crewReason: null,
    },
    ...overrides,
  });
}
function needsAttention(manifest: TripManifest, alerted: ReadonlySet<string> = new Set()) {
  return deckAttentionNeeded({
    manifest,
    checkpoint: manifest.checkpoint,
    alerted,
    headCount: headCountView({
      manifest,
      checkpoint: manifest.checkpoint,
      isDeparture: manifest.checkpoint === "departure",
    }),
  });
}
describe("Deck shared safety attention", () => {
  it("leaves an accounted-for eligible departure free of shared attention", () => {
    expect(needsAttention(accountedManifest())).toBe(false);
  });
  it("keeps a physically aboard blocked guest visible even with all crew accounted for", () => {
    const manifest = accountedManifest({
      divers: [
        diver({
          personId: "guest-1",
          rollCall: aboard,
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
        }),
      ],
    });
    expect(manifest.completeness.complete).toBe(true);
    expect(needsAttention(manifest)).toBe(true);
  });
  it("keeps ordinary unboarded readiness work on the person's own attention entry", () => {
    const manifest = accountedManifest({
      divers: [
        diver({ readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] } }),
      ],
    });
    expect(needsAttention(manifest)).toBe(false);
  });
  it.each(["passengers", "total persons"])(
    "shows bodies aboard beyond the certificate's %s limit",
    (kind) => {
      const base = accountedManifest();
      const manifest = accountedManifest({
        trip: {
          ...base.trip,
          certifiedPassengers: kind === "passengers" ? 1 : null,
          certifiedTotalPersons: kind === "total persons" ? 2 : null,
        },
        divers: [
          diver({ bookingId: "booking-1", personId: "guest-1", rollCall: aboard }),
          diver({ bookingId: "booking-2", personId: "guest-2", rollCall: aboard }),
        ],
        summary: { ...base.summary, totalDivers: 2, boarded: 2 },
      });
      expect(needsAttention(manifest)).toBe(true);
    },
  );
  it("preserves unresolved alerts even when everybody has a positive record", () => {
    expect(needsAttention(accountedManifest(), new Set(["guest-1"]))).toBe(true);
  });
  it("keeps earlier unresolved evidence visible after a current count", () => {
    const base = accountedManifest();
    expect(
      needsAttention(
        accountedManifest({
          summary: { ...base.summary, historicalReviewRequired: 1 },
        }),
      ),
    ).toBe(true);
  });
});
