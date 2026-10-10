// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  OfflineManifestError,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import { OfflineManifestView } from "../OfflineManifestView";
import {
  borderUtilities,
  FROZEN_MS,
  identityResponse,
  richEnvelope,
  setOnline,
} from "./view-fixtures";

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

  it("invariant 1: hides Board for a not-ready diver at departure but shows it after a numbered dive", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    // Departure: no Board button for the blocked diver, only Not boarded.
    expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark not boarded" })).toBeInTheDocument();

    // Switch to the after-dive-1 checkpoint — a pure headcount now.
    fireEvent.click(screen.getByRole("button", { name: "After dive 1" }));
    expect(await screen.findByRole("button", { name: "Mark boarded" })).toBeInTheDocument();
  });

  // Review of #1840: the circle takes the tap away from a blocked diver at the
  // dock, never the fact. Boarded-and-blocked drew the empty dashed ring
  // beside a "Boarded" pill.
  for (const [status, drawn] of [
    ["boarded", "aboard"],
    ["not_boarded", "ashore"],
  ] as const) {
    it(`draws a blocked diver recorded ${status} at the dock as ${drawn}, with no tap`, async () => {
      searchParams = new URLSearchParams({ trip: "trip-1" });
      vi.mocked(loadOfflineManifest).mockResolvedValue(
        richEnvelope(
          "trip-1",
          { readiness: "blocked" },
          {
            events: [
              {
                clientEventId: `evt-${status}`,
                snapshotId: "snap-trip-1",
                snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
                tripId: "trip-1",
                bookingId: "diver-priya",
                checkpoint: "departure",
                status,
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

      const row = document.getElementById("offline-roll-call-diver-priya") as HTMLElement;
      expect(row.querySelector("[data-mark-state]")?.getAttribute("data-mark-state")).toBe(drawn);
      // Aboard over a block wears the blocked tone, never the calm green
      // (review of #1840); left ashore keeps its own recorded tone.
      if (status === "boarded") {
        expect(row.className).toContain("border-danger");
        expect(row.className).not.toContain("bg-success/20");
      } else {
        expect(row.className).toContain("border-warning");
      }
      const onTheRow = Array.from(row.querySelectorAll("button")).filter(
        (button) => !button.closest("details"),
      );
      expect(onTheRow).toEqual([]);
    });
  }

  it("invariant 2: recording boarded after a numbered dive for a not-ready diver succeeds as a pure headcount", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { readiness: "blocked" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    const afterBoard: OfflineManifestEnvelope = {
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
    };
    vi.mocked(appendOfflineRollCall).mockResolvedValue(afterBoard);

    render(<OfflineManifestView />);
    const boardButton = await screen.findByRole("button", { name: "Mark boarded" });
    fireEvent.click(boardButton);

    await waitFor(() =>
      expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
        bookingId: "diver-priya",
        checkpoint: "after_dive_1",
        status: "boarded",
      }),
    );
    // No refusal message — the tap actually recorded, matching what the
    // visible "Board" button implied it would do.
    expect(screen.getByText(/Saved on this phone/)).toBeInTheDocument();
    expect(screen.queryByText(/does not allow boarding/)).not.toBeInTheDocument();
  });

  /**
   * **The refusal is in the past tense, like every other readiness word here.**
   *
   * `canRecordOfflineStatus` answers the departure gate from the *snapshot's*
   * `readiness.status`, so this sentence is the saved copy talking — and until
   * 2026-09-11 it read "This diver isn't ready to board yet", a stale copy
   * reading as current: the one lie a roll-call surface must not tell
   * (docs/product/glossary.md's Blocked / Ready entry). The badge beside it has
   * said "when saved" since #1360; the refusal now says the same thing.
   */
  it("says the readiness it refused on was true when the copy was saved", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(appendOfflineRollCall).mockRejectedValue(new OfflineManifestError("not_allowed"));

    render(<OfflineManifestView />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark boarded" }));

    expect(
      await screen.findByText(
        "This diver wasn’t ready to board when this copy was saved. " +
          "Open the live manifest before they board.",
      ),
    ).toBeInTheDocument();
  });

  it("invariant 3: an expired copy shows no board/not-board buttons, a distinct message, and never fires a haptic or the celebration", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    const expired = richEnvelope(
      "trip-1",
      {},
      { expiresAt: new Date(FROZEN_MS - 1000).toISOString() },
    );
    vi.mocked(loadOfflineManifest).mockResolvedValue(expired);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark not boarded" })).not.toBeInTheDocument();
    // The distinct expired banner and the per-diver "record on the live
    // manifest" copy — not the generic freshness banner every other stale
    // copy shows.
    expect(
      screen.getByText(/This saved copy has expired and can’t be used to board divers/),
    ).toBeInTheDocument();
    expect(screen.getByText("Expired — record on the live manifest")).toBeInTheDocument();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
    expect(navigator.vibrate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sub-surface-ripple")).not.toBeInTheDocument();
  });

  it("invariant 4 / DOM-H3: recording a diver as not back aboard after a dive neither closes the checkpoint nor celebrates", async () => {
    // SubSurfaceRipple only ever fires on a false→true *transition* of its
    // `complete` prop (see its own component) — a manifest that is already
    // "complete" on the very first render can never exercise the gate this
    // test is for, so this drives a real transition: mount not-complete
    // (Priya still awaiting), then record Priya at an *after-dive* checkpoint
    // with the only control that isn't "Boarded". Every diver now has a result
    // — `awaiting` hits zero, Marcus was already carried not-boarded from the
    // dock — and neither the celebration nor "complete" may follow from that:
    // Priya has not come back from dive one.
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { withCarriedNotBoarded: true, crewCalled: true });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    const afterNotBoard: OfflineManifestEnvelope = {
      ...saved,
      events: [
        {
          clientEventId: "evt-1",
          snapshotId: saved.snapshot.snapshotId,
          snapshotSavedAt: saved.snapshot.savedAt,
          tripId: "trip-1",
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "not_boarded",
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    };
    vi.mocked(appendOfflineRollCall).mockResolvedValue(afterNotBoard);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    // Not complete yet — Priya is still awaiting.
    expect(screen.queryByTestId("sub-surface-ripple")).not.toBeInTheDocument();

    // After a dive the control is worded for what it means here, and never
    // settles into a green-checked "Not boarded ✓" beside a diver in the water.
    expect(screen.queryByRole("button", { name: "Mark not boarded" })).not.toBeInTheDocument();
    const priyaRow = () => {
      const row = document.getElementById("offline-roll-call-diver-priya");
      if (!row) throw new Error("Priya's row missing");
      return within(row);
    };
    fireEvent.click(priyaRow().getByRole("button", { name: "Mark not back aboard" }));
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    // Every diver has a result, but one of them did not come back: the
    // checkpoint stays open, exactly as the live manifest reports it.
    await waitFor(() =>
      expect(priyaRow().getByRole("button", { name: "Not back aboard" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Not boarded ☑️/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "After dive 1 roll call" })).toBeInTheDocument();
    expect(screen.queryByText(/everyone’s aboard/)).not.toBeInTheDocument();

    // SubSurfaceRipple mounts the celebration markup one render *after* its
    // `complete` prop flips (its own `useEffect` calls `setActive(true)`,
    // scheduling a second commit) — flush past that window with a real timer
    // tick before asserting absence, so this doesn't just win a race against
    // an effect that hasn't run yet.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByTestId("sub-surface-ripple")).not.toBeInTheDocument();
    // MilestoneHaptics is keyed off the true boarded count too (0 of 2) —
    // no 100%-milestone vibration for a roll call where nobody boarded.
    expect(navigator.vibrate).not.toHaveBeenCalledWith([100, 50, 100, 50, 200]);
  });

  it("invariant 5: pending/rejected sync counts stay visible even once local roll call reads complete", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    const saved = richEnvelope(
      "trip-1",
      {},
      {
        events: [
          {
            clientEventId: "evt-1",
            snapshotId: "snap-trip-1",
            snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
            tripId: "trip-1",
            bookingId: "diver-priya",
            checkpoint: "departure",
            status: "boarded",
            occurredAt: new Date(FROZEN_MS).toISOString(),
            syncStatus: "pending",
          },
        ],
      },
    );
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(saved); // still pending after "reconcile"

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    // The board is locally complete (Priya boarded, nobody else on this
    // roster) — the celebration/ripple gate is satisfied — but the pending
    // count must still say so; a satisfying local animation is never a claim
    // the server has confirmed anything.
    expect(await screen.findByText(/1 waiting to send/)).toBeInTheDocument();
  });

  it("ports MissingDiversGrid: an awaiting diver appears as a tap target", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    // **Scoped to the grid this test is about**, the way the carried-result
    // test above scopes to a row. Searching the whole document was unique by
    // luck until the counter section landed (ADR
    // 20260907-the-counter-survives-offline) and rendered a *second* button
    // carrying this diver's name — `getByRole`'s `name` is a substring match,
    // so a loose regex catches both. A `getAllBy…` would silence it without
    // keeping the meaning: this asserts the tap target exists **in the grid**,
    // and would still have to fail if the grid rendered nothing.
    const grid = document.getElementById("missing-divers-grid");
    if (!grid) throw new Error("the missing-divers grid is missing");
    expect(within(grid).getByRole("button", { name: /Priya/ })).toBeInTheDocument();
  });

  /**
   * **A tap target is only a target if the tap lands** (#1675). The grid looked
   * its row up as `diver-row-<bookingId>` — the *live* manifest's id — while
   * every row on this page answers to `offline-roll-call-<bookingId>`, so
   * `getElementById` returned null and every tap on every face was a silent
   * no-op, under a hint that says "Tap a diver to jump to their row" on the one
   * surface that exists for having no signal.
   *
   * Nothing caught it: the grid's own suite mounts a stub row and this file
   * asserted the button *exists*. Existing is not the promise. This asserts the
   * jump reaches **that diver's row**, which is the only version that fails if
   * the ids drift apart again or a third prefix is looked up.
   */
  it("jumps from a face in the grid to that diver's own row", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "departure" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { withCarriedNotBoarded: true }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    // jsdom ships no layout, so `src/test/setup.ts` installs a no-op
    // `scrollIntoView` on the prototype — which is exactly why the spies go on
    // the *rows themselves*: a jump to some other element, or to nothing, is
    // swallowed by that no-op and would read as green. `elsewhere` is what the
    // prototype catches, i.e. any element that is not one of these two rows.
    const priya = document.getElementById("offline-roll-call-diver-priya");
    const marcus = document.getElementById("offline-roll-call-diver-marcus");
    if (!priya || !marcus) throw new Error("the diver rows are missing");
    const elsewhere = vi.spyOn(Element.prototype, "scrollIntoView");
    onTestFinished(() => elsewhere.mockRestore());
    priya.scrollIntoView = vi.fn();
    marcus.scrollIntoView = vi.fn();

    const grid = document.getElementById("missing-divers-grid");
    if (!grid) throw new Error("the missing-divers grid is missing");
    fireEvent.click(within(grid).getByRole("button", { name: /Priya/ }));

    expect(priya.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(marcus.scrollIntoView).not.toHaveBeenCalled();
    expect(elsewhere).not.toHaveBeenCalled();
    // The ring is the other half of the jump: on a nine-diver roster, landing
    // mid-list without a mark leaves the crew counting rows to find the face.
    expect(priya.classList.contains("ring-4")).toBe(true);
  });

  /**
   * The glossary's offline exception covers the whole page, not one pill
   * (#1360). A face in this grid and that diver's own row are one scroll apart
   * on a surface whose only real risk is being read as current, so a bare
   * "Blocked" beside the face was the one wording that could make a stale copy
   * look live.
   */
  it("qualifies the grid's blocked chip the way the diver's own row does", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const grid = document.getElementById("missing-divers-grid");
    if (!grid) throw new Error("the missing-divers grid is missing");
    expect(within(grid).getByText("Blocked when saved")).toBeInTheDocument();
    // `getByText` with a string matches an element's whole normalised text, so
    // this finds an *unqualified* chip and never the qualified one above.
    expect(within(grid).queryByText("Blocked")).toBeNull();
  });

  /**
   * The checkpoint rule the live page applies three times — the roll-call row's
   * untouched fill, its capsule (`blockedAtDock`) and the summary panel's
   * blocked sentence (`isDeparture && summary.blocked`) — and which
   * this page states of itself and then broke in one place. After a dive every
   * face in the grid is somebody who went in the water, so the saved paperwork
   * word beside it is stale by definition, and its red competed with the one
   * red on the page that means a diver has not come back.
   *
   * The diver's own row is the deliberate exception and is asserted here in the
   * same breath: it is the snapshot's two-state record, not an exception accent
   * on a checkpoint-scoped prompt, so it keeps its badge at every checkpoint.
   */
  it("drops the grid's blocked chip after a dive, and keeps the diver row's badge", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const grid = document.getElementById("missing-divers-grid");
    if (!grid) throw new Error("the missing-divers grid is missing");
    // She is still uncalled, so she is still a face to tap — this asserts the
    // chip went away, not the grid.
    expect(within(grid).getByRole("button", { name: /Priya/ })).toBeInTheDocument();
    expect(within(grid).queryByText("Blocked when saved")).toBeNull();

    const row = document.getElementById("offline-roll-call-diver-priya");
    if (!row) throw new Error("Priya's row missing");
    expect(within(row).getByText("Blocked when saved")).toBeInTheDocument();
  });

  /**
   * **A released seat reads as one on the only copy at the rail** (#1209,
   * `dive-domain-expert` review 20260911). The dock copy carried one booking
   * signal — the counter's arrival — so a diver the desk wrote off at 07:20
   * looked exactly like one still walking down the pier to a crew with no
   * signal. The qualifier is the point: this copy cannot know the desk has
   * since put them back, and a stale copy reading as current is the one lie a
   * roll-call surface must not tell.
   */
  it("says which seat the counter released, and still lets the crew board them", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "departure" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1", { notHere: true }));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const row = document.getElementById("offline-roll-call-diver-priya");
    if (!row) throw new Error("Priya's row missing");
    expect(within(row).getByText("Not here when saved")).toBeInTheDocument();
    // It refuses nothing: the crew tap boards a body they can see, and the
    // rail takes the released seat back when the event syncs.
    expect(within(row).getByRole("button", { name: "Mark boarded" })).toBeEnabled();
  });

  it("says nothing on a copy where nobody was written off", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "departure" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    expect(screen.queryByText("Not here when saved")).toBeNull();
  });

  /**
   * The other half of the same rule, kept beside it so a session that gates the
   * chip one checkpoint too far has a failing test rather than a quieter dock.
   * At departure the word is the thing to fix before this diver boards.
   */
  it("keeps the grid's blocked chip at the dock", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "departure" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const grid = document.getElementById("missing-divers-grid");
    if (!grid) throw new Error("the missing-divers grid is missing");
    expect(within(grid).getByText("Blocked when saved")).toBeInTheDocument();
  });

  it("keeps all device controls in the collapsed On this phone group", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const heading = screen.getByRole("heading", { name: "On this phone" });
    const disclosure = heading.closest("details");
    expect(disclosure).not.toBeNull();
    expect((disclosure as HTMLDetailsElement).open).toBe(false);
  });
});

/**
 * Decision 4 of ADR 20260827-the-departure-is-two-working-surfaces: an alarm is
 * earned by a recorded fact. The live page keeps "Mark not back aboard" neutral
 * until somebody records it, so the saved copy does too, or the same control
 * changes colour between the dock and the open water (issue #2107).
 */
describe("OfflineManifestView — after a dive, red only once someone is recorded not back", () => {
  it("draws every unrecorded after-dive exception control, diver and crew, without danger ink", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    const controls = screen.getAllByRole("button", { name: "Mark not back aboard" });
    // One diver (Priya) and two crew (Dana, Sal), none recorded yet.
    expect(controls).toHaveLength(3);
    for (const control of controls) {
      expect(control.className).not.toMatch(/danger/);
    }
  });

  it("keeps a recorded not-back-aboard loud, crew and diver alike", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { crewCalled: true, crewNotBackAboard: true });
    const priyaMissing: OfflineManifestEnvelope = {
      ...saved,
      events: [
        {
          clientEventId: "evt-missing",
          snapshotId: saved.snapshot.snapshotId,
          snapshotSavedAt: saved.snapshot.savedAt,
          tripId: "trip-1",
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "not_boarded",
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    };
    vi.mocked(loadOfflineManifest).mockResolvedValue(priyaMissing);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    const recorded = screen.getAllByRole("button", { name: "Not back aboard" });
    expect(recorded).toHaveLength(2);
    for (const control of recorded) {
      expect(control.className).toContain("text-danger");
    }
    // Dana is recorded aboard: her exception control stays quiet.
    const quiet = screen.getByRole("button", { name: "Mark not back aboard" });
    expect(quiet.className).not.toMatch(/danger/);
  });
});

/**
 * DOM-H3. The dock copy and the live manifest read the same rows through the
 * same predicate and the same word list (`isNotBackAboard` / `rollCallLabel` in
 * src/lib/manifests.ts, `rollCallLabelText` in src/i18n/manifest-labels.ts), so
 * neither can describe a diver in the water as settled while the other alarms.
 */
describe("OfflineManifestView — the two meanings of not_boarded, worded the same as online", () => {
  function envelopeWithServerResult(
    checkpoint: "departure" | "after_dive_1",
    rollCall: NonNullable<
      OfflineManifestPayload["manifests"][number]["divers"][number]["rollCall"]
    >,
  ) {
    const base = richEnvelope("trip-1", { crewCalled: true });
    return {
      ...base,
      snapshot: {
        ...base.snapshot,
        manifests: base.snapshot.manifests.map((manifest) =>
          manifest.checkpoint === checkpoint
            ? {
                ...manifest,
                divers: manifest.divers.map((diver) =>
                  diver.bookingId === "diver-priya" ? { ...diver, rollCall } : diver,
                ),
              }
            : manifest,
        ),
      },
    };
  }

  it("says “not back aboard” after a dive, and keeps the checkpoint open", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      envelopeWithServerResult("after_dive_1", {
        state: "not_boarded",
        occurredAt: new Date(FROZEN_MS).toISOString(),
        recordedByName: "Dana Divemaster",
      }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const priya = within(document.getElementById("offline-roll-call-diver-priya") as HTMLElement);
    // Both the state pill beside her name and the control below it.
    expect(priya.getAllByText("Not back aboard")).toHaveLength(2);
    expect(priya.queryByText("Not boarded")).not.toBeInTheDocument();
    expect(priya.queryByText("Not boarded ☑️")).not.toBeInTheDocument();
    // The whole roster has a result and the crew were counted — and it still
    // does not read complete, because one diver has not come back.
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "After dive 1 roll call" })).toBeInTheDocument();
  });

  it("keeps the dock's own wording — and its done-check — at departure", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "departure" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      envelopeWithServerResult("departure", {
        state: "not_boarded",
        occurredAt: new Date(FROZEN_MS).toISOString(),
        recordedByName: "Dana Divemaster",
      }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const priya = within(document.getElementById("offline-roll-call-diver-priya") as HTMLElement);
    expect(priya.getAllByText("Not boarded")).toHaveLength(2);
    // Left ashore is a diver accounted for, so this one *is* a settled
    // result — carrying the undo-bearing aria-label, same reasoning as the
    // boarded control above (an aria-label replaces the accessible name,
    // it does not append to the visible words).
    const settled = priya.getByRole("button", { name: "Not boarded — tap again to undo" });
    expect(settled).toHaveTextContent("Not boarded");
    expect(settled.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByText("Not back aboard")).not.toBeInTheDocument();
    expect(await screen.findByText(/Roll call complete/)).toBeInTheDocument();
  });
});

/**
 * The offline roll call and the live manifest are read minutes apart by the
 * same captain — at the dock on one, underway on the other — so a row that
 * folds its reference facts there and stands them open here is one job wearing
 * two layouts (FU-20260810-offline-manifest-checklist-grammar). These pin the
 * grammar itself, not just that the facts are somewhere in the DOM: a closed
 * `<details>` still renders its children, so a `getByText` assertion passes
 * identically before and after this change and proves nothing about it.
 */
describe("the row grammar the live manifest already reads", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
  });

  it("puts a diver's contact and gear behind the same disclosure, under the same words", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const summary = screen.getAllByText("Contact & gear")[0];
    if (!summary) throw new Error("no facts disclosure");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    // Shut at rest, and holding the facts rather than sitting beside them.
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText("Anil Shah · +1-305-555-0177")).toBeTruthy();
  });

  it("says a held seat's details wait for confirmation, rather than 'Not on file' (issue #1690)", async () => {
    // `serializeManifests` saved this seat with the matched person's contact
    // cleared; the identity code on its blockers is how the copy knows why.
    const envelope = richEnvelope("trip-1", { readiness: "blocked" });
    for (const manifest of envelope.snapshot.manifests) {
      manifest.divers = manifest.divers.map((diver) =>
        diver.bookingId === "diver-priya"
          ? {
              ...diver,
              emergencyContactName: null,
              emergencyContactPhone: null,
              readiness: {
                status: "blocked",
                blockers: [
                  {
                    code: "identity_unconfirmed",
                    text: "Matched to this record on a guess: confirm who this is on the roster before boarding.",
                  },
                ],
              },
            }
          : diver,
      );
    }
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const summary = screen.getAllByText("Contact & gear")[0];
    const details = summary?.closest("details") as HTMLElement;
    expect(
      within(details).getByText(
        "Their contact, age and other details wait until the desk confirms who this is.",
      ),
    ).toBeTruthy();
    expect(within(details).queryByText("Not on file")).toBeNull();
  });

  it("reads the saved withheld flag, whatever the blockers say", async () => {
    // The flag is what the save wrote; a seat it marks withheld says so even
    // when the identity code is not the blocker it kept.
    const envelope = richEnvelope("trip-1", { readiness: "blocked" });
    for (const manifest of envelope.snapshot.manifests) {
      manifest.divers = manifest.divers.map((diver) =>
        diver.bookingId === "diver-priya"
          ? {
              ...diver,
              identityWithheld: true,
              emergencyContactName: null,
              emergencyContactPhone: null,
              readiness: {
                status: "blocked",
                blockers: [{ code: "readiness_unavailable", text: "Readiness unavailable." }],
              },
            }
          : diver,
      );
    }
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const summary = screen.getAllByText("Contact & gear")[0];
    const details = summary?.closest("details") as HTMLElement;
    expect(
      within(details).getByText(
        "Their contact, age and other details wait until the desk confirms who this is.",
      ),
    ).toBeTruthy();
  });

  it("draws the unrecorded exception as the live page does, in its panel", async () => {
    // Demoted by where it is — behind the person's panel (#1840) — not by
    // losing its box: inside the panel it is the plain bordered control the
    // live `RollCallExceptionControl` draws, a full dock-sized target in
    // foreground ink.
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const exception = screen.getAllByRole("button", { name: "Mark not boarded" })[0];
    if (!exception) throw new Error("no exception control");
    expect(exception.closest("details[data-roll-call-exception]")).not.toBeNull();
    expect(borderUtilities(exception.className)).toContain("border-border-strong");
    expect(exception.className).not.toContain("text-muted");
    expect(exception.className).not.toContain("danger");
    expect(exception.className).toContain("min-h-14");
  });

  it("gives the box back when the exception control is the row's only one", async () => {
    // A blocked diver at the dock cannot board, so this is the whole row —
    // and a lone control with no box reads as decoration.
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
    const exception = screen.getAllByRole("button", { name: "Mark not boarded" })[0];
    if (!exception) throw new Error("no exception control");
    expect(borderUtilities(exception.className)).not.toEqual([]);
  });
});
