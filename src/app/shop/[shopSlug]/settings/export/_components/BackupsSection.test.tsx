// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShopBackupDelivery } from "@/db/schema";
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

function renderSection(locale: "en-US" | "es-ES", rows: ShopBackupDelivery[] = []) {
  render(
    <BackupsSection
      t={staffTranslator(locale)}
      locale={locale}
      timeZone="America/New_York"
      destination={null}
      deliveries={{ rows, page: 1, pageCount: 1, pageSize: 10, total: rows.length }}
      basePath="/shop/blue-mantis/settings/export"
    />,
  );
}

const DELIVERY: ShopBackupDelivery = {
  id: "00000000-0000-4000-8000-000000000001",
  shopId: "00000000-0000-4000-8000-000000000002",
  periodKey: "2026-W32",
  trigger: "scheduled",
  status: "succeeded",
  objectKey: "diveday/blue-mantis/2026-W32.zip",
  byteCount: 51_000_000,
  errorCode: null,
  startedAt: new Date("2026-08-09T06:00:00Z"),
  finishedAt: new Date("2026-08-09T06:02:00Z"),
};

/**
 * The padding an outer cell has from `sm` on one side, read off its classes
 * the way the cascade settles it: the table's edge step (`sm:first:ps-*`,
 * `sm:last:pe-*`) over an `sm:` side or axis, over the unprefixed ones.
 */
function smEdgePadding(cell: HTMLElement, side: "start" | "end"): string | undefined {
  const [edge, letter] = side === "start" ? ["first", "s"] : ["last", "e"];
  const classes = cell.className.split(/\s+/);
  for (const prefix of [
    `sm:${edge}:p${letter}-`,
    `sm:p${letter}-`,
    "sm:px-",
    `p${letter}-`,
    "px-",
  ]) {
    const hit = classes.find((name) => name.startsWith(prefix));
    if (hit) return hit.slice(prefix.length);
  }
  return undefined;
}

describe("BackupsSection's delivery history", () => {
  it("starts each outer column's values where its heading starts, from sm", () => {
    // A table's headings step their outer edges to 20px from sm, onto the card
    // column (K-20). This table's cells pad themselves, because below sm its
    // rows reflow into stacked lines, so without the same step "When" sat 4px
    // right of every date under it.
    renderSection("en-US", [DELIVERY]);
    const table = screen.getByRole("table");
    const headings = within(table).getAllByRole("columnheader");
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(smEdgePadding(headings[0], "start")).toBe("5");
    expect(smEdgePadding(cells[0], "start")).toBe(smEdgePadding(headings[0], "start"));
    expect(smEdgePadding(cells[cells.length - 1], "end")).toBe(
      smEdgePadding(headings[headings.length - 1], "end"),
    );
  });
});

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
