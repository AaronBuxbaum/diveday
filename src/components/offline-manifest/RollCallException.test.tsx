// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// Task 72 — dive-domain-expert review invariants (persona 10 Sal,
// docs/product/archive/ux-personas-20260730-findings.md), exercised at the UI
// level. The pure-function guarantees these depend on are covered directly
// in src/lib/offline-manifests.test.ts and src/lib/offline-manifest-store.test.ts;
// these confirm the ported UI honors them rather than adding its own gate.
describe("OfflineManifestView — ported boat affordances (task 72)", () => {
  beforeEach(() => {
    vi.stubGlobal("vibrate", undefined);
    Object.defineProperty(navigator, "vibrate", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  /*
   * ADR 20260815-offline-can-unsay-a-missing-diver. Two rules on the one row
   * that can silence an alarm, and they cost the same on purpose: putting
   * somebody back aboard over a stated "not back aboard" and taking the mark
   * off are both in the person's panel, a deliberate tap away from the list
   * (#1840) — and taking it off is recorded as a retraction rather than as a
   * sighting nobody made.
   */
  describe("a missing diver can be unsaid, and asserting them aboard cannot be a slip", () => {
    /** Priya, recorded not back aboard after dive 1 on this device. */
    function missingAfterDive() {
      return richEnvelope(
        "trip-1",
        {},
        {
          events: [
            {
              clientEventId: "evt-missing",
              snapshotId: "snap-trip-1",
              snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
              tripId: "trip-1",
              bookingId: "diver-priya",
              checkpoint: "after_dive_1",
              status: "not_boarded",
              occurredAt: new Date(FROZEN_MS).toISOString(),
              syncStatus: "pending",
            },
          ],
        },
      );
    }

    /**
     * **The regression this exists for** (#1840, ADR
     * 20260827-the-departure-is-two-working-surfaces decision 3): a
     * destructive roll-call claim is never one tap from the list. Every row,
     * diver and crew, at the dock and after a dive, missing or not, carries at
     * most one tap of its own — the affirmative circle — and every exception
     * lives in a closed panel. The offline copy drew "Mark not back aboard"
     * under every name until this.
     */
    it("never puts an exception within one tap of the list, at any checkpoint", async () => {
      const AFFIRMATIVE = new Set([
        "Mark boarded",
        "Boarded — tap again to undo",
        "Mark aboard",
        "Aboard — tap again to undo",
      ]);
      const nameOf = (button: HTMLButtonElement) =>
        button.getAttribute("aria-label") ?? button.textContent ?? "";
      for (const [checkpoint, saved] of [
        ["departure", richEnvelope("trip-1", { crewCalled: true })],
        ["after_dive_1", richEnvelope("trip-1", { crewCalled: true })],
        ["after_dive_1", missingAfterDive()],
      ] as const) {
        cleanup();
        searchParams = new URLSearchParams({ trip: "trip-1", checkpoint });
        vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
        vi.mocked(syncOfflineManifest).mockResolvedValue(null);
        render(<OfflineManifestView />);
        await screen.findByRole("heading", { name: "Two-Tank Reef" });

        const rows = Array.from(
          document.querySelectorAll<HTMLElement>(
            "#offline-roll-call > li, #offline-crew-roll-call > li",
          ),
        );
        expect(rows.length, checkpoint).toBeGreaterThan(2);
        for (const row of rows) {
          const onTheRow = Array.from(row.querySelectorAll("button")).filter(
            (button) => !button.closest("details"),
          );
          expect(onTheRow.length, row.id).toBeLessThanOrEqual(1);
          for (const button of onTheRow) expect(AFFIRMATIVE).toContain(nameOf(button));
          for (const button of Array.from(row.querySelectorAll("button"))) {
            if (AFFIRMATIVE.has(nameOf(button))) continue;
            const panel = button.closest<HTMLDetailsElement>("details[data-roll-call-exception]");
            expect(panel, nameOf(button)).not.toBeNull();
            expect(panel?.open, nameOf(button)).toBe(false);
          }
        }
        expect(appendOfflineRollCall).not.toHaveBeenCalled();
      }
    });

    it("puts claiming a missing diver is aboard in her panel, and names her on it", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      const saved = missingAfterDive();
      vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);
      vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });

      const confirm = screen.getByRole("button", { name: "Confirm Priya Shah is aboard" });
      const panel = confirm.closest("details[data-roll-call-exception]") as HTMLDetailsElement;
      expect(panel.open).toBe(false);
      fireEvent.click(within(panel).getByText("Change this result"));
      expect(appendOfflineRollCall).not.toHaveBeenCalled();

      fireEvent.click(confirm);
      await waitFor(() =>
        expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "boarded",
        }),
      );
    });

    // Review of #1840: inside the panel the retraction and the sighting are
    // opposite acts, and a slip from one onto the other must not write
    // "aboard". The retraction comes first, the sighting below a rule in a
    // group of its own, never the next button down.
    it("puts the retraction first and the sighting apart from it, below a rule", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      vi.mocked(loadOfflineManifest).mockResolvedValue(missingAfterDive());
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });

      const retract = screen.getByRole("button", { name: "Not back aboard" });
      const confirm = screen.getByRole("button", { name: "Confirm Priya Shah is aboard" });
      expect(
        retract.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const sighting = confirm.closest("[data-roll-call-sighting]") as HTMLElement;
      expect(sighting).not.toBeNull();
      expect(sighting.contains(retract)).toBe(false);
      expect(sighting).toHaveClass("border-t");
      // The sentence for the sighting rides the sighting, not the retraction.
      expect(within(sighting).getByRole("textbox")).toBeInTheDocument();
    });

    // Review of #1840: the panel closes when the checkpoint changes, and the
    // draft typed into it must not leak. It waits in the box, rides no mark
    // the rule refuses a sentence on (her own, at the dock), and goes with
    // her next mark that the rule allows one on.
    it("sends a sentence left in a closed panel only with that diver's next allowed mark", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      const saved = richEnvelope("trip-1");
      vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);
      vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });
      const priya = () => document.getElementById("offline-roll-call-diver-priya") as HTMLElement;
      const nav = () => screen.getByRole("navigation", { name: "Roll-call checkpoint" });

      fireEvent.change(within(priya()).getByRole("textbox"), {
        target: { value: "Last seen surfacing north of the mooring" },
      });
      // Away to the dock, where the panel closes and no sentence is allowed.
      fireEvent.click(within(nav()).getAllByRole("button")[0] as HTMLElement);
      await waitFor(() => expect(priya().querySelector("details[open]")).toBeNull());
      // Her own mark at the dock, where the rule allows no sentence.
      fireEvent.click(within(priya()).getByRole("button", { name: "Mark boarded" }));
      await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalledTimes(1));
      expect(vi.mocked(appendOfflineRollCall).mock.calls[0]?.[1]).toMatchObject({
        bookingId: "diver-priya",
        checkpoint: "departure",
        status: "boarded",
      });
      expect(vi.mocked(appendOfflineRollCall).mock.calls[0]?.[1].note).toBeUndefined();

      // Back after the dive: the draft is still Priya's, and goes with her mark.
      fireEvent.click(within(nav()).getByRole("button", { name: "After dive 1" }));
      expect(within(priya()).getByRole("textbox")).toHaveValue(
        "Last seen surfacing north of the mooring",
      );
      fireEvent.click(within(priya()).getByRole("button", { name: "Mark not back aboard" }));
      await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalledTimes(2));
      expect(vi.mocked(appendOfflineRollCall).mock.calls[1]?.[1]).toMatchObject({
        bookingId: "diver-priya",
        checkpoint: "after_dive_1",
        status: "not_boarded",
        note: "Last seen surfacing north of the mooring",
      });
    });

    it("draws a missing diver's mark on the row, and gives it no tap", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      vi.mocked(loadOfflineManifest).mockResolvedValue(missingAfterDive());
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });

      // The loudest row the product has does not turn green from the list.
      expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Boarded — tap again to undo" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Not back aboard" })).toBeInTheDocument();
    });

    it("takes the mark back off in one tap, as a retraction naming what it undoes", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      const saved = missingAfterDive();
      vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);
      vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });
      expect(screen.getByText("Tap “Not back aboard” again to undo.")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Not back aboard" }));
      await waitFor(() =>
        expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "cleared",
          // The statement being taken back, by name — without it the server can
          // only compare timestamps, and a retraction stamped at tap time beats
          // everything recorded before now, including another device's "did not
          // come back from the dive" (ADR
          // 20260815-an-offline-retraction-names-its-target).
          retractsClientEventId: "evt-missing",
        }),
      );
    });

    /**
     * And once the server has refused a retraction, the row stops offering it —
     * with the words that are now true (dive-domain review, 2026-08-15).
     *
     * The alarm stays up, which is the point. What must not stay is "Tap 'Not
     * back aboard' again to undo": the refusal means the statement standing is
     * somebody else's, so that undo can never succeed, and a crew member tapping
     * the loudest row's undo into silence three times is how a crew stops
     * trusting the control at all.
     */
    it("stops offering the undo once the server has refused it, and says where to go", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      const occurredAt = new Date(FROZEN_MS).toISOString();
      const base = {
        snapshotId: "snap-trip-1",
        snapshotSavedAt: occurredAt,
        tripId: "trip-1",
        bookingId: "diver-priya",
        checkpoint: "after_dive_1" as const,
        occurredAt,
      };
      const saved = richEnvelope(
        "trip-1",
        {},
        {
          events: [
            { ...base, clientEventId: "evt-missing", status: "not_boarded", syncStatus: "applied" },
            {
              ...base,
              clientEventId: "evt-undo",
              status: "cleared",
              retractsClientEventId: "evt-missing",
              syncStatus: "rejected",
              rejectionReason: "retraction_superseded",
            },
          ],
        },
      );
      vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);
      vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });
      // The alarm is still up.
      expect(screen.getByRole("button", { name: "Not back aboard" })).toBeInTheDocument();
      expect(
        screen.getByText(/Recorded on another device or on the live manifest/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/again to undo/)).not.toBeInTheDocument();
    });

    // A retraction only ever undoes what **this device** queued. A missing-diver
    // mark that came off the snapshot was recorded somewhere else — on the live
    // manifest, or on another device — and a `cleared` aimed at it is a blind
    // newest-wins write on the strength of a copy up to a fortnight old
    // (security review, 2026-08-15). So the row says where to undo it instead.
    it("offers no retraction for a mark this device did not make", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      const saved = richEnvelope("trip-1");
      const afterDive = saved.snapshot.manifests.find(
        (manifest) => manifest.checkpoint === "after_dive_1",
      );
      const priya = afterDive?.divers.find((diver) => diver.bookingId === "diver-priya");
      if (!priya) throw new Error("Priya missing from the fixture");
      priya.rollCall = {
        state: "not_boarded",
        occurredAt: new Date(FROZEN_MS).toISOString(),
        recordedByName: "Dana Divemaster",
      };
      vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);
      vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });
      expect(
        screen.getByText(/Recorded on another device or on the live manifest/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/again to undo/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Not back aboard" }));
      await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());
      expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
        bookingId: "diver-priya",
        checkpoint: "after_dive_1",
        status: "not_boarded",
      });
    });

    // The same undo grammar the live manifest has always had on the settled
    // aboard control: re-tapping it retracts the sighting rather than restating
    // it. Same scoping — only a sighting this device recorded.
    it("retracts a boarded mark this device made, rather than restating it", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      const saved = richEnvelope(
        "trip-1",
        {},
        {
          events: [
            {
              clientEventId: "evt-aboard",
              snapshotId: "snap-trip-1",
              snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
              tripId: "trip-1",
              bookingId: "diver-priya",
              checkpoint: "after_dive_1",
              status: "boarded",
              occurredAt: new Date(FROZEN_MS).toISOString(),
              syncStatus: "pending",
            },
          ],
        },
      );
      vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);
      vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });
      // The settled control's accessible name is now the undo-bearing
      // aria-label ("Boarded — tap again to undo", PR #607 review) rather
      // than its visible "Boarded ☑️" text — an aria-label replaces the
      // computed name outright, it does not append to it.
      fireEvent.click(screen.getByRole("button", { name: "Boarded — tap again to undo" }));
      await waitFor(() =>
        expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "cleared",
          retractsClientEventId: "evt-aboard",
        }),
      );
    });

    /**
     * The crew half of the same tap, asserted rather than assumed. Both halves
     * of one head count reach the same `reTap`, and the value of that is only
     * real if something notices when one of them stops doing it — a divemaster
     * is the person most reliably still in the water, and a retraction of hers
     * that names nothing is the one the server cannot check.
     */
    it("names what a crew retraction undoes, exactly as the diver half does", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      const saved = richEnvelope(
        "trip-1",
        { crewCalled: true },
        {
          events: [
            {
              clientEventId: "evt-crew-missing",
              snapshotId: "snap-trip-1",
              snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
              tripId: "trip-1",
              crewPersonId: "crew-dana",
              checkpoint: "after_dive_1",
              status: "not_boarded",
              occurredAt: new Date(FROZEN_MS).toISOString(),
              syncStatus: "pending",
            },
          ],
        },
      );
      vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);
      vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });
      const crewList = document.getElementById("offline-crew-roll-call");
      if (!crewList) throw new Error("crew list missing");

      fireEvent.click(within(crewList).getByRole("button", { name: "Not back aboard" }));
      await waitFor(() =>
        expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
          crewPersonId: "crew-dana",
          checkpoint: "after_dive_1",
          status: "cleared",
          retractsClientEventId: "evt-crew-missing",
        }),
      );
    });

    // The crew half of the same gate — the people most reliably in the water.
    it("puts claiming a missing crew member is aboard in their panel", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      const saved = richEnvelope(
        "trip-1",
        { crewCalled: true },
        {
          events: [
            {
              clientEventId: "evt-crew-missing",
              snapshotId: "snap-trip-1",
              snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
              tripId: "trip-1",
              crewPersonId: "crew-dana",
              checkpoint: "after_dive_1",
              status: "not_boarded",
              occurredAt: new Date(FROZEN_MS).toISOString(),
              syncStatus: "pending",
            },
          ],
        },
      );
      vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);
      vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });
      const crewList = document.getElementById("offline-crew-roll-call");
      if (!crewList) throw new Error("crew list missing");
      const crew = within(crewList);

      expect(crew.queryByRole("button", { name: "Mark aboard" })).not.toBeInTheDocument();
      const confirm = crew.getByRole("button", { name: /Confirm .* is aboard/ });
      expect(confirm.closest("details[data-roll-call-exception]")).not.toBeNull();
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
          crewPersonId: "crew-dana",
          checkpoint: "after_dive_1",
          status: "boarded",
        }),
      );
    });

    // The device half of ADR 20260815-roll-call-order-is-a-property-of-the-data:
    // a diver marked ashore at the dock with no signal reads "carried" after a
    // dive, so nobody reaches for "Mark not back aboard" to tidy the count and
    // reports a missing diver who is in the car park.
    it("carries an offline dock not-boarded forward instead of reading awaiting", async () => {
      searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
      vi.mocked(loadOfflineManifest).mockResolvedValue(
        richEnvelope(
          "trip-1",
          {},
          {
            events: [
              {
                clientEventId: "evt-dock",
                snapshotId: "snap-trip-1",
                snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
                tripId: "trip-1",
                bookingId: "diver-priya",
                checkpoint: "departure",
                status: "not_boarded",
                occurredAt: new Date(FROZEN_MS).toISOString(),
                syncStatus: "pending",
              },
            ],
          },
        ),
      );
      vi.mocked(syncOfflineManifest).mockResolvedValue(null);

      render(<OfflineManifestView />);
      await screen.findByRole("heading", { name: "Two-Tank Reef" });
      const row = document.getElementById("offline-roll-call-diver-priya");
      if (!row) throw new Error("Priya's row missing");
      expect(within(row).getByText(/Not boarded · carried/)).toBeInTheDocument();
    });
  });
});
