// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { ReportExportMenu } from "./ReportExportMenu";

afterEach(cleanup);
const t = staffTranslator("en-US");

describe("report exports", () => {
  it("scopes month files to the month on screen", () => {
    render(<ReportExportMenu t={t} shopSlug="blue-mantis" range={{ month: "2025-08" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/reports/download?month=2025-08",
    );
    expect(screen.getByRole("link", { name: "Download crew sheet" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings/export/crew-sheet?month=2025-08",
    );
  });

  it("offers the selected year's CSV without month-only files", () => {
    render(<ReportExportMenu t={t} shopSlug="blue-mantis" range={{ year: 2025 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/reports/download?year=2025",
    );
    expect(screen.queryByRole("link", { name: "Download crew sheet" })).toBeNull();
  });
});
