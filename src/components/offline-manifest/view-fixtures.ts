import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import { TEST_FROZEN_CLOCK } from "@/test/frozen-clock";

/**
 * **Saved copies for the offline manifest's tests** — the payloads and
 * envelopes every `OfflineManifestView` test file renders from, and the two
 * device facts (signal, the signed-in shop) they switch.
 */

// nowDate() (read by isOfflineManifestExpired/offlineManifestFreshness, both
// imported for real below) resolves to TEST_FROZEN_CLOCK under vitest, not
// wall-clock Date.now() — fixture timestamps must be relative to *this*
// reference or "in the past"/"in the future" assertions are meaningless.
export const FROZEN_MS = Date.parse(TEST_FROZEN_CLOCK);

/**
 * The border *utilities* in a class list — `border`, `border-danger`,
 * `sm:border-2` — and nothing that merely contains the word.
 *
 * A substring check on `"border"` used to stand in for this, and it started
 * matching the moment these buttons began going through `buttonClass`, whose
 * base transitions `border-color`. The assertion it broke ("the exception
 * control has no box") was still true; only the way of asking was wrong, so
 * this asks per token instead.
 */
export function borderUtilities(classes: string): string[] {
  return classes.split(/\s+/).filter((token) => /^(?:[\w.-]+:)*border(?:-|$)/.test(token));
}

export function payload(tripId: string, title: string, totalDivers = 2): OfflineManifestPayload {
  return {
    shop: {
      slug: "blue-mantis",
      name: "Blue Mantis Divers",
      timezone: "America/New_York",
      emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
    },
    manifests: [
      {
        trip: {
          id: tripId,
          title,
          startsAt: "2026-08-01T13:00:00.000Z",
          endsAt: "2026-08-01T16:30:00.000Z",
          plannedDives: 1,
        },
        checkpoint: "departure",
        crew: [],
        divers: [],
        summary: {
          totalDivers,
          ready: totalDivers,
          blocked: 0,
          boarded: 0,
          notBoarded: 0,
          notBackAboard: 0,
          awaiting: totalDivers,
          unaccountedFor: totalDivers,
          overCapacity: 0,
          notHere: 0,
        },
      },
    ],
  };
}

export function envelope(
  tripId: string,
  title: string,
  opts: {
    savedAt?: string;
    expiresAt?: string;
    events?: OfflineManifestEnvelope["events"];
    shopSlug?: string;
    shopName?: string;
  } = {},
): OfflineManifestEnvelope {
  const base = payload(tripId, title);
  return {
    snapshot: {
      ...base,
      shop:
        opts.shopSlug || opts.shopName
          ? {
              ...base.shop,
              slug: opts.shopSlug ?? base.shop.slug,
              name: opts.shopName ?? base.shop.name,
            }
          : base.shop,
      version: 4,
      snapshotId: `snap-${tripId}`,
      savedAt: opts.savedAt ?? new Date(FROZEN_MS).toISOString(),
      expiresAt: opts.expiresAt ?? new Date(FROZEN_MS + 1_000_000).toISOString(),
    },
    events: opts.events ?? [],
    checklistEvents: [],
  };
}

export type DiverFixture = OfflineManifestPayload["manifests"][number]["divers"][number];

/**
 * A payload with a real roster (unlike `payload()` above, whose `divers: []`
 * suits the list-mode tests but can't exercise roll-call rendering) across
 * "departure" and "after_dive_1" — for the dive-domain-expert invariants on
 * task 72 (docs/product/archive/ux-personas-20260730-findings.md, persona 10 Sal).
 */
export function richPayload(
  tripId: string,
  opts: {
    readiness?: "ready" | "blocked";
    /** Second diver, present at departure and carried not-boarded after dive 1. */
    withCarriedNotBoarded?: boolean;
    /**
     * Crew were counted at both checkpoints before the snapshot was saved —
     * both halves: the attested count *and* a per-person result for each crew
     * member. Divers alone no longer close a checkpoint (DOM-H1, ADRs
     * 20260802-crew-roll-call-attestation and
     * 20260803-per-person-crew-roll-call), so anything asserting "roll call
     * complete" needs this; anything asserting it *stays open* leaves it off.
     */
    crewCalled?: boolean;
    /** One named crew member has no result of their own at this checkpoint. */
    crewMemberUncounted?: boolean;
    /** A named crew member the crew recorded as *not back aboard* after the dive. */
    crewNotBackAboard?: boolean;
    /** Two crew who share a full name and a role — the list-key collision. */
    crewNamesake?: boolean;
    /**
     * A copy saved **before H-46**, whose crew carry no person id. Those crew
     * have no subject to record an event against, so the copy can only ever
     * show their save-time result and the checkpoint stays open — the
     * fail-closed direction (`crewOlderCopy`, `canRecordOfflineCrewStatus`).
     */
    crewWithoutIds?: boolean;
    /** The counter released this diver's seat before the copy was saved (#1209). */
    notHere?: boolean;
  } = {},
): OfflineManifestPayload {
  // Every charter is crewed, so both cases carry the same two people; the
  // difference under test is whether anyone called them.
  const crewRollCall = opts.crewCalled
    ? {
        state: "boarded" as const,
        occurredAt: "2026-08-01T12:55:00.000Z",
        recordedByName: "Dana Divemaster",
      }
    : undefined;
  // A current copy carries person ids (H-46) — that is what makes the crew half
  // recordable here at all. `crewWithoutIds` is the copy a device saved before
  // that, still sitting in IndexedDB and still having to render.
  const crewId = (id: string) => (opts.crewWithoutIds ? undefined : id);
  const crew = opts.crewNamesake
    ? [
        {
          id: crewId("crew-sal-1"),
          fullName: "Sal Ortiz",
          roles: ["captain"],
          rollCall: crewRollCall,
        },
        {
          id: crewId("crew-sal-2"),
          fullName: "Sal Ortiz",
          roles: ["captain"],
          rollCall: undefined,
        },
      ]
    : [
        {
          id: crewId("crew-dana"),
          fullName: "Dana Divemaster",
          roles: ["divemaster"],
          rollCall: crewRollCall,
        },
        {
          id: crewId("crew-sal"),
          fullName: "Sal Ortiz",
          roles: ["captain"],
          rollCall: opts.crewNotBackAboard
            ? {
                state: "not_boarded" as const,
                occurredAt: "2026-08-01T14:55:00.000Z",
                recordedByName: "Dana Divemaster",
              }
            : opts.crewMemberUncounted
              ? undefined
              : crewRollCall,
        },
      ];
  const trip = {
    id: tripId,
    title: "Two-Tank Reef",
    startsAt: "2026-08-01T13:00:00.000Z",
    endsAt: "2026-08-01T16:30:00.000Z",
    plannedDives: 1,
  };
  const priya: DiverFixture = {
    bookingId: "diver-priya",
    fullName: "Priya Shah",
    email: null,
    emergencyContactName: "Anil Shah",
    emergencyContactPhone: "+1-305-555-0177",
    readiness: { status: opts.readiness ?? "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    notHere: opts.notHere ?? false,
    rollCall: undefined,
  };
  const carried: DiverFixture = {
    bookingId: "diver-marcus",
    fullName: "Marcus Reed",
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    rollCall: undefined,
  };
  const carriedAfterDive: DiverFixture = {
    ...carried,
    rollCall: {
      state: "not_boarded",
      occurredAt: "2026-08-01T13:05:00.000Z",
      recordedByName: "Dana Divemaster",
      implied: true,
    },
  };
  const divers = opts.withCarriedNotBoarded ? [priya, carried] : [priya];
  const diversAfterDive = opts.withCarriedNotBoarded ? [priya, carriedAfterDive] : [priya];
  return {
    shop: {
      slug: "blue-mantis",
      name: "Blue Mantis Divers",
      timezone: "America/New_York",
      emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
    },
    manifests: [
      {
        trip,
        checkpoint: "departure",
        crew,
        divers,
        summary: {
          totalDivers: divers.length,
          ready: divers.filter((d) => d.readiness.status === "ready").length,
          blocked: divers.filter((d) => d.readiness.status === "blocked").length,
          boarded: 0,
          notBoarded: 0,
          notBackAboard: 0,
          awaiting: divers.length,
          unaccountedFor: divers.length,
          overCapacity: 0,
          notHere: 0,
        },
      },
      {
        trip,
        checkpoint: "after_dive_1",
        crew,
        divers: diversAfterDive,
        summary: {
          totalDivers: diversAfterDive.length,
          ready: diversAfterDive.filter((d) => d.readiness.status === "ready").length,
          blocked: diversAfterDive.filter((d) => d.readiness.status === "blocked").length,
          boarded: 0,
          notBoarded: opts.withCarriedNotBoarded ? 1 : 0,
          notBackAboard: 0,
          awaiting: opts.withCarriedNotBoarded
            ? diversAfterDive.length - 1
            : diversAfterDive.length,
          unaccountedFor: opts.withCarriedNotBoarded
            ? diversAfterDive.length - 1
            : diversAfterDive.length,
          overCapacity: 0,
          notHere: 0,
        },
      },
    ],
  };
}

export function richEnvelope(
  tripId: string,
  opts: Parameters<typeof richPayload>[1] = {},
  envOpts: {
    events?: OfflineManifestEnvelope["events"];
    arrivalEvents?: OfflineManifestEnvelope["arrivalEvents"];
    expiresAt?: string;
  } = {},
): OfflineManifestEnvelope {
  const base = richPayload(tripId, opts);
  return {
    snapshot: {
      ...base,
      version: 4,
      snapshotId: `snap-${tripId}`,
      savedAt: new Date(FROZEN_MS).toISOString(),
      expiresAt: envOpts.expiresAt ?? new Date(FROZEN_MS + 1_000_000).toISOString(),
    },
    events: envOpts.events ?? [],
    checklistEvents: [],
    arrivalEvents: envOpts.arrivalEvents ?? [],
  };
}

export function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

/**
 * What `GET /api/offline-manifests/identity` answers: the tenant slug, and
 * nothing else. This shell asks a one-word question and now gets a one-word
 * answer — it used to call `/upcoming`, which replies with the shop's entire
 * 48-hour board (review 20260802, action item 12).
 */
export function identityResponse(shopSlug: string) {
  return new Response(JSON.stringify({ shop: { slug: shopSlug } }), { status: 200 });
}
