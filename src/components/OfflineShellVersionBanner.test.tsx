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
    const worker = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
    render(<OfflineShellVersionBanner copy={copy} />);
    act(() => {
      worker.dispatchEvent(new Event("controllerchange"));
    });
    const banner = await screen.findByText(copy.updateBanner);
    expect(banner).toHaveClass("rounded-inset", "px-4", "py-3", "sm:px-5");
    expect(banner).not.toHaveClass("p-3");
    expect(banner).not.toHaveClass("rounded-lg");
    expect(screen.getByRole("button", { name: copy.refreshButton })).toBeInTheDocument();
  });
});
