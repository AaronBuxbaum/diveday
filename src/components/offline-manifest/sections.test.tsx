// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import { OfflineChecklist } from "./Checklist";
import { OfflineCrewRollCall } from "./CrewRollCall";
import type { OfflineTripControls } from "./controls";
import { OfflineDiverRollCall } from "./DiverRollCall";
import { OfflineManifestList } from "./ManifestList";
import { OfflineTripHeader } from "./TripHeader";
import { type OfflineTripView, offlineTripView } from "./trip-view";

// The version banner asks the store for the worker's build on mount; jsdom has
// no worker, so "nothing to warn about" is the answer.
vi.mock("@/lib/offline-manifest-store", async (original) => ({
  ...(await original<typeof import("@/lib/offline-manifest-store")>()),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));

afterEach(cleanup);

type Diver = OfflineManifestPayload["manifests"][number]["divers"][number];

function diver(bookingId: string, fullName: string): Diver {
  return {
    bookingId,
    fullName,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    rollCall: undefined,
  };
}

function savedCopy(): OfflineManifestEnvelope {
  const divers = [diver("b-priya", "Priya Shah"), diver("b-marcus", "Marcus Reed")];
  return {
    snapshot: {
      shop: {
        slug: "blue-mantis",
        name: "Blue Mantis Divers",
        timezone: "America/New_York",
        emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
      },
      manifests: [
        {
          trip: {
            id: "trip-1",
            title: "Two-Tank Reef",
            startsAt: "2026-08-01T13:00:00.000Z",
            endsAt: "2026-08-01T16:30:00.000Z",
            plannedDives: 1,
          },
          checkpoint: "departure",
          crew: [{ id: "crew-dana", fullName: "Dana Divemaster", roles: ["divemaster"] }],
          divers,
          summary: {
            totalDivers: 2,
            ready: 2,
            blocked: 0,
            boarded: 0,
            notBoarded: 0,
            notBackAboard: 0,
            awaiting: 2,
            unaccountedFor: 2,
            overCapacity: 0,
            notHere: 0,
          },
        },
      ],
      version: 4,
      snapshotId: "snap-trip-1",
      savedAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    events: [],
    checklistEvents: [],
  } as OfflineManifestEnvelope;
}

function controls(): OfflineTripControls {
  return {
    t: offlineManifestTranslator("en-US"),
    locale: "en-US",
    message: "",
    setCheckpoint: vi.fn(),
    busyBooking: null,
    busyChecklistItem: null,
    busyArrival: null,
    noteDrafts: {},
    setNoteDrafts: vi.fn(),
    record: vi.fn(async () => {}),
    recordChecklistCheck: vi.fn(async () => {}),
    recordArrival: vi.fn(async () => {}),
  };
}

function view(): OfflineTripView {
  const found = offlineTripView(savedCopy(), "departure");
  if (!found) throw new Error("the fixture carries a manifest");
  return found;
}

describe("offlineTripView", () => {
  it("counts nobody called as awaiting, and the checkpoint as open", () => {
    const trip = view();
    expect(trip.totalDivers).toBe(2);
    expect(trip.awaiting).toBe(2);
    expect(trip.boarded).toBe(0);
    expect(trip.rollCallComplete).toBe(false);
    expect(trip.missingDivers.map((entry) => entry.bookingId)).toEqual(["b-priya", "b-marcus"]);
  });

  it("is null for a copy that carries no manifest", () => {
    const copy = savedCopy();
    expect(
      offlineTripView({ ...copy, snapshot: { ...copy.snapshot, manifests: [] } }, "departure"),
    ).toBeNull();
  });
});

describe("the offline manifest's sections", () => {
  it("draws the header with the departure's title", () => {
    const { container } = render(<OfflineTripHeader view={view()} controls={controls()} />);
    expect(container.textContent).toContain("Two-Tank Reef");
  });

  it("draws one roll-call row per diver, each its own jump target", () => {
    const { container } = render(<OfflineDiverRollCall view={view()} controls={controls()} />);
    expect(container.querySelector("#offline-roll-call-b-priya")).not.toBeNull();
    expect(container.querySelector("#offline-roll-call-b-marcus")).not.toBeNull();
  });

  it("shows the live roll call's two medical warnings, in its words", () => {
    // Issue #2163: a crew at the rail with no signal saw neither warning.
    const copy = savedCopy();
    const [first, second] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first || !second) throw new Error("fixture divers missing");
    first.medicalWarnings = { refusedOn: "2026-05-02", referredOn: "2026-06-10" };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const warned = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(warned).toContain("Physician said no before");
    // Ranked after the refusal, as on the live roll call: one capsule.
    expect(warned).not.toContain("Referral still open");
    expect(warned).toContain("Contact, gear & medical");
    expect(warned).toMatch(
      /A physician did not clear this diver on May\s2,\s2026 \(earlier waiver\)/,
    );
    expect(warned).toMatch(
      /Referred to a physician on Jun\s10,\s2026; re-signed with no physician clearance on file/,
    );
    const plain = container.querySelector("#offline-roll-call-b-marcus")?.textContent ?? "";
    expect(plain).not.toContain("physician");
    expect(plain).not.toContain("medical");
  });

  it("shows the referral capsule when there is no refusal", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture diver missing");
    first.medicalWarnings = { referredOn: "2026-06-10" };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(row).toContain("Referral still open");
    expect(row).not.toContain("Physician said no before");
  });

  it("never shows a held seat's medical warnings", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture diver missing");
    first.identityWithheld = true;
    first.medicalWarnings = { refusedOn: "2026-05-02" };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(row).not.toContain("physician");
    expect(row).not.toContain("Physician said no before");
  });

  it("draws the crew half under its own heading", () => {
    const { container } = render(<OfflineCrewRollCall view={view()} controls={controls()} />);
    expect(container.querySelector("#offline-crew-heading")).not.toBeNull();
    expect(container.textContent).toContain("Dana Divemaster");
  });

  it("draws no checklist for a shop that keeps none", () => {
    const { container } = render(<OfflineChecklist view={view()} controls={controls()} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the copies saved on this device", () => {
    const { container } = render(
      <OfflineManifestList
        t={offlineManifestTranslator("en-US")}
        shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
        list={[savedCopy()]}
        message=""
        discardNotice={null}
      />,
    );
    expect(container.textContent).toContain("Two-Tank Reef");
  });
});
