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

  // Dive-domain review D4: a store read that threw is not an empty phone.
  for (const locale of ["en-US", "es-ES"] as const) {
    it(`says the saved copies could not be opened when the read failed (${locale})`, () => {
      const t = offlineManifestTranslator(locale);
      const { container } = render(
        <OfflineManifestList
          t={t}
          shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
          list={[]}
          message=""
          discardNotice={null}
          readFailed
        />,
      );
      expect(container.textContent).toContain(t("shared.offlineManifest.list.readFailedHeading"));
      expect(container.textContent).toContain(t("shared.offlineManifest.single.readFailedHint"));
      expect(container.textContent).not.toContain(t("shared.offlineManifest.list.headingEmpty"));
      expect(container.textContent).not.toContain(t("shared.offlineManifest.list.emptyHint"));
    });
  }
});
