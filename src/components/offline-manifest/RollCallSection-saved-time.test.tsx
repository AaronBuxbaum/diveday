// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { OfflineRollCallSection } from "./RollCallSection";
import { controls, view } from "./section-fixtures";

afterEach(cleanup);

/**
 * **A copy the worker chose on a slow link may be missing a diver** (issue
 * #2980, option (a) decided 2026-10-24). A walk-up seated after the save has
 * no row here, so the roll call names the save time and asks the captain to
 * count heads against the live list. No head-count field, no live data merged.
 */
for (const locale of ["en-US", "es-ES"] as const) {
  describe(`the saved-time line under the roll call (${locale})`, () => {
    const t = offlineManifestTranslator(locale);
    const saved = view();
    const line = t("shared.offlineManifest.single.unansweredCountHeads", {
      when: saved.dateTime.format(new Date(saved.envelope.snapshot.savedAt)),
    });

    it("names the save time and asks for a head count on a copy served without an answer", () => {
      render(
        <OfflineRollCallSection
          view={saved}
          controls={{ ...controls(), t, locale, servedWithoutAnswer: true }}
        />,
      );
      const heading = screen.getByRole("heading", { level: 2 });
      const note = screen.getByText(line);
      // Under the roll call's heading, ahead of the first row a captain taps.
      expect(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const firstMark = screen.getAllByRole("button", {
        name: t("shared.offlineManifest.single.markBoarded"),
      })[0];
      expect(note.compareDocumentPosition(firstMark as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(within(note).queryByRole("textbox")).toBeNull();
    });

    it("stays off a copy the captain opened", () => {
      render(<OfflineRollCallSection view={saved} controls={{ ...controls(), t, locale }} />);
      expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
      expect(screen.queryByText(line)).toBeNull();
    });
  });
}
