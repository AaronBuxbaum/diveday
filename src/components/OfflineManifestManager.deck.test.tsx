// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offlineManifestManagerCopy } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/manifest-copy";
import { DeckFlow } from "@/components/offline-manifest/DeckFlow";
import { deckCopy } from "@/components/offline-manifest/deck-copy";
import { savedCopy } from "@/components/offline-manifest/section-fixtures";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { OfflineManifestManager } from "./OfflineManifestManager";

const sync = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("./use-offline-manifest-sync", () => ({ useOfflineManifestSync: () => sync.state }));
afterEach(cleanup);

function setup({ pending = false, message = "" } = {}) {
  const saved = savedCopy();
  saved.snapshot.savedAt = nowDate().toISOString();
  if (pending)
    saved.events.push({
      clientEventId: "queued",
      snapshotId: saved.snapshot.snapshotId,
      snapshotSavedAt: saved.snapshot.savedAt,
      bookingId: "b-priya",
      tripId: "trip-1",
      checkpoint: "departure",
      status: "boarded",
      occurredAt: nowDate().toISOString(),
      syncStatus: "pending",
    });
  sync.state = { tripId: "trip-1", saved, message, busy: false, settled: true, refresh: vi.fn() };
  const t = staffTranslator("en-US");
  return render(
    <DeckFlow
      people={[]}
      copy={deckCopy(t)}
      checkpoint="Departure"
      progress="0 of 0"
      complete={false}
      locale="en-US"
      timeZone="America/New_York"
      details={
        <OfflineManifestManager
          compact
          payload={saved.snapshot}
          locale="en-US"
          copy={offlineManifestManagerCopy(t)}
        />
      }
    />,
  );
}

describe("Deck compact device problems", () => {
  it("keeps healthy device details silent in the routine", () => {
    const { container } = setup();
    expect(container.querySelector("[data-deck-device-status]")).toBeNull();
  });
  it("lifts pending delivery out of the closed Details disclosure", async () => {
    const { container } = setup({ pending: true });
    await waitFor(() => expect(container.querySelector("[data-deck-device-status]")).toBeVisible());
    expect(container.querySelector("[data-deck-device-status]")).toHaveTextContent(
      /pending|waiting|send/i,
    );
  });
  it("keeps a failed sync visible in the routine", async () => {
    setup({ message: "Sync could not reach DiveDay" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sync could not reach DiveDay" })).toBeVisible(),
    );
  });
});
