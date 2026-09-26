// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { BackupsSection } from "./BackupsSection";

// The section posts to three server actions; rendering it needs only their
// identity, never their database.
vi.mock("../actions", () => ({
  disconnectBackupAction: vi.fn(),
  saveBackupDestinationAction: vi.fn(),
  testBackupAction: vi.fn(),
}));

afterEach(cleanup);

function renderSection(locale: "en-US" | "es-ES") {
  render(
    <BackupsSection
      t={staffTranslator(locale)}
      locale={locale}
      timeZone="America/New_York"
      destination={null}
      deliveries={{ rows: [], page: 1, pageCount: 1, pageSize: 10, total: 0 }}
      basePath="/shop/blue-mantis/settings/export"
    />,
  );
}

describe("BackupsSection's region hint", () => {
  it.each(["en-US", "es-ES"] as const)(
    "keeps the region code a staffer copies on one line (%s)",
    (locale) => {
      // "us-east-1" broke at its hyphen at 390 (K-589). A non-breaking hyphen
      // would fix the wrap and paste as a different character into the field
      // below it, so the token is wrapped instead.
      renderSection(locale);
      const token = screen.getByText("us-east-1");
      expect(token.tagName).toBe("SPAN");
      expect(token).toHaveClass("whitespace-nowrap");
      expect(token.textContent).toBe("us-east-1");
    },
  );
});
