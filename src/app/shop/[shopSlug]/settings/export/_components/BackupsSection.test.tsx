// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShopBackupDelivery, ShopBackupDestination } from "@/db/schema";
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

function renderSection(
  locale: "en-US" | "es-ES",
  rows: ShopBackupDelivery[] = [],
  destination: ShopBackupDestination | null = null,
) {
  return render(
    <BackupsSection
      t={staffTranslator(locale)}
      locale={locale}
      timeZone="America/New_York"
      destination={destination}
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
 * **One stacked block per delivery, at every width** (third review #36). The
 * five-column table it was from `xl` left Details about 60px of a 610px pane at
 * 1280, and the object key broke one syllable per line ("dive day/ dive day-
 * back up-b lue-…"). Each delivery is still a row of cells, so assistive tech
 * and the e2e specs read it as one, but it lays out as lines: the stamp, then
 * run, outcome and size, then the details on a line of their own.
 */
describe("BackupsSection's delivery history", () => {
  it("stacks every row at every width, with no table breakpoint left", () => {
    renderSection("en-US", [DELIVERY]);
    const table = screen.getByRole("table");
    const body = table.querySelector("tbody");
    const [row] = within(table).getAllByRole("row").slice(1);
    expect(body).toHaveClass("block");
    expect(row).toHaveClass("flex", "flex-wrap");
    for (const element of [
      table.querySelector("thead"),
      body,
      row,
      ...within(row).getAllByRole("cell"),
    ]) {
      expect(element?.className).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
    }
  });

  it("gives the object key a line of its own and breaks it only where the line is full", () => {
    renderSection("en-US", [DELIVERY]);
    const [row] = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const cells = within(row).getAllByRole("cell");
    const details = cells[cells.length - 1];
    expect(details).toHaveClass("basis-full");
    const key = within(details).getByText(DELIVERY.objectKey as string);
    expect(key.className).not.toMatch(/break-all/);
    expect(key).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("keeps the five headings for a screen reader", () => {
    renderSection("en-US", [DELIVERY]);
    const table = screen.getByRole("table");
    expect(table.querySelector("thead")).toHaveClass("sr-only");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((heading) => heading.textContent),
    ).toEqual(["When", "Run", "Outcome", "Size", "Details"]);
  });

  it("lets a long stamp wrap after its comma rather than be cut", () => {
    // "Sep 29, 10:00 PM GMT+10" is a shop in Sydney. The formatter keeps the
    // time and its zone whole (keepUnitsWhole), so the comma is the one place
    // the stamp may end a line.
    renderSection("en-US", [DELIVERY]);
    const [row] = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const [when] = within(row).getAllByRole("cell");
    expect(when.className).not.toMatch(/whitespace-nowrap/);
    expect(when).toHaveClass("basis-full");
  });
});

const DESTINATION: ShopBackupDestination = {
  shopId: "00000000-0000-4000-8000-000000000002",
  endpoint: "https://accountid.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "diveday",
  prefix: "blue-mantis/",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKeySealed: "sealed",
  connectedAt: new Date("2026-08-01T12:00:00Z"),
  verifiedAt: new Date("2026-08-09T06:02:00Z"),
  updatedAt: new Date("2026-08-01T12:00:00Z"),
};

describe("BackupsSection's destination summary", () => {
  it("keeps identifiers in closed destination details while showing last successful delivery", () => {
    const { container } = renderSection("en-US", [], DESTINATION);
    const details = screen.getByText("Destination details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText(/Last successful delivery/)).toBeVisible();
    expect(container.querySelector('input[name="accessKeyId"]')?.closest("details")).toBe(details);
    expect(container.querySelector('input[name="secretAccessKey"]')).toHaveValue("");
  });

  it("opens destination setup when no destination exists", () => {
    renderSection("en-US");
    expect(screen.getByText("Destination details").closest("details")).toHaveAttribute("open");
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
