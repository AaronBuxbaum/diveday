// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadOfflineManifest, syncOfflineManifest } from "@/lib/offline-manifest-store";
import { OfflineManifestView } from "../OfflineManifestView";
import { identityResponse, richEnvelope, setOnline } from "./view-fixtures";

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
  listOfflineManifests: vi.fn().mockResolvedValue([]),
  readOfflineManifestInventory: vi.fn().mockResolvedValue({ manifests: [], incomplete: false }),
  subscribeOfflineManifestChanges: vi.fn(() => () => {}),
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

beforeEach(() => {
  setOnline(false);
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
});

it("shows retained trip-level evidence without calling the checkpoint complete", async () => {
  searchParams = new URLSearchParams({ trip: "trip-1" });
  const saved = richEnvelope("trip-1");
  for (const manifest of saved.snapshot.manifests) {
    manifest.retainedSafetyUnresolved = true;
    manifest.retainedSafetyAlertNeedsReview = true;
  }
  vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
  vi.mocked(syncOfflineManifest).mockResolvedValue(null);
  render(<OfflineManifestView />);
  expect(await screen.findByText(/Unresolved safety evidence needs review/)).toBeInTheDocument();
  expect(screen.getByText(/A safety review alert needs attention/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /roll call complete/i })).not.toBeInTheDocument();
});
