// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("OfflineManifestList", () => {
  for (const [locale, dates] of [
    [
      "en-US",
      [
        {
          season: "winter",
          startsAt: "2026-01-15T15:00:00.000Z",
          local: "Jan 15, 2026, 10:00 AM",
          zone: "EST",
        },
        {
          season: "summer",
          startsAt: "2026-07-15T15:00:00.000Z",
          local: "Jul 15, 2026, 11:00 AM",
          zone: "EDT",
        },
      ],
    ],
    [
      "es-ES",
      [
        {
          season: "winter",
          startsAt: "2026-01-15T15:00:00.000Z",
          local: "15 ene 2026, 10:00",
          zone: "GMT-5",
        },
        {
          season: "summer",
          startsAt: "2026-07-15T15:00:00.000Z",
          local: "15 jul 2026, 11:00",
          zone: "GMT-4",
        },
      ],
    ],
  ] as const) {
    for (const { season, startsAt, local, zone } of dates) {
      it(`shows the saved shop time zone for ${season} dates in ${locale}`, () => {
        vi.stubEnv("TZ", "UTC");
        vi.spyOn(navigator, "language", "get").mockReturnValue(locale);
        const saved = savedCopy();
        const manifest = saved.snapshot.manifests[0];
        if (!manifest) throw new Error("Expected one saved manifest");
        manifest.trip.startsAt = startsAt;
        const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        expect(deviceTimeZone).not.toBe(saved.snapshot.shop.timezone);
        expect(locale).toBe(navigator.language);
        const { container } = render(
          <OfflineManifestList
            t={offlineManifestTranslator(locale)}
            shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
            list={[saved]}
            message=""
            discardNotice={null}
          />,
        );
        expect(container.textContent).toContain(`${local} ${zone}`);
      });
    }
  }

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

  for (const locale of ["en-US", "es-ES"] as const) {
    it(`explains an unanswered live site on the saved list (${locale})`, () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      const t = offlineManifestTranslator(locale);
      const { container } = render(
        <OfflineManifestList
          t={t}
          shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
          list={[savedCopy()]}
          message=""
          discardNotice={null}
          fallback="slow"
        />,
      );
      expect(container.textContent).toContain(t("shared.offlineManifest.single.unansweredBanner"));
    });
  }

  it("does not say the live site was unanswered while the device is offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const t = offlineManifestTranslator("en-US");
    const { container } = render(
      <OfflineManifestList
        t={t}
        shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
        list={[savedCopy()]}
        message=""
        discardNotice={null}
        fallback="slow"
      />,
    );
    expect(container.textContent).not.toContain(
      t("shared.offlineManifest.single.unansweredBanner"),
    );
  });

  it("warns when a live request failed on an online device", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const t = offlineManifestTranslator("en-US");
    const { container } = render(
      <OfflineManifestList
        t={t}
        shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
        list={[savedCopy()]}
        message=""
        discardNotice={null}
        fallback="failed"
      />,
    );
    expect(container.textContent).toContain(t("shared.offlineManifest.single.unansweredBanner"));
    expect(container.textContent).not.toContain(
      t("shared.offlineManifest.list.freshnessAllCurrent"),
    );
  });

  for (const readFailed of [false, true]) {
    it(`says the live site did not answer without claiming a saved copy (readFailed=${readFailed})`, () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      const { container } = render(
        <OfflineManifestList
          t={offlineManifestTranslator("en-US")}
          shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
          list={[]}
          message=""
          discardNotice={null}
          fallback="slow"
          readFailed={readFailed}
        />,
      );
      expect(container.textContent).toContain("DiveDay didn’t answer.");
      expect(container.textContent).not.toContain("the list this phone saved");
    });
  }

  it("removes the unanswered notice when the device goes offline", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const t = offlineManifestTranslator("en-US");
    const { container } = render(
      <OfflineManifestList
        t={t}
        shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
        list={[savedCopy()]}
        message=""
        discardNotice={null}
        fallback="slow"
      />,
    );
    expect(container.textContent).toContain(t("shared.offlineManifest.single.unansweredBanner"));
    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(container.textContent).not.toContain(
      t("shared.offlineManifest.single.unansweredBanner"),
    );
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
