// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { loadOfflineManifest } from "@/lib/offline-manifest-store";
import { OfflineManifestView } from "./OfflineManifestView";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ trip: "trip-1" }),
}));
vi.mock("@/lib/offline-manifest-store", async () => ({
  OfflineManifestError: (
    await vi.importActual<typeof import("@/lib/offline-manifest-store")>(
      "@/lib/offline-manifest-store",
    )
  ).OfflineManifestError,
  appendOfflineArrival: vi.fn(),
  appendOfflineRollCall: vi.fn(),
  beginOfflineTenantVerificationRound: vi.fn().mockResolvedValue(1),
  listOfflineManifests: vi.fn().mockResolvedValue([]),
  loadOfflineManifest: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue([]),
  syncOfflineManifest: vi.fn(),
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
  subscribeOfflineManifestChanges: vi.fn(() => () => {}),
}));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The server has no device language and renders the default; a phone set to
 * Spanish hydrated Spanish words over that English, and React threw the
 * server's markup away (#418), which the offline roll-call capture in Spanish
 * caught. The server and the hydrating render have to draw the same thing.
 */
describe("OfflineManifestView — hydrating on a phone in another language", () => {
  it("hydrates a Spanish phone over the server's markup without a mismatch", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(null);
    vi.stubGlobal("navigator", undefined);
    const html = renderToString(<OfflineManifestView />);
    // Offline: nothing reaches for the network while the copy is read.
    vi.stubGlobal("navigator", { language: "es-ES", onLine: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const recoverable = vi.fn();
    const root = await act(async () =>
      hydrateRoot(container, <OfflineManifestView />, { onRecoverableError: recoverable }),
    );

    const es = offlineManifestTranslator("es-ES");
    expect(
      await screen.findByRole("heading", {
        name: es("shared.offlineManifest.single.emptyHeading"),
      }),
    ).toBeTruthy();
    expect(recoverable).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
