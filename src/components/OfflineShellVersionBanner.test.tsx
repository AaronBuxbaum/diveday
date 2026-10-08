// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveOfflineShellVersion } from "@/lib/offline-manifest-store";
import { OfflineShellVersionBanner } from "./OfflineShellVersionBanner";

vi.mock("@/lib/offline-manifest-store", () => ({
  getActiveOfflineShellVersion: vi.fn(),
}));

const copy = {
  staleBanner: "This saved copy is from an older version.",
  updateBanner: "A newer version is ready.",
  refreshButton: "Refresh",
};

afterEach(() => {
  cleanup();
  // jsdom has no service worker; the update case below lends it one.
  Reflect.deleteProperty(navigator, "serviceWorker");
});

/** A stand-in for `navigator.serviceWorker`, controlled by `controller` (or nothing). */
function lendServiceWorker(controller: object | null) {
  const worker = Object.assign(new EventTarget(), { controller });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
  return worker;
}

/** A worker taking control of the page, as `clients.claim()` makes one. */
function takeOver(worker: EventTarget & { controller: object | null }, next: object) {
  act(() => {
    worker.controller = next;
    worker.dispatchEvent(new Event("controllerchange"));
  });
}

/**
 * Issue #1971. `controllerchange` also fires when the very first worker
 * takes control of a page that had none, which is a fresh install rather
 * than a newer version, and "A newer version is ready" said otherwise on a
 * phone's first visit. Only a change from one controller to another is an
 * update.
 */
describe("OfflineShellVersionBanner — what counts as an update", () => {
  it("says nothing when the first worker takes control", async () => {
    vi.mocked(getActiveOfflineShellVersion).mockResolvedValue(null);
    const worker = lendServiceWorker(null);
    render(<OfflineShellVersionBanner copy={copy} />);
    takeOver(worker, { scriptURL: "/manifest-sw.js?v=1" });
    await act(async () => {});
    expect(screen.queryByText(copy.updateBanner)).toBeNull();
  });

  it("announces the next worker after a first one took control in this session", async () => {
    vi.mocked(getActiveOfflineShellVersion).mockResolvedValue(null);
    const worker = lendServiceWorker(null);
    render(<OfflineShellVersionBanner copy={copy} />);
    takeOver(worker, { scriptURL: "/manifest-sw.js?v=1" });
    expect(screen.queryByText(copy.updateBanner)).toBeNull();
    takeOver(worker, { scriptURL: "/manifest-sw.js?v=2" });
    expect(await screen.findByText(copy.updateBanner)).toBeInTheDocument();
  });

  it("announces a worker replacing the one that controlled the page on load", async () => {
    vi.mocked(getActiveOfflineShellVersion).mockResolvedValue(null);
    const worker = lendServiceWorker({ scriptURL: "/manifest-sw.js?v=1" });
    render(<OfflineShellVersionBanner copy={copy} />);
    takeOver(worker, { scriptURL: "/manifest-sw.js?v=2" });
    expect(await screen.findByText(copy.updateBanner)).toBeInTheDocument();
  });
});

/**
 * K-183: both banners sit at the top of the offline views, in the column the
 * dock copy's own notices and panels start their text on. As `rounded-lg … p-3`
 * boxes they started theirs 8px left of that edge (4px on a phone), a second
 * text edge above the first.
 */
describe("OfflineShellVersionBanner — the offline notices' own inset", () => {
  it("starts the stale-shell banner's text on the panels' inset", async () => {
    vi.mocked(getActiveOfflineShellVersion).mockResolvedValue("v0-older");
    render(<OfflineShellVersionBanner copy={copy} />);
    const banner = await screen.findByText(copy.staleBanner);
    expect(banner).toHaveClass("rounded-inset", "px-4", "py-3", "sm:px-5");
    expect(banner).not.toHaveClass("p-3");
    expect(banner).not.toHaveClass("rounded-lg");
  });

  it("starts the update banner's text on the panels' inset too", async () => {
    vi.mocked(getActiveOfflineShellVersion).mockResolvedValue(null);
    const worker = lendServiceWorker({ scriptURL: "/manifest-sw.js?v=old" });
    render(<OfflineShellVersionBanner copy={copy} />);
    takeOver(worker, { scriptURL: "/manifest-sw.js?v=new" });
    const banner = await screen.findByText(copy.updateBanner);
    expect(banner).toHaveClass("rounded-inset", "px-4", "py-3", "sm:px-5");
    expect(banner).not.toHaveClass("p-3");
    expect(banner).not.toHaveClass("rounded-lg");
    expect(screen.getByRole("button", { name: copy.refreshButton })).toBeInTheDocument();
  });
});
