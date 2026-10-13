// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { OfflineManifestList } from "./ManifestList";
import { savedCopy } from "./section-fixtures";

// The version banner asks the store for the worker's build on mount; jsdom has
// no worker, so "nothing to warn about" is the answer.
vi.mock("@/lib/offline-manifest-store", async (original) => ({
  ...(await original<typeof import("@/lib/offline-manifest-store")>()),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));

afterEach(cleanup);

describe("OfflineManifestList", () => {
  it("lists the copies saved on this device", () => {
    const { container } = render(
      <OfflineManifestList
        t={offlineManifestTranslator("en-US")}
        shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
        list={[savedCopy()]}
        message=""
        discardNotice={null}
      />,
    );
    expect(container.textContent).toContain("Two-Tank Reef");
  });
});
