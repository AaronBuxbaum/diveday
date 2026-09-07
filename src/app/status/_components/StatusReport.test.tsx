// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import type { PlatformComponent } from "@/lib/platform-status";
import { StatusReport } from "./StatusReport";

afterEach(cleanup);

const HEALTHY: PlatformComponent[] = [
  { id: "serving", state: "up" },
  { id: "database", state: "up" },
];

const DB_GONE: PlatformComponent[] = [
  { id: "serving", state: "up" },
  { id: "database", state: "down" },
];

function renderReport(
  status: Parameters<typeof StatusReport>[0]["status"],
  components: PlatformComponent[],
) {
  render(
    <StatusReport
      locale={DEFAULT_DIVER_LOCALE}
      status={status}
      components={components}
      checkedAt="Sep 7, 3:04 PM UTC"
      supportEmail="support@dive.day"
    />,
  );
}

/**
 * The page is one sentence and two rows, so what is worth pinning is not the
 * layout but the honesty: that a failed dependency is *said*, that the
 * timestamp is on the page, and that neither is a colour a reader has to
 * decode.
 */
describe("StatusReport", () => {
  it("answers the question in the heading when everything is up", () => {
    renderReport("ok", HEALTHY);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Everything is running.");
  });

  it("says the app is serving and the database is not, rather than one blended verdict", () => {
    // The failure the page exists for. A shop owner whose bookings are all
    // failing must be able to read "the app is up, the database is not" off it,
    // because that is the difference between their wifi and our incident.
    renderReport("degraded", DB_GONE);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Part of DiveDay is not working.",
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("The app");
    expect(rows[0]).toHaveTextContent("Running");
    expect(rows[1]).toHaveTextContent("The database");
    expect(rows[1]).toHaveTextContent("Not answering");
  });

  it("states when it checked, in words rather than in a fresh-looking layout", () => {
    renderReport("ok", HEALTHY);
    expect(screen.getByText("Last checked Sep 7, 3:04 PM UTC.")).toBeInTheDocument();
  });

  it("carries the state in the row's text, never in colour alone", () => {
    renderReport("degraded", DB_GONE);
    // Every drawn mark is aria-hidden; the words are what assistive technology
    // and a monochrome print both read.
    for (const mark of document.querySelectorAll("svg")) {
      expect(mark).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.getByText("Not answering")).toBeInTheDocument();
  });

  it("tells a reader where to write when the page and their experience disagree", () => {
    renderReport("ok", HEALTHY);
    expect(screen.getByText(/support@dive\.day/)).toBeInTheDocument();
  });
});
