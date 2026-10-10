// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listOfflineManifests,
  loadOfflineManifest,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { OfflineManifestView } from "../OfflineManifestView";
import { ROLL_CALL_MARK_BUTTON_CLASS } from "../RollCallMarkTap";
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
 * **Pixel craft on the dock copy** (docs/design/pixel-craft.md). jsdom lays
 * nothing out, so these pin the class arithmetic that puts each thing on its
 * edge, one cluster of the audit per case; the geometry itself is the pixel
 * probe's to re-measure on the `offline-manifest-*` captures.
 */
describe("OfflineManifestView — one column, one text edge", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(readDiscardedOfflineRecords).mockResolvedValue([]);
  });

  /** A saved copy with a checklist and buddy teams on both lists. */
  function dressed(envelope: OfflineManifestEnvelope): OfflineManifestEnvelope {
    return {
      ...envelope,
      snapshot: {
        ...envelope.snapshot,
        checklist: { items: [{ id: "item-o2", label: "Emergency oxygen aboard" }] },
        manifests: envelope.snapshot.manifests.map((manifest) => ({
          ...manifest,
          crew: manifest.crew.map((member, index) =>
            index === 0 ? { ...member, buddyTeamNames: ["Diego Alvarez", "June Park"] } : member,
          ),
          divers: manifest.divers.map((diver) => ({ ...diver, buddyTeamNames: ["Marcus Reed"] })),
        })),
      },
    };
  }

  async function renderTrip(envelope: OfflineManifestEnvelope) {
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope);
    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
  }

  function crewList(): HTMLElement {
    const list = document.getElementById("offline-crew-roll-call");
    if (!list) throw new Error("crew list missing");
    return list;
  }

  function priyaRow(): HTMLElement {
    const row = document.getElementById("offline-roll-call-diver-priya");
    if (!row) throw new Error("Priya's row missing");
    return row;
  }

  // Dive-domain review 2026-10-09: the dock copy with no signal says what the
  // live Boat tab says about the hull's papers and kit, in the same ink.
  it("shows the boat's papers and safety kit as saved, and nothing for a copy without them", async () => {
    const saved = richEnvelope("trip-1");
    await renderTrip({
      ...saved,
      snapshot: {
        ...saved.snapshot,
        boatSafety: {
          heading: "Mantis I: papers and safety kit",
          lines: [
            { text: "No emergency oxygen aboard", tone: "danger" },
            { text: "AED: pads expire in 12 days", tone: "neutral" },
          ],
        },
      },
    });
    const region = screen.getByRole("region", { name: "Mantis I: papers and safety kit" });
    expect(within(region).getByText("No emergency oxygen aboard").className).toContain(
      "text-danger-strong",
    );
    expect(within(region).getByText("AED: pads expire in 12 days")).toBeInTheDocument();
    cleanup();

    await renderTrip(richEnvelope("trip-1"));
    expect(screen.queryByRole("region", { name: /papers and safety kit/ })).toBeNull();
  });

  // K-183: a `p-3` notice put its text 8px left of the `p-4 sm:p-5` panels
  // below it in the same column (4px at 390).
  it("starts every toned notice's text on the panels' own inset", async () => {
    vi.mocked(readDiscardedOfflineRecords).mockResolvedValue([
      {
        tripId: "trip-9",
        tripTitle: "Morning Two-Tank",
        shopName: "Reef Runners",
        pendingEvents: 2,
        discardedAt: new Date(FROZEN_MS).toISOString(),
      },
    ]);
    await renderTrip(richEnvelope("trip-1"));

    const freshness = screen.getByText(/Readiness reflects that moment/);
    const discarded = (
      await screen.findByText("Roll call that never sent has been removed")
    ).closest("section");
    for (const notice of [freshness, discarded]) {
      expect(notice).toHaveClass("rounded-inset", "px-4", "py-3", "sm:px-5");
      expect(notice).not.toHaveClass("p-3");
    }
  });

  it("starts the expired banner's text on the panels' own inset too", async () => {
    await renderTrip(
      richEnvelope("trip-1", {}, { expiresAt: new Date(FROZEN_MS - 1000).toISOString() }),
    );
    const expired = screen.getByText(/This saved copy has expired/);
    expect(expired).toHaveClass("rounded-inset", "px-4", "py-3", "sm:px-5");
    expect(expired).not.toHaveClass("p-3");
  });

  // K-183 and K-474: the crew box's heading pads like a panel, and its roster
  // is the diver roll call's ruled list laid flush to the box, so the crew
  // controls end where the diver controls below them end.
  it("pads the crew box's heading like a panel and lays its roster flush as ruled rows", async () => {
    await renderTrip(richEnvelope("trip-1"));

    const box = screen.getByRole("region", { name: "Crew aboard" });
    expect(box).toHaveClass("overflow-hidden", "rounded-inset", "border");
    expect(box).not.toHaveClass("p-3");
    expect(screen.getByText("Crew aboard").parentElement).toHaveClass("p-4", "sm:p-5");

    const list = crewList();
    expect(list.parentElement).toBe(box);
    expect(list).toHaveClass("divide-y", "divide-border");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveClass("border-l-4", "p-4", "sm:p-5");
      expect(row).not.toHaveClass("rounded-lg");
      expect(row).not.toHaveClass("px-3");
    }
    // The same inset as a diver's row, which is what puts both lists'
    // controls on one right edge.
    expect(priyaRow()).toHaveClass("border-l-4", "p-4", "sm:p-5");
    // An uncalled crew member wears the roll call's own awaiting tone: the
    // left rule is the edge a card's border used to be.
    expect(rows[0]).toHaveClass("border-border-strong", "bg-surface-sunken");
    // And the box behind that row is not the same fill: on a sunken box the
    // uncalled crew member matched the ground, marked only by a grey rule and
    // hairlines (K-474 review). The live crew list sits in a surface card.
    expect(box).toHaveClass("bg-surface");
    expect(box).not.toHaveClass("bg-surface-sunken");
  });

  it("keeps a missing crew member's row in danger ink", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    await renderTrip(
      richEnvelope("trip-1", {
        withCarriedNotBoarded: true,
        crewCalled: true,
        crewNotBackAboard: true,
      }),
    );
    const row = screen.getByText(/Sal Ortiz · Not back aboard/).closest("li");
    expect(row).toHaveClass("border-danger", "font-bold", "text-danger");
    // The ring is the missing person's, as on every roll-call row. The box
    // keeps its danger border and fill but no inset ring of its own: the
    // flush roster painted over it, so it ringed the heading and stopped
    // where the list began.
    expect(row).toHaveClass("ring-1", "ring-danger/40");
    const box = screen.getByRole("region", { name: "Crew aboard" });
    expect(box).toHaveClass("border-danger", "bg-danger/10");
    expect(box).not.toHaveClass("ring-1");
    expect(box).not.toHaveClass("ring-inset");
  });

  // K-198: on the sunken awaiting row, a sunken chip is invisible, so the
  // number, state word and buddy team each started their ink at a different x.
  it("paints every chip on an awaiting row, so each starts at its painted edge", async () => {
    await renderTrip(dressed(richEnvelope("trip-1")));

    const row = priyaRow();
    expect(row).toHaveClass("bg-surface-sunken");
    const number = within(row).getByText("01");
    expect(number).toHaveClass("bg-surface");
    expect(number).not.toHaveClass("bg-surface-sunken");
    const stateWord = within(row).getByText("Awaiting roll call");
    expect(stateWord).toHaveClass("rounded-full", "border", "border-border", "bg-surface");
    // The row's state in words keeps the ink it had before its box was
    // painted: the pill's edge was the defect, never the word's weight.
    expect(stateWord).toHaveClass("font-semibold");
    expect(stateWord).not.toHaveClass("text-muted");
    expect(stateWord).not.toHaveClass("bg-surface-sunken");
    // The neutral Badge's edge is an inset ring (K-25), the same line as a
    // border, so the chip's box shows on the sunken row.
    expect(within(row).getByText(/Buddy team:/)).toHaveClass(
      "rounded-full",
      "ring-1",
      "ring-inset",
      "ring-border",
    );
  });

  // K-210: a 32px name line top-aligned beside 56px boat buttons rode 12px high.
  // A min height on the whole name line only centred a line that fit on one
  // row, and on most rows the state word and buddy team wrap under the name
  // (32 + 8 + 30 = 70px, past 56), so the *first* flex line takes the
  // buttons' height, through the number chip's wrapper.
  it("gives the name line's first row the boat buttons' height from sm, wrapped or not", async () => {
    await renderTrip(dressed(richEnvelope("trip-1", { withCarriedNotBoarded: true })));
    const list = document.getElementById("offline-roll-call");
    if (!list) throw new Error("diver list missing");
    const rows = [...list.children] as HTMLElement[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const nameLine = within(row).getByRole("heading", { level: 3 }).parentElement;
      if (!nameLine) throw new Error("name line missing");
      expect(nameLine).toHaveClass("flex", "flex-wrap", "items-center");
      expect(nameLine).not.toHaveClass("sm:min-h-14");
      // The row that wraps: its buddy team shares the name's flex box.
      expect(within(nameLine).getByText(/Buddy team:/)).toBeInTheDocument();
      const wrapper = nameLine.firstElementChild;
      expect(wrapper).toHaveClass("flex", "shrink-0", "items-center", "sm:h-14");
      expect(wrapper?.textContent).toMatch(/^\d{2}$/);
      expect(wrapper?.firstElementChild).toHaveClass("size-8", "bg-surface");
    }
  });

  // K-210, the row with no buttons: an expired copy holds one `text-sm`
  // sentence where the buttons were, so a 56px first line would ride the name
  // 18px below it. There the line stays the chip's 32px, and the sentence's
  // first line is centred on it.
  it("keeps an expired row's name line level with its one sentence", async () => {
    await renderTrip(
      dressed(richEnvelope("trip-1", {}, { expiresAt: new Date(FROZEN_MS - 1000).toISOString() })),
    );
    const row = priyaRow();
    const wrapper = within(row).getByText("01").parentElement;
    expect(wrapper).toHaveClass("flex", "shrink-0", "items-center");
    expect(wrapper).not.toHaveClass("sm:h-14");
    expect(within(row).getByText("Expired — record on the live manifest")).toHaveClass(
      "text-sm",
      "sm:py-1.5",
    );
  });

  // K-209: the blocked counter row's `px-4` sat 8px inside the `boat` rows' `px-6`.
  it("insets a blocked counter row like the boat rows beside it", async () => {
    await renderTrip(richEnvelope("trip-1", { readiness: "blocked" }));
    const counter = screen.getByRole("region", { name: "At the counter" });
    const row = within(counter).getByText("Priya Shah").closest("li");
    expect(row).toHaveClass("px-6");
    expect(row).not.toHaveClass("px-4");
  });

  // K-472: one checkbox row, one gap, on both lists.
  it("spaces the checklist's mark and label as the counter spaces its mark and name", async () => {
    await renderTrip(dressed(richEnvelope("trip-1")));
    const check = screen.getByRole("button", { name: /Emergency oxygen aboard/ });
    const counter = within(screen.getByRole("region", { name: "At the counter" })).getByRole(
      "button",
      { name: /Priya Shah/ },
    );
    for (const row of [check, counter]) {
      expect(row).toHaveClass("gap-3");
      expect(row).not.toHaveClass("gap-2");
    }
  });

  // K-473: uppercase, EMBARCADOS needed 86px where a `p-3` tile leaves 75 at
  // 360, and glare's 16px floor put it past any phone tile's inset; the
  // narrowed `px-1.5` tiles that fixed 360 read cramped on every phone.
  it("fits the stat labels to a p-3 tile, and wraps them inside it rather than spilling", async () => {
    await renderTrip(richEnvelope("trip-1"));
    const label = screen.getByText("Awaiting", { selector: "p" });
    expect(label).not.toHaveClass("uppercase");
    expect(label).toHaveClass("hyphens-auto", "wrap-break-word");
    expect(label).toHaveAttribute("lang");
    const tile = label.parentElement;
    expect(tile).toHaveClass("p-3");
    expect(tile?.className).not.toMatch(/(^|\s)(sm:)?p[xy]-/);
    expect(tile?.parentElement).toHaveClass("grid-cols-3", "gap-2", "sm:gap-3");
  });

  // K-496: "After dive 2" dropped alone onto a second row at 390.
  it("lets each wrapped row of checkpoints fill a phone's width", async () => {
    await renderTrip(richEnvelope("trip-1"));
    expect(screen.getByRole("navigation", { name: "Roll-call checkpoint" })).toHaveClass(
      "max-sm:[&>*]:grow",
    );
  });

  // #1840: the circle a crew member learned on the live roll call, not a
  // labelled box of the offline copy's own.
  it("draws the board control as the live page's circle, on the diver rows and the crew rows", async () => {
    await renderTrip(richEnvelope("trip-1"));
    for (const control of [
      within(priyaRow()).getByRole("button", { name: "Mark boarded" }),
      ...within(crewList()).getAllByRole("button", { name: "Mark aboard" }),
    ]) {
      expect(control.className).toBe(ROLL_CALL_MARK_BUTTON_CLASS);
      expect(control.textContent).toBe("");
    }
  });

  // K-594: Spanish paragraphs ended on one word, and "Diego / Alvarez" split.
  it("wraps the notes prettily and never splits a buddy's name", async () => {
    await renderTrip(dressed(richEnvelope("trip-1")));
    expect(screen.getByText(/Readiness reflects that moment/)).toHaveClass("text-pretty");
    expect(screen.getByText(/Buddy teams are shown as saved/)).toHaveClass("text-pretty");
    const crewTeam = within(crewList()).getByText(/Buddy team:/);
    expect(crewTeam.textContent).toContain("Diego\u00a0Alvarez and June\u00a0Park");
    expect(within(priyaRow()).getByText(/Buddy team:/).textContent).toBe(
      "Buddy team: Marcus\u00a0Reed",
    );
  });

  // K-594 review: a name longer than its column cannot be held whole, and the
  // diver list and crew box are both `overflow-hidden`, so a 41-character
  // Spanish name at glare's 16px ran past its column and lost its surname.
  it("breaks an overlong buddy name as a last resort rather than clipping it", async () => {
    await renderTrip(dressed(richEnvelope("trip-1")));
    expect(within(crewList()).getByText(/Buddy team:/)).toHaveClass("wrap-anywhere");
    expect(within(priyaRow()).getByText(/Buddy team:/)).toHaveClass("wrap-anywhere");
  });
});

// K-255: `rounded-3xl` (24px) is off the radius ladder; a panel is 20.
describe("OfflineManifestView — the empty panels sit on the panel rung", () => {
  it("rounds the device-wide empty panel as a panel", async () => {
    searchParams = new URLSearchParams();
    vi.mocked(listOfflineManifests).mockResolvedValue([]);
    render(<OfflineManifestView />);
    const hint = await screen.findByText(/open any shop page/);
    expect(hint.parentElement).toHaveClass("rounded-panel");
    expect(hint.parentElement).not.toHaveClass("rounded-3xl");
  });

  it("rounds the single-trip empty panel as a panel", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(null);
    render(<OfflineManifestView />);
    const hint = await screen.findByText(/open the trip’s live manifest/);
    expect(hint.parentElement).toHaveClass("rounded-panel");
    expect(hint.parentElement).not.toHaveClass("rounded-3xl");
  });
});
