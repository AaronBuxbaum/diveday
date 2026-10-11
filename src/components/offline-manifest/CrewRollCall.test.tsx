// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import { OfflineManifestView } from "../OfflineManifestView";
import { FROZEN_MS, identityResponse, richEnvelope, setOnline } from "./view-fixtures";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/offline-manifest-store", async () => ({
  // The real class, not a stand-in: the view branches on
  // `error instanceof OfflineManifestError` and then on `error.code`, so a
  // duplicate declared here would make every refusal fall through to the
  // generic message and the copy tests below would assert nothing.
  OfflineManifestError: (
    await vi.importActual<typeof import("@/lib/offline-manifest-store")>(
      "@/lib/offline-manifest-store",
    )
  ).OfflineManifestError,
  // The counter's queue is a *different* writer from roll call's, and this
  // mock keeps them apart so a test can prove which one a tap reached
  // (ADR 20260907-the-counter-survives-offline).
  appendOfflineArrival: vi.fn(),
  appendOfflineRollCall: vi.fn(),
  listOfflineManifests: vi.fn(),
  loadOfflineManifest: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue(undefined),
  syncOfflineManifest: vi.fn(),
  // The retention ceiling's discard notice: nothing thrown away is the right
  // default for every test that isn't about one.
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  // The version-mismatch banner (task 124) resolves this on mount; no active
  // worker in jsdom, so "nothing to warn about" is the correct default here.
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  searchParams = new URLSearchParams();
  setOnline(true);
  // reconcileList learns "the currently authenticated shop" from this same
  // endpoint before syncing any pending event — default to matching the
  // fixtures' own shop ("blue-mantis") so existing reconcile tests keep
  // working; tests for the cross-shop case override this per-call.
  // A fresh Response per call: a body can be consumed only once, and more than
  // one caller reaches this endpoint per mount.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => identityResponse("blue-mantis")),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * DOM-H1. "Complete" is one definition (`rollCallCompleteness`,
 * src/lib/manifests.ts), consumed by the live manifest and by this view. It
 * used to be written inline in both places as divers-only, so a checkpoint
 * with every booked diver counted read complete with the crew unaccounted
 * for. A crew roll call is recordable offline now (H-46), and the one thing
 * that must still never happen is unchanged: the dock copy reading "complete"
 * while the live page says the checkpoint is still open.
 */
describe("OfflineManifestView — crew are part of the head count offline too", () => {
  it("does not read complete when every diver has a result but the crew were never called", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    // No `crewCalled` — a snapshot saved before anyone called the crew.
    const saved = richEnvelope("trip-1", { withCarriedNotBoarded: true });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(appendOfflineRollCall).mockResolvedValue({
      ...saved,
      events: [
        {
          clientEventId: "evt-1",
          snapshotId: saved.snapshot.snapshotId,
          snapshotSavedAt: saved.snapshot.savedAt,
          tripId: "trip-1",
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "boarded",
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    });

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    // Priya is the only diver still awaiting (Marcus is carried not-boarded).
    fireEvent.click(screen.getAllByRole("button", { name: "Mark boarded" })[0] as HTMLElement);
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    // Both divers now have a result — the old divers-only rule called this
    // complete, on both surfaces.
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    // And it says why, rather than going quiet — naming the count that is
    // holding it open, in the same words the live manifest uses.
    expect(screen.getByText(/2 crew members still to call/)).toBeInTheDocument();
    // And the way to close it is right there, on this copy, with no signal:
    // one aboard control per crew member, which is the whole point of H-46.
    expect(screen.getAllByRole("button", { name: "Mark aboard" })).toHaveLength(2);
  });

  it("reads complete once the saved snapshot has a result for every assigned crew member", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { withCarriedNotBoarded: true, crewCalled: true });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(appendOfflineRollCall).mockResolvedValue({
      ...saved,
      events: [
        {
          clientEventId: "evt-1",
          snapshotId: saved.snapshot.snapshotId,
          snapshotSavedAt: saved.snapshot.savedAt,
          tripId: "trip-1",
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "boarded",
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    });

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    // The saved count is shown, attributed — a head count is never anonymous.
    expect(screen.getByText(/All 2 crew accounted for/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Mark boarded" })[0] as HTMLElement);
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    expect(await screen.findByText(/Roll call complete/)).toBeInTheDocument();
  });

  /**
   * DOM-H1's per-person half, offline (ADR 20260803-per-person-crew-roll-call).
   * A count names nobody, so a saved "2 of 2 aboard" cannot tell this device
   * that the second body was the deckhand rather than the divemaster still
   * down. Crew results are read-only here — recording one needs signal — and
   * their absence reads as *not counted*, which is what keeps the dock copy
   * fail-closed rather than ahead of the live page.
   */
  it("stays open, and says who, when a named crew member has no saved result", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", {
      withCarriedNotBoarded: true,
      crewCalled: true,
      crewMemberUncounted: true,
    });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(appendOfflineRollCall).mockResolvedValue({
      ...saved,
      events: [
        {
          clientEventId: "evt-1",
          snapshotId: saved.snapshot.snapshotId,
          snapshotSavedAt: saved.snapshot.savedAt,
          tripId: "trip-1",
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "boarded",
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    });

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    fireEvent.click(screen.getAllByRole("button", { name: "Mark boarded" })[0] as HTMLElement);
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    // Every diver counted, every crew member called — and still not complete.
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 crew member still to call/)).toBeInTheDocument();
    // Named, not just counted: the captain nobody has tapped is on screen.
    expect(screen.getByText(/Sal Ortiz · Awaiting/)).toBeInTheDocument();
    expect(screen.getByText(/Dana Divemaster · Boarded/)).toBeInTheDocument();
  });
});

/**
 * Review 20260803, D6, re-read after H-46. "A crew member is still to call"
 * and "a crew member is unaccounted for" are different facts, and a crew
 * seeing warning-yellow on every single dive stops reading it at all. What
 * changed is which of the two an ordinary out-of-signal trip produces: the
 * crew half is now recordable here, so an uncalled crew member is work in
 * front of the deck rather than a limitation to apologise for. The apology is
 * left for the one copy that genuinely cannot do it — one saved before crew
 * ids rode along — and even that stays calm-toned.
 */
describe("OfflineManifestView — the crew panel tells apart 'still to call' from 'missing'", () => {
  it("does not apologize on a current copy: an uncalled crew member is work, and untoned", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", {
      withCarriedNotBoarded: true,
      crewCalled: true,
      crewMemberUncounted: true,
    });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    // Still open — the fail-closed rule is untouched.
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    const note = screen.getByText(/1 crew member still to call/);
    const panel = note.closest("section");
    expect(panel).toBe(screen.getByRole("region", { name: "Crew aboard" }));
    expect(panel?.className).not.toContain("warning");
    expect(panel?.className).not.toContain("danger");
    // The limitation line belongs to an older copy only, and this is not one.
    expect(screen.queryByText(/saved before crew roll call worked offline/)).toBeNull();
  });

  /**
   * Invariant I2, on screen. A copy saved before H-46 has crew with no person
   * id, so there is no subject a tap could be about. It says so — with a
   * count, so a captain can tell one late addition from the whole crew — the
   * checkpoint stays open, and no aboard control is offered for somebody the
   * device cannot name to the server.
   */
  it("says so, calmly and with a count, when the saved copy predates crew ids", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", {
      withCarriedNotBoarded: true,
      crewCalled: true,
      crewMemberUncounted: true,
      crewWithoutIds: true,
    });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    const note = screen.getByText(/2 crew members on this saved copy can’t be called here/);
    expect(note).toBeInTheDocument();
    const panel = note.closest("section");
    expect(panel).toBe(screen.getByRole("region", { name: "Crew aboard" }));
    expect(panel?.className).not.toContain("warning");
    expect(panel?.className).not.toContain("danger");
    // No control for a person this copy cannot name to the server.
    expect(screen.queryByRole("button", { name: "Mark aboard" })).toBeNull();
  });

  it("does alarm, in danger tone, when a named crew member is not back aboard", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", {
      withCarriedNotBoarded: true,
      crewCalled: true,
      crewNotBackAboard: true,
    });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    const alarm = screen.getByText(/1 crew member is not back aboard/);
    expect(alarm.closest("section")?.className).toContain("danger");
    // This one is emphatically *not* "we can't record it here".
    expect(screen.queryByText(/can’t be tapped from this saved copy/)).not.toBeInTheDocument();
    expect(screen.getByText(/Sal Ortiz · Not back aboard/)).toBeInTheDocument();
  });

  it("renders two crew who share a name and a role as two separate people", async () => {
    // The list key was `fullName-roles`, so a namesake pair collided — which is
    // exactly what `ManifestCrewMember.id` prevents on the live manifest. The
    // dock copy carries no person ids by design, so its key is the position.
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { crewCalled: true, crewNamesake: true });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    expect(screen.getByText(/Sal Ortiz · Boarded/)).toBeInTheDocument();
    expect(screen.getByText(/Sal Ortiz · Awaiting/)).toBeInTheDocument();
  });
});
