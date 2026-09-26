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

/** Where the history stops stacking its rows and draws them as a table. */
const TABLE_FROM = "xl";

/**
 * The padding an outer cell has once the history is a table, on one side,
 * read off its classes the way the cascade settles it: a wider breakpoint over
 * a narrower one, and within one breakpoint the table's edge step
 * (`first:ps-*`, `last:pe-*`) over a side, over an axis.
 */
function edgePaddingAtTable(cell: HTMLElement, side: "start" | "end"): string | undefined {
  const [edge, letter] = side === "start" ? ["first", "s"] : ["last", "e"];
  const classes = cell.className.split(/\s+/);
  for (const breakpoint of [`${TABLE_FROM}:`, "lg:", "md:", "sm:", ""]) {
    for (const prefix of [
      `${breakpoint}${edge}:p${letter}-`,
      `${breakpoint}p${letter}-`,
      `${breakpoint}px-`,
    ]) {
      const hit = classes.find((name) => name.startsWith(prefix));
      if (hit) return hit.slice(prefix.length);
    }
  }
  return undefined;
}

describe("BackupsSection's delivery history", () => {
  it("starts each outer column's values where its heading starts, once it is a table", () => {
    // A table's headings step their outer edges to 20px, onto the card column
    // (K-20). This table's cells pad themselves, because until it is a table
    // its rows reflow into stacked lines, so without the same step "When" sat
    // 4px right of every date under it.
    renderSection("en-US", [DELIVERY]);
    const table = screen.getByRole("table");
    const headings = within(table).getAllByRole("columnheader");
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(edgePaddingAtTable(headings[0], "start")).toBe("5");
    expect(edgePaddingAtTable(cells[0], "start")).toBe(edgePaddingAtTable(headings[0], "start"));
    expect(edgePaddingAtTable(cells[cells.length - 1], "end")).toBe(
      edgePaddingAtTable(headings[headings.length - 1], "end"),
    );
  });

  /**
   * **Five columns only where five columns fit** (K-143, pixel-craft class 9).
   * The table is `table-layout: fixed`, and five headings with no width split
   * it evenly: 134px columns at 1280 cut "Jun 29, 4:00 AM EDT" by 39px, and at
   * the 640 and 1024 edges the table was 540 and 580px wide, where the stamp
   * lost 65px and "Delivered" 30. The stamp and the outcome now state the
   * widths their longest words need, and the rows stay stacked until the
   * table is wide enough to leave Run, Size and Details a share each: at 1024
   * it is 580px, which leaves them 76px each, under "48.6 MB"; from 1280 it
   * is 670px.
   */
  it("gives the stamp and the outcome the widths their longest words need", () => {
    renderSection("en-US", [DELIVERY]);
    const headings = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "When",
      "Run",
      "Outcome",
      "Size",
      "Details",
    ]);
    expect(headings[0]).toHaveClass("w-48");
    expect(headings[2]).toHaveClass("w-40");
    // Run, Size and Details share what is left.
    for (const heading of [headings[1], headings[3], headings[4]]) {
      expect(heading.className).not.toMatch(/(^|\s)w-/);
    }
  });

  it("lets a stamp longer than its column wrap after its comma rather than be cut", () => {
    // "Sep 29, 10:00 PM GMT+10" is a shop in Sydney. The formatter keeps the
    // time and its zone whole (keepUnitsWhole), so the comma is the one place
    // the stamp may end a line; `nowrap` in an `overflow-hidden` cell is what
    // turned a long stamp into a cut one.
    renderSection("en-US", [DELIVERY]);
    const [row] = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const [when] = within(row).getAllByRole("cell");
    expect(when.className).not.toMatch(/whitespace-nowrap/);
  });

  it("stacks its rows until the table is wide enough for five columns", () => {
    renderSection("en-US", [DELIVERY]);
    const table = screen.getByRole("table");
    const head = table.querySelector("thead");
    const body = table.querySelector("tbody");
    const [row] = within(table).getAllByRole("row").slice(1);
    expect(head).toHaveClass("hidden", `${TABLE_FROM}:table-header-group`);
    expect(body).toHaveClass("block", `${TABLE_FROM}:table-row-group`);
    expect(row).toHaveClass("flex", `${TABLE_FROM}:table-row`);
    // Nothing on a stacked line answers to a narrower breakpoint: the table's
    // `sm:` edge step on a stacked stamp would push it 20px in from the row's
    // own inset.
    for (const element of [body, row, ...within(row).getAllByRole("cell")]) {
      expect(element?.className).not.toMatch(/(^|\s)(sm|md|lg):/);
    }
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
