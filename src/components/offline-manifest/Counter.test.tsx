// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendOfflineArrival,
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
 * **The counter on the offline shell** (ADR 20260907-the-counter-survives-offline).
 *
 * The section shares a page with the roll call, which is exactly why it is
 * tested here rather than only in the domain layer: what has to hold is that
 * the two lists stay two lists, and that a tap on one never reaches the other's
 * writer.
 */
describe("OfflineManifestView — the counter", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
  });

  it("offers a check-in on a ready seat, and says which act it is", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    const row = within(counter).getByRole("button", { name: /Priya Shah/ });
    // The visible word, not a screen-reader label: this page's *other* list
    // boards people, and a row that is a name beside a circle does not say
    // which of the two questions it answers.
    expect(row).toHaveTextContent("Check in");
    expect(row).toHaveAttribute("aria-pressed", "false");
  });

  it("queues an arrival, never a roll call, when the counter row is tapped", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    vi.mocked(appendOfflineArrival).mockResolvedValue(
      richEnvelope(
        "trip-1",
        {},
        {
          arrivalEvents: [
            {
              clientEventId: "arrival-1",
              snapshotId: "snap-trip-1",
              snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
              tripId: "trip-1",
              bookingId: "diver-priya",
              status: "arrived",
              occurredAt: new Date(FROZEN_MS).toISOString(),
              syncStatus: "pending",
            },
          ],
        },
      ),
    );
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    fireEvent.click(within(counter).getByRole("button", { name: /Priya Shah/ }));

    await waitFor(() =>
      expect(vi.mocked(appendOfflineArrival)).toHaveBeenCalledWith("trip-1", {
        bookingId: "diver-priya",
        status: "arrived",
        retractsClientEventId: undefined,
      }),
    );
    // The rule this whole feature is built around, asserted where a finger
    // lands: the desk's tap reaches the desk's writer and nothing else.
    expect(vi.mocked(appendOfflineRollCall)).not.toHaveBeenCalled();

    const settled = await within(screen.getByRole("region", { name: "At the counter" })).findByRole(
      "button",
      { name: /Priya Shah/ },
    );
    expect(settled).toHaveAttribute("aria-pressed", "true");
    expect(settled).toHaveTextContent("Checked in");
  });

  it("retracts by naming the arrival it undoes", async () => {
    const queued = {
      clientEventId: "arrival-1",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
      tripId: "trip-1",
      bookingId: "diver-priya",
      status: "arrived" as const,
      occurredAt: new Date(FROZEN_MS).toISOString(),
      syncStatus: "pending" as const,
    };
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", {}, { arrivalEvents: [queued] }),
    );
    vi.mocked(appendOfflineArrival).mockResolvedValue(richEnvelope("trip-1"));
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    fireEvent.click(within(counter).getByRole("button", { name: /Priya Shah/ }));

    await waitFor(() =>
      expect(vi.mocked(appendOfflineArrival)).toHaveBeenCalledWith("trip-1", {
        bookingId: "diver-priya",
        status: "cleared",
        // The compare-and-set's other half: without this the server can only
        // fall back to a timestamp comparison, which a retraction stamped at
        // tap time always wins.
        retractsClientEventId: "arrival-1",
      }),
    );
  });

  /**
   * A seat readiness refuses gets no control at all — the live counter's own
   * grammar, and the alternative is offering a tap the server refuses the
   * moment the batch lands.
   */
  it("shows a blocked seat's reason instead of a control", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    expect(within(counter).queryByRole("button", { name: /Priya Shah/ })).not.toBeInTheDocument();
    expect(within(counter).getByText("Priya Shah")).toBeInTheDocument();
  });

  /**
   * **A seat the desk released gets no control either, and for the other
   * reason** (#1705). `bookings.status` is `no_show`, so `checkInBooking`
   * answers `not_bookable` the moment the batch reaches signal — and the
   * sentence the row then wore said the booking was cancelled, which is not
   * what happened to it. Nobody cancelled anything: the diver did not turn up
   * and somebody at the desk said so.
   *
   * Both halves in one spec on purpose. The desk's control goes and the boat's
   * stays: a change that threads this flag through the shared diver record and
   * reads it in both sections takes the crew's tap away too, and a crew member
   * looking at a body is the strongest evidence this product has.
   */
  it("gives a released seat no check-in, and still lets the crew board them", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1", { notHere: true }));
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    expect(within(counter).queryByRole("button", { name: /Priya Shah/ })).not.toBeInTheDocument();
    expect(within(counter).getByText("Priya Shah")).toBeInTheDocument();
    // The desk's record, wearing the qualifier every other saved fact on this
    // page wears: `undoBookingNoShow` may have put her back at 07:20.
    expect(within(counter).getByText("Not here when saved")).toBeInTheDocument();
    // Readiness was clearing her, so the blocked badge is not the reason the
    // control is gone and must not be borrowed as one.
    expect(within(counter).queryByText("Blocked when saved")).toBeNull();

    const row = document.getElementById("offline-roll-call-diver-priya");
    if (!row) throw new Error("Priya's row missing");
    expect(within(row).getByRole("button", { name: "Mark boarded" })).toBeEnabled();
  });
});

/**
 * **What the counter says when it is not simply working** — the three readings
 * a domain review found the first cut telling short (2026-09-07): a refusal
 * with no name on it, a saved answer wearing no "when saved", and a flat list
 * that buried the work.
 */
describe("OfflineManifestView — the counter's harder readings", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
  });

  function rejected(reason: string) {
    return {
      clientEventId: "arrival-1",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
      tripId: "trip-1",
      bookingId: "diver-priya",
      status: "arrived" as const,
      occurredAt: new Date(FROZEN_MS).toISOString(),
      syncStatus: "rejected" as const,
      rejectionReason: reason,
    };
  }

  /**
   * The scenario the reviewer named: 07:40 no signal, the divemaster checks
   * Diego in; 07:55 a refund posts and readiness stops clearing him; 08:05 the
   * batch syncs. Without this the row is back to "Check in" with no name and no
   * reason, the staffer reads it as the tablet dropping the tap, and taps again.
   */
  it("names the person and the reason when the server refused the tap", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", {}, { arrivalEvents: [rejected("not_ready")] }),
    );
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    // The refusal stands: the row is back to offering the tap, which is what
    // keeps "Checked in" off a seat the counter refused.
    expect(within(counter).getByRole("button", { name: /Priya Shah/ })).toHaveTextContent(
      "Check in",
    );
    expect(
      within(counter).getByText(/readiness stopped clearing them after you tapped/),
    ).toBeInTheDocument();
  });

  /**
   * **One code, two events, and the sentence says both** (#1705).
   * `checkInBooking` answers `not_bookable` for a cancelled seat *and* for one
   * the desk released, and this is the reading the released case actually
   * reaches: the copy was saved at 07:05 with the seat still on the list, the
   * desk wrote the diver off at 07:20, and the tap made at 07:40 syncs into a
   * refusal. The words used to say the booking was cancelled, about a booking
   * nobody had cancelled.
   */
  it("names both ways a refused seat can have left the list", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", {}, { arrivalEvents: [rejected("not_bookable")] }),
    );
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    expect(within(counter).getByText(/no longer on the boat’s list/)).toBeInTheDocument();
    expect(
      within(counter).getByText(/canceled or marked not here at the desk/),
    ).toBeInTheDocument();
    // Still told apart from a readiness hold, which is the distinction this
    // row's sentence has always carried.
    expect(within(counter).queryByText(/readiness stopped clearing them/)).toBeNull();
  });

  /**
   * A reading that came off the saved copy is the copy talking, and somebody
   * may have undone it at the desk since. "A stale copy reading as current" is
   * the one lie a roll-call surface must not tell (docs/product/glossary.md),
   * and the counter on the same screen gets no exemption.
   */
  it("hedges a check-in that came from the saved copy, not from this device", async () => {
    const envelope = richEnvelope("trip-1");
    for (const manifest of envelope.snapshot.manifests) {
      for (const diver of manifest.divers) diver.checkedIn = true;
    }
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope);
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    expect(within(counter).getByRole("button", { name: /Priya Shah/ })).toHaveTextContent(
      "Checked in when saved",
    );
  });

  it("marks a queued check-in as this device's own, and as unsent", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope(
        "trip-1",
        {},
        {
          arrivalEvents: [{ ...rejected("x"), syncStatus: "pending", rejectionReason: undefined }],
        },
      ),
    );
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const row = within(screen.getByRole("region", { name: "At the counter" })).getByRole("button", {
      name: /Priya Shah/,
    });
    expect(row).toHaveTextContent("Checked in");
    expect(row).toHaveTextContent("waiting to send");
    expect(row).not.toHaveTextContent("when saved");
  });

  it("says a blocked seat's reasons were true when the copy was saved", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    expect(within(counter).getByText("Blocked when saved")).toBeInTheDocument();
  });

  /**
   * `isSettledAtCounter`'s own precedence, borrowed from the live queue: a seat
   * that is through and still cleared sinks, so the rows anybody can act on
   * stay at the top. On a twenty-four-diver morning the flat roster put
   * eighteen receipts above the eight rows that were work.
   */
  it("sinks a settled seat below one still to come", async () => {
    const envelope = richEnvelope("trip-1", { withCarriedNotBoarded: true });
    for (const manifest of envelope.snapshot.manifests) {
      const priya = manifest.divers.find((diver) => diver.bookingId === "diver-priya");
      if (priya) priya.checkedIn = true;
    }
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope);
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    const names = within(counter)
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");
    // Marcus is still to come and comes first; Priya is settled and sinks,
    // though she is first in roster order.
    expect(names[0]).toContain("Marcus Reed");
    expect(names[1]).toContain("Priya Shah");
  });

  /**
   * `counterIsDone`'s other half (#1705): the counter is as finished with a
   * released seat as with a receipt, so that sinks too. Keyed off `settled`
   * alone, the one row on the screen with no tap left on it sat at the top of
   * the working list — a name in a queue of names needing nothing, which is
   * exactly the noise the ordering exists to take away.
   *
   * Read off the list items rather than the buttons: a released row has no
   * control, which is the point of the change this pins.
   */
  it("sinks a released seat below one still to come", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { notHere: true, withCarriedNotBoarded: true }),
    );
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const counter = screen.getByRole("region", { name: "At the counter" });
    const rows = within(counter)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(rows[0]).toContain("Marcus Reed");
    expect(rows[1]).toContain("Priya Shah");
  });

  /**
   * An hour past the scheduled departure the desk is done and the crew is at
   * the rail. Anything already queued still syncs — this hides the section, it
   * does not refuse an act somebody really made (`offlineCounterIsOver`).
   */
  it("stands down once the boat has gone, leaving the roll call at the top", async () => {
    const envelope = richEnvelope("trip-1");
    for (const manifest of envelope.snapshot.manifests) {
      manifest.trip.startsAt = new Date(FROZEN_MS - 3 * 60 * 60 * 1000).toISOString();
    }
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope);
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    expect(screen.queryByRole("region", { name: "At the counter" })).not.toBeInTheDocument();
    // The roll call it was sitting on top of is still there.
    expect(screen.getByRole("heading", { name: "Before departure roll call" })).toBeInTheDocument();
  });
});
