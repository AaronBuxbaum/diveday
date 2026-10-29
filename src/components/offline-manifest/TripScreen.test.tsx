// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  appendOfflineRollCall,
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
  beginOfflineTenantVerificationRound: vi.fn().mockResolvedValue(1),
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
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue([]),
  syncOfflineManifest: vi.fn(),
  // The retention ceiling's discard notice: nothing thrown away is the right
  // default for every test that isn't about one.
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  // The version-mismatch banner (task 124) resolves this on mount; no active
  // worker in jsdom, so "nothing to warn about" is the correct default here.
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
  subscribeOfflineManifestChanges: vi.fn(() => () => {}),
}));

beforeEach(() => {
  searchParams = new URLSearchParams();
  setOnline(true);
  vi.mocked(listOfflineManifests).mockResolvedValue([]);
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

  it("warns when a saved copy predates the junior checks", async () => {
    const legacy = richEnvelope("trip-1");
    delete legacy.snapshot.juniorAdvisoriesChecked;
    await renderTrip(legacy);
    expect(
      screen.getByText(staffTranslator("en-US")("shared.offlineManifest.juniorChecksUnavailable")),
    ).toBeVisible();
  });

  it("does not show the legacy warning after a fresh save checked advisories", async () => {
    const fresh = richEnvelope("trip-1");
    fresh.snapshot.juniorAdvisoriesChecked = true;
    await renderTrip(fresh);
    expect(
      screen.queryByText(
        staffTranslator("en-US")("shared.offlineManifest.juniorChecksUnavailable"),
      ),
    ).not.toBeInTheDocument();
  });

  it("offers visible roll-call context and an emergency return without recording a mark", async () => {
    await renderTrip(richEnvelope("trip-1"));
    const jump = screen.getByRole("link", { name: "Roll call" });
    expect(jump).toHaveAttribute("href", "#offline-roll-call-context");
    const context = document.getElementById("offline-roll-call-context");
    expect(context).toHaveAttribute("tabindex", "-1");
    expect(context?.querySelector("#offline-roll-call")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: staffTranslator("en-US")("manifest.emergency.heading") }),
    ).toHaveAttribute("href", "#offline-emergency-reference");
    fireEvent.click(jump);
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

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
      "text-danger",
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
        noticeId: "notice-trip-9",
        tripId: "trip-9",
        tripTitle: "Morning Two-Tank",
        shopName: "Reef Runners",
        shopSlug: "blue-mantis",
        pendingEvents: 2,
        discardedAt: new Date(FROZEN_MS).toISOString(),
      },
    ]);
    await renderTrip(richEnvelope("trip-1"));

    const freshness = screen.getByText(/Readiness reflects that moment/);
    const discarded = (await screen.findByText("Offline changes were removed")).closest("section");
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
    const name = within(crewList()).getByRole("heading", { level: 3, name: "Sal Ortiz" });
    const row = name.closest("li");
    expect(row).toHaveClass("border-danger");
    // The words go danger on the status line, the passenger row's shape (B01).
    expect(name.nextElementSibling).toHaveTextContent("Not back aboard");
    expect(name.nextElementSibling).toHaveClass("text-danger");
    // The ring is the missing person's, as on every roll-call row. The box
    // keeps its danger border and fill but no inset ring of its own: the
    // flush roster painted over it, so it ringed the heading and stopped
    // where the list began.
    expect(row).toHaveClass("ring-1", "ring-danger/40");
    const box = screen.getByRole("region", { name: "Crew aboard" });
    // An opaque tint, not a see-through one (dive-domain review of #2341).
    expect(box).toHaveClass("border-danger", "bg-danger-tint");
    expect(box.className).not.toMatch(/\bbg-danger\/\d+/);
    expect(box).not.toHaveClass("ring-1");
    expect(box).not.toHaveClass("ring-inset");
  });

  // K-198: on the sunken awaiting row, a sunken chip is invisible, so the
  // number, state word and buddy team each started their ink at a different x.
  it("draws a saved row as a name, one status line and one disclosure (B01)", async () => {
    await renderTrip(dressed(richEnvelope("trip-1")));

    const row = priyaRow();
    expect(row).toHaveClass("bg-surface-sunken");
    const number = within(row).getByText("01");
    expect(number).toHaveClass("bg-surface");
    // The state in words, at full ink, on the one line under the name: no
    // pill, and no second chip beside it.
    const line = within(row).getByRole("heading", { level: 3 }).parentElement
      ?.nextElementSibling as HTMLElement;
    expect(line.textContent).toMatch(/^Awaiting roll call/);
    expect(line).toHaveClass("font-semibold");
    expect(line).not.toHaveClass("text-muted", "rounded-full");
    expect(row.querySelector("span.rounded-full:not([data-mark-state])")).toBeNull();
    // The buddy team rides in the one facts disclosure under the name; the
    // exception keeps its own deliberate panel under the row (decision 3).
    const column = within(row).getByRole("heading", { level: 3 }).parentElement
      ?.parentElement as HTMLElement;
    expect(column.querySelectorAll("details")).toHaveLength(1);
    expect(
      within(column.querySelector("details") as HTMLElement).getByText(/Buddy team:/),
    ).toBeTruthy();
  });

  // K-210: a 32px name line top-aligned beside 56px boat buttons rode 12px high.
  // A min height on the whole name line only centred a line that fit on one
  // row, and on most rows the state word and buddy team wrap under the name
  // (32 + 8 + 30 = 70px, past 56), so the *first* flex line takes the
  // buttons' height, through the number chip's wrapper.
  it("gives the name line the boat buttons' height from sm, on every row", async () => {
    await renderTrip(dressed(richEnvelope("trip-1", { withCarriedNotBoarded: true })));
    const list = document.getElementById("offline-roll-call");
    if (!list) throw new Error("diver list missing");
    const rows = [...list.children] as HTMLElement[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const nameLine = within(row).getByRole("heading", { level: 3 }).parentElement;
      if (!nameLine) throw new Error("name line missing");
      expect(nameLine).toHaveClass("flex", "items-center");
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
  it("gives a blocked counter row the same flat row and inset as a tappable one (B01)", async () => {
    await renderTrip(richEnvelope("trip-1", { readiness: "blocked" }));
    const counter = screen.getByRole("region", { name: "At the counter" });
    const row = within(counter).getByText("Priya Shah").closest("li");
    const body = row?.firstElementChild;
    expect(body).toHaveClass("flex", "gap-3", "px-4", "py-3");
    // One surface: no sunken, dark or tinted variant on the row itself.
    expect(row?.className ?? "").not.toMatch(/bg-/);
    expect(body?.className ?? "").not.toMatch(/bg-/);
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
  it("lays the checkpoints on one segmented track that never wraps (B06, B51)", async () => {
    await renderTrip(richEnvelope("trip-1"));
    const nav = screen.getByRole("navigation", { name: "Roll-call checkpoint" });
    expect(nav).toHaveClass("grid", "grid-flow-col", "overflow-x-auto");
    expect(nav).not.toHaveClass("flex-wrap");
    // The full name is the accessible name at every width.
    expect(within(nav).getByRole("button", { name: "Before departure" })).toHaveAttribute(
      "aria-pressed",
      "true",
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

  /**
   * **The dock copy answers a refused press the way the live page does**
   * (issue #2328): the same guard, the same cue on the control, the same line.
   */
  it("says to tap again with one finger when a palm's press is refused, and records nothing", async () => {
    await renderTrip(richEnvelope("trip-1"));
    // The heading can be found before the commit that drew it has run its
    // effects, and the cue starts listening in one of them: a press that early
    // was refused with nobody to say so, and this test failed now and then.
    await act(async () => {});
    const mark = within(priyaRow()).getByRole("button", { name: "Mark boarded" });
    const touch = (type: "pointerDown" | "pointerUp", pointerId: number) =>
      fireEvent[type](document, { pointerId, pointerType: "touch" });
    touch("pointerDown", 1);
    touch("pointerDown", 2);
    fireEvent.click(mark);
    touch("pointerUp", 2);
    touch("pointerUp", 1);
    expect(mark).toHaveAttribute("data-touch-refused");
    expect(await screen.findByText("Tap again with one finger.")).toHaveAttribute("role", "status");
    expect(vi.mocked(appendOfflineRollCall)).not.toHaveBeenCalled();
  });

  // K-594: Spanish paragraphs ended on one word, and "Diego / Alvarez" split.
  it("wraps the notes prettily and never splits a buddy's name", async () => {
    await renderTrip(dressed(richEnvelope("trip-1")));
    expect(screen.getByText(/Readiness reflects that moment/)).toHaveClass("text-pretty");
    expect(screen.getByText(/Buddy teams are shown as saved/)).toHaveClass("text-pretty");
    // Body weight, never the heaviest line on the page (B01).
    expect(screen.getByText(/Buddy teams are shown as saved/)).not.toHaveClass("font-semibold");
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
    const hint = await screen.findByText(/kept here/);
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
