import { describe, expect, it } from "vitest";
import { buildDivePrepChecklist, type PrepDiver } from "./dive-prep";
import { buildTripManifest, type ManifestDiverInput } from "./manifests";
import type { SupportNeeds } from "./support-needs";

/**
 * **The regression this record's own ADR names as the thing that must not
 * happen.**
 *
 * > a support-diver count silently lost between `/ready` and the manifest is a
 * > diver in the water without the help they arranged
 * > — ADR 20260827-support-needs-are-a-record-about-the-dive
 *
 * That is not a sentence for a pull-request description; it is a test. What a
 * diver states on their own page has to survive both readers — the prep list the
 * day before and the manifest at the rail — and a field that is dropped by an
 * assembly is invisible in every other test, because every other test builds its
 * own inputs and would drop it too.
 *
 * Both halves are unit-level on purpose: the assemblies (`src/db/dive-prep`
 * reads, `src/db/manifests.ts`) are what carry the value across the seam, and
 * `pnpm typecheck` already refuses an assembly that stops passing a field these
 * types require. What it cannot refuse is an assembly that *reads* the value and
 * then declines to publish it, which is what these two assert.
 */

const ARRANGED: SupportNeeds = {
  supportDiversNeeded: 2,
  needsBoardingAssistance: true,
  needsWaterEntryLift: true,
  briefingInSign: false,
  briefingInWriting: true,
  briefingBySignals: false,
  equipmentAdaptation: "webbed gloves",
  divesWithName: "Marisol Vega",
};

/** Asked, and needs nobody — a real answer, and a different one from silence. */
const NEEDS_NOTHING: SupportNeeds = {
  supportDiversNeeded: 0,
  needsBoardingAssistance: false,
  needsWaterEntryLift: false,
  briefingInSign: false,
  briefingInWriting: false,
  briefingBySignals: false,
  equipmentAdaptation: null,
  divesWithName: null,
};

function prepDiver(overrides: Partial<PrepDiver> & Pick<PrepDiver, "bookingId" | "fullName">) {
  return {
    personId: overrides.bookingId,
    fit: null,
    wantsNitrox: false,
    hasVerifiedNitroxCard: false,
    lastDivedBand: null,
    ...overrides,
  } satisfies PrepDiver;
}

function manifestDiver(
  overrides: Partial<ManifestDiverInput> & Pick<ManifestDiverInput, "bookingId" | "fullName">,
): ManifestDiverInput {
  return {
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    checkedIn: false,
    ...overrides,
  };
}

describe("what a diver arranged reaches the people who have to arrange it", () => {
  it("carries onto the prep list, with the boat's total beside it", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        prepDiver({ bookingId: "b1", fullName: "Adaeze Nwosu", supportNeeds: ARRANGED }),
        prepDiver({ bookingId: "b2", fullName: "Theo Lindqvist", supportNeeds: NEEDS_NOTHING }),
        // Nobody asked this one.
        prepDiver({ bookingId: "b3", fullName: "Priya Sharma" }),
      ],
      plannedDives: 2,
    });

    // Only the diver who arranged something is listed. The other two render
    // nothing, which is the same answer for two different facts and correct on
    // a crew surface (design principle 9).
    expect(checklist.supportNeeds.divers).toEqual([
      { personId: "b1", fullName: "Adaeze Nwosu", needs: ARRANGED },
    ]);
    expect(checklist.supportNeeds.supportDiversNeeded).toBe(2);
  });

  it("carries onto the manifest, per diver, unchanged", () => {
    const manifest = buildTripManifest({
      trip: {
        id: "trip-1",
        title: "Two-Tank Reef",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        endsAt: new Date("2026-07-20T16:00:00.000Z"),
        plannedDives: 2,
      },
      crew: [],
      divers: [
        manifestDiver({ bookingId: "b1", fullName: "Adaeze Nwosu", supportNeeds: ARRANGED }),
        manifestDiver({ bookingId: "b3", fullName: "Priya Sharma" }),
      ],
      checkpoint: "departure",
    });

    expect(manifest.divers.find((d) => d.bookingId === "b1")?.supportNeeds).toEqual(ARRANGED);
    expect(manifest.divers.find((d) => d.bookingId === "b3")?.supportNeeds ?? null).toBeNull();
  });

  /**
   * **The second refusal, as a behaviour rather than an import check.**
   *
   * `support-needs.test.ts` proves the gates cannot import this module. This
   * proves the manifest a crew boards from is byte-identical with and without a
   * record on it — no boarding state moved, no readiness result changed, no
   * count in the summary different. A record that shifted any of those would be
   * gating by the back door.
   */
  it("changes nothing else about the manifest it rides on", () => {
    const build = (supportNeeds: SupportNeeds | null) =>
      buildTripManifest({
        trip: {
          id: "trip-1",
          title: "Two-Tank Reef",
          startsAt: new Date("2026-07-20T12:00:00.000Z"),
          endsAt: new Date("2026-07-20T16:00:00.000Z"),
          plannedDives: 2,
        },
        crew: [],
        divers: [manifestDiver({ bookingId: "b1", fullName: "Adaeze Nwosu", supportNeeds })],
        checkpoint: "departure",
      });

    const withRecord = build(ARRANGED);
    const without = build(null);
    expect(withRecord.summary).toEqual(without.summary);
    expect(withRecord.divers.map(({ supportNeeds: _, ...rest }) => rest)).toEqual(
      without.divers.map(({ supportNeeds: _, ...rest }) => rest),
    );
  });
});
