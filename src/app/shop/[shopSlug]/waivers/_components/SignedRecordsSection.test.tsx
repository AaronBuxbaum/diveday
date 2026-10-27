// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignedWaiverEntry } from "@/db/waivers";
import { staffTranslator } from "@/i18n/staff-messages";
import { SignedRecordsSection } from "./SignedRecordsSection";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/shop/blue-mantis/waivers",
}));

afterEach(cleanup);

function entry(id: string): SignedWaiverEntry {
  return {
    id,
    personId: `person-${id}`,
    personName: `Diver ${id}`,
    tripId: "trip-1",
    tripTitle: "Reef",
    tripStartsAt: new Date("2026-08-27T11:00:00Z"),
    status: "completed",
    signedAt: new Date("2026-08-28T02:41:00Z"),
    templateVersion: 4,
    templateTitle: "Release",
    signatureMethod: "typed_name",
    recorderName: null,
    recordedAt: null,
    guardian: null,
    integrity: "valid",
    flaggedPrompts: [],
    medicalClearedAt: null,
    medicalClearanceDeclinedAt: null,
  };
}

describe("signed record print scope", () => {
  it.each([
    ["en-US", true],
    ["es-ES", true],
    ["en-US", false],
    ["es-ES", false],
  ] as const)(
    "keeps filtered totals and records while hiding web paging in %s (pin in page: %s)",
    (locale, pinInPage) => {
      const t = staffTranslator(locale);
      const pinned = entry("pin");
      render(
        <SignedRecordsSection
          auditPage={{
            entries: [pinInPage ? pinned : entry("third"), entry("other")],
            page: 2,
            pageCount: 4,
            pageSize: 2,
            total: 7,
          }}
          pinned={pinned}
          query="Diver"
          view="unchecked"
          record={pinned.id}
          shopSlug="blue-mantis"
          locale={locale}
          timezone="America/Cancun"
          t={t}
        />,
      );
      const scope = screen.getByText(
        t("waiversStaff.signatures.pagination.paperSubset", { shown: 2, total: 7 }),
        { exact: false },
      );
      expect(scope).toHaveClass("hidden", "print:block");
      if (!pinInPage)
        expect(scope).toHaveTextContent(t("waiversStaff.signatures.pagination.paperPinned"));
      expect(
        screen.getByRole("navigation", { name: t("shared.pager.label") }).parentElement,
      ).toHaveClass("print:hidden");
      expect(
        screen.getByText(t("shared.pager.position", { page: 2, pageCount: 4 }), { exact: false }),
      ).toHaveTextContent(t("waiversStaff.signatures.pagination.total", { count: 7 }));
      expect(screen.getAllByText("Diver pin")).toHaveLength(1);
      expect(screen.getByText("Diver other")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: t("shared.pager.next") })).toHaveAttribute(
        "href",
        "/shop/blue-mantis/waivers?q=Diver&view=unchecked&page=3&record=pin#signed-records-heading",
      );
    },
  );
});
