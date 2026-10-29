// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOfflineManifest } from "@/lib/offline-manifest-store";
import { OfflineManifestView } from "./OfflineManifestView";
import { setOnline } from "./offline-manifest/view-fixtures";

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
  cleanup();
  vi.clearAllMocks();
});

/**
 * **A saved copy that cannot be opened** (issue 2637). A captain with no
 * signal reads the heading first. When the store read throws, a copy may well
 * exist; "nothing saved" would send them to memory instead of a reload or the
 * printed manifest.
 */
describe("OfflineManifestView — a saved copy that cannot be opened", () => {
  it("says the saved copy could not be opened, never that nothing was saved", async () => {
    setOnline(false);
    vi.mocked(loadOfflineManifest).mockRejectedValue(new Error("decrypt failed"));

    render(<OfflineManifestView />);

    expect(
      await screen.findByRole("heading", { name: "Couldn’t open this phone’s saved copy" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nothing saved on this phone yet")).not.toBeInTheDocument();
    expect(
      screen.getByText("Reload this page once. If it still won’t open, use the printed manifest."),
    ).toBeInTheDocument();
    // The error line is kept, not hidden.
    expect(screen.getByRole("status")).toHaveTextContent(
      "This device couldn’t open its saved manifest.",
    );
  });

  it("keeps the plain empty state when the read succeeds and finds nothing", async () => {
    setOnline(false);
    vi.mocked(loadOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);

    expect(
      await screen.findByRole("heading", { name: "Nothing saved on this phone yet" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t open this phone’s saved copy")).not.toBeInTheDocument();
  });
});
