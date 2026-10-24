// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { OfflineRollCallSection } from "./RollCallSection";
import { controls, savedCopy, view } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

/** The save time is one unit, held together by no-break spaces: matched as written. */
const AS_WRITTEN = { normalizer: (text: string) => text };

/**
 * **A saved copy may be missing a diver, or carry one who is gone** (issue
 * #2980, option (a) decided 2026-10-24; domain reviews the same day). A
 * walk-up seated after the save has no row here, and a seat cancelled since
 * still has one, so the roll call names the save time, in its zone, and asks
 * for a head count. No head-count field, no live data merged.
 */
for (const locale of ["en-US", "es-ES"] as const) {
  describe(`the saved-time line under the roll call (${locale})`, () => {
    const t = offlineManifestTranslator(locale);
    const saved = view();
    const when = saved.savedAtZoned;

    it("names the save time in its zone", () => {
      // The fixture's shop is in New York; the zone is named, whatever the phone's.
      expect(when).toMatch(/EDT|GMT-4|UTC-4/);
    });

    it("asks for a count against the live list on a copy served without an answer", () => {
      render(
        <OfflineRollCallSection
          view={saved}
          controls={{ ...controls(), t, locale, copyCaveat: "unanswered" }}
        />,
      );
      const heading = screen.getByRole("heading", { level: 2 });
      const note = screen.getByText(
        t("shared.offlineManifest.single.copyCaveatUnanswered", { when }),
        AS_WRITTEN,
      );
      // Under the roll call's heading, ahead of the first row a captain taps.
      expect(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const firstMark = screen.getAllByRole("button", {
        name: t("shared.offlineManifest.single.markBoarded"),
      })[0];
      expect(note.compareDocumentPosition(firstMark as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("asks for a count on the boat when there is no signal to reach the live list", () => {
      render(
        <OfflineRollCallSection
          view={saved}
          controls={{ ...controls(), t, locale, copyCaveat: "offline" }}
        />,
      );
      expect(
        screen.getByText(
          t("shared.offlineManifest.single.copyCaveatOffline", { when }),
          AS_WRITTEN,
        ),
      ).toBeInTheDocument();
    });

    it("stays off a copy the captain opened with signal", () => {
      render(<OfflineRollCallSection view={saved} controls={{ ...controls(), t, locale }} />);
      expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
      expect(
        screen.queryByText(t("shared.offlineManifest.single.copyCaveatOffline", { when })),
      ).toBeNull();
      expect(
        screen.queryByText(t("shared.offlineManifest.single.copyCaveatUnanswered", { when })),
      ).toBeNull();
    });

    /** A green check and "everyone's aboard" over a list that may be short reads as all clear. */
    it("qualifies a complete roll call as this list's, with no success mark beside the caveat", () => {
      const copy = savedCopy();
      const manifest = copy.snapshot.manifests[0];
      if (!manifest) throw new Error("manifest missing");
      const aboard = {
        state: "boarded" as const,
        occurredAt: copy.snapshot.savedAt,
        recordedByName: "Captain",
      };
      manifest.divers = manifest.divers.map((diver) => ({ ...diver, rollCall: aboard }));
      manifest.crew = manifest.crew.map((member) => ({ ...member, rollCall: aboard }));
      const complete = offlineTripView(copy, "departure");
      if (!complete?.rollCallComplete) throw new Error("the fixture's roll call is complete");
      const { container } = render(
        <OfflineRollCallSection
          view={complete}
          controls={{ ...controls(), t, locale, copyCaveat: "offline" }}
        />,
      );
      expect(screen.getByText(t("shared.offlineManifest.single.allAboard"))).toBeInTheDocument();
      expect(t("shared.offlineManifest.single.allAboard")).toMatch(
        locale === "en-US" ? /on this list/ : /de esta lista/,
      );
      const heading = screen.getByRole("heading", { level: 2 });
      expect(heading.querySelector("svg")).toBeNull();
      expect(container.textContent).toContain(
        t("shared.offlineManifest.single.copyCaveatOffline", {
          when: complete.savedAtZoned,
        }),
      );
    });
  });
}
