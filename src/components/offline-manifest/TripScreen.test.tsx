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
import { FROZEN_MS, identityResponse, richEnvelope, setOnline } from "./view-fixtures";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/offline-manifest",
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

const t = staffTranslator("en-US");

/** The saved screen keeps safety facts available through its real Deck doors. */
describe("OfflineManifestView — Deck and saved reference", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(readDiscardedOfflineRecords).mockResolvedValue([]);
  });

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
    await screen.findByRole("heading", { name: t("manifest.deck.title") });
  }

  function openDetails() {
    const summary = screen.getByText(t("manifest.deck.details"), { selector: "summary" });
    if (!summary.closest("details")?.open) fireEvent.click(summary);
  }

  function selectPerson(name: string) {
    fireEvent.click(screen.getByRole("button", { name: t("manifest.deck.find") }));
    fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("heading", { level: 2, name })).toBeVisible();
  }

  function openPersonDetails(name: string) {
    selectPerson(name);
    fireEvent.click(screen.getByRole("button", { name: t("manifest.deck.exception") }));
  }

  it("warns in Details when a saved copy predates the junior checks", async () => {
    const older = richEnvelope("trip-1");
    delete older.snapshot.juniorAdvisoriesChecked;
    await renderTrip(older);
    openDetails();
    expect(screen.getByText(t("shared.offlineManifest.juniorChecksUnavailable"))).toBeVisible();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("does not show the older-copy warning after a fresh save checked advisories", async () => {
    const fresh = richEnvelope("trip-1");
    fresh.snapshot.juniorAdvisoriesChecked = true;
    await renderTrip(fresh);
    openDetails();
    expect(
      screen.queryByText(t("shared.offlineManifest.juniorChecksUnavailable")),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Two-Tank Reef" })).toBeVisible();
  });

  it("opens checkpoint and emergency reference without recording a mark", async () => {
    await renderTrip(richEnvelope("trip-1"));
    openDetails();
    const jump = screen.getByRole("link", { name: "Roll call" });
    expect(jump).toHaveAttribute("href", "#offline-roll-call-context");
    expect(document.getElementById("offline-roll-call-context")).toHaveAttribute("tabindex", "-1");
    fireEvent.click(jump);
    expect(screen.getByRole("navigation", { name: "Roll-call checkpoint" })).toBeVisible();
    expect(screen.getByRole("region", { name: t("manifest.emergency.heading") })).toBeVisible();
    expect(document.getElementById("offline-emergency-reference")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

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
    openDetails();
    const region = screen.getByRole("region", { name: "Mantis I: papers and safety kit" });
    expect(within(region).getByText("No emergency oxygen aboard")).toBeVisible();
    expect(within(region).getByText("AED: pads expire in 12 days")).toBeVisible();
    cleanup();
    await renderTrip(richEnvelope("trip-1"));
    openDetails();
    expect(screen.queryByRole("region", { name: /papers and safety kit/ })).toBeNull();
  });

  it("keeps discarded queued changes visible before opening Details", async () => {
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
    expect(await screen.findByText("Offline changes were removed")).toBeVisible();
    expect(screen.getByText(/Morning Two-Tank/)).toBeVisible();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("states expiry before Details and refuses both a selected guest and crew record", async () => {
    await renderTrip(
      richEnvelope("trip-1", {}, { expiresAt: new Date(FROZEN_MS - 1000).toISOString() }),
    );
    const expiry = screen
      .getAllByRole("status")
      .find((element) => element.textContent?.includes("This saved copy has expired"));
    expect(expiry).toBeVisible();
    selectPerson("Priya Shah");
    const guest = screen.getByRole("button", { name: "Record Priya Shah aboard" });
    expect(guest).toBeDisabled();
    fireEvent.click(guest);
    selectPerson("Sal Ortiz");
    const crew = screen.getByRole("button", { name: "Record Sal Ortiz aboard" });
    expect(crew).toBeDisabled();
    fireEvent.click(crew);
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("keeps a missing named crew report open and offers no routine recording action", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    await renderTrip(
      richEnvelope("trip-1", {
        withCarriedNotBoarded: true,
        crewCalled: true,
        crewNotBackAboard: true,
      }),
    );
    expect(screen.getByRole("button", { name: t("manifest.deck.review") })).toBeVisible();
    selectPerson("Sal Ortiz");
    expect(screen.getByText(t("manifest.deck.missing"), { exact: true })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Record Sal Ortiz aboard" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("manifest.deck.exception") }));
    const crew = screen.getByRole("region", { name: "Crew aboard" });
    expect(within(crew).getByText("Not back aboard", { exact: true, selector: "p" })).toBeVisible();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("selects only the named guest and keeps their emergency contact in the reference disclosure", async () => {
    await renderTrip(dressed(richEnvelope("trip-1", { withCarriedNotBoarded: true })));
    openPersonDetails("Priya Shah");
    expect(screen.queryByRole("heading", { name: "Marcus Reed" })).not.toBeInTheDocument();
    const facts = screen.getByText(t("manifest.diverFactsSummary"));
    fireEvent.click(facts);
    expect(screen.getByText("Anil Shah · +1-305-555-0177", { exact: true })).toBeVisible();
    expect(screen.getByText("Buddy team: Marcus Reed", { exact: true })).toBeVisible();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("keeps a blocked counter seat untappable while its Deck reference remains available", async () => {
    await renderTrip(richEnvelope("trip-1", { readiness: "blocked" }));
    openDetails();
    const counter = screen.getByRole("region", { name: "At the counter" });
    expect(within(counter).getByText("Priya Shah", { exact: true })).toBeVisible();
    expect(within(counter).queryByRole("button", { name: /Priya Shah/ })).not.toBeInTheDocument();
    openPersonDetails("Priya Shah");
    expect(
      screen.queryByRole("button", { name: "Record Priya Shah aboard" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(t("manifest.diverFactsSummary"))).toBeVisible();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("keeps the checklist and arrival actions distinct from the named presence action", async () => {
    await renderTrip(dressed(richEnvelope("trip-1")));
    openDetails();
    expect(screen.getByRole("button", { name: /Emergency oxygen aboard/ })).toBeVisible();
    const arrival = within(screen.getByRole("region", { name: "At the counter" })).getByRole(
      "button",
      { name: /Priya Shah/ },
    );
    expect(arrival).toHaveTextContent("Check in");
    selectPerson("Priya Shah");
    expect(screen.getByRole("button", { name: "Record Priya Shah aboard" })).toBeVisible();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("keeps the chosen checkpoint explicit and changing it records nothing", async () => {
    await renderTrip(richEnvelope("trip-1"));
    openDetails();
    const nav = screen.getByRole("navigation", { name: "Roll-call checkpoint" });
    expect(within(nav).getByRole("button", { name: "Before departure" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(nav).getByRole("button", { name: "After dive 1" }));
    expect(screen.getByText("Two-Tank Reef · After dive 1", { exact: true })).toBeVisible();
    openDetails();
    expect(screen.getByRole("button", { name: "After dive 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("says to tap again with one finger when a palm's press is refused, and records nothing", async () => {
    await renderTrip(richEnvelope("trip-1"));
    selectPerson("Priya Shah");
    await act(async () => {});
    const mark = screen.getByRole("button", { name: "Record Priya Shah aboard" });
    const touch = (type: "pointerDown" | "pointerUp", pointerId: number) =>
      fireEvent[type](document, { pointerId, pointerType: "touch" });
    touch("pointerDown", 1);
    touch("pointerDown", 2);
    fireEvent.click(mark);
    touch("pointerUp", 2);
    touch("pointerUp", 1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(mark).toHaveAttribute("data-touch-refused");
    expect(await screen.findByText("Tap again with one finger.")).toHaveAttribute("role", "status");
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("preserves complete saved buddy names for a selected crew member", async () => {
    await renderTrip(dressed(richEnvelope("trip-1")));
    openPersonDetails("Dana Divemaster");
    expect(
      screen.getByText("Buddy team: Diego Alvarez and June Park", { exact: true }),
    ).toBeVisible();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });
});

describe("OfflineManifestView — empty saved copies", () => {
  it("explains where the device-wide list comes from when nothing is saved", async () => {
    searchParams = new URLSearchParams();
    vi.mocked(listOfflineManifests).mockResolvedValue([]);
    render(<OfflineManifestView />);
    expect(await screen.findByText(/kept here/)).toBeVisible();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
  });

  it("points to the live manifest when the requested trip has no saved copy", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(null);
    render(<OfflineManifestView />);
    expect(await screen.findByText(/open the trip’s live manifest/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Start roll call" })).not.toBeInTheDocument();
  });
});
