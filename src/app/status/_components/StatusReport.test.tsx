// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import type { PlatformComponent } from "@/lib/platform-status";
import { StatusReport, StatusReportFallback } from "./StatusReport";

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

const tokens = (element: Element | null | undefined) => [...(element?.classList ?? [])];
/** Every padding utility in a class list, variants included (`p-4`, `sm:p-5`, `first:pt-0`). */
const paddings = (element: Element | null | undefined) =>
  tokens(element).filter((token) => /^(?:[\w-]+:)*p[xytbse]?-/.test(token));

/**
 * **Each component's words sit in the middle of their row** (K-402).
 *
 * The rows were `py-3 first:pt-0 last:pb-0` inside a card padded `p-4 sm:p-5`,
 * so each outer row's outer half was the card's padding and its inner half the
 * row's: "The app" sat 4px low in its band and "The database" 4px high in
 * its, and the divider looked nearer the words than the card's edges did. The
 * card is a shell now, the list carries its side padding (so the divider is
 * inset to the words), and every row pads itself the same on both sides.
 */
describe("the component list", () => {
  it("pads every row the same above and below, inside a card that pads nothing", () => {
    renderReport("degraded", DB_GONE);
    const rows = screen.getAllByRole("listitem");
    const list = rows[0]?.parentElement;
    expect(paddings(list?.parentElement)).toEqual([]);
    expect(list).toHaveClass("divide-y", "px-4", "sm:px-5");
    for (const row of rows) expect(paddings(row)).toEqual(["py-3.5"]);
  });
});

/**
 * **The fallback is the report's shape, line for line** (K-403).
 *
 * Its bars were not line boxes: 16px for the 20px eyebrow and checked line,
 * which put the card 8px high, rows of `h-5` bars `gap-7` apart in a padded
 * card 5px shorter than the list, and one 16px bar for a contact line of two
 * 20px lines (three on a phone). It now draws the report's own card, list and
 * rows, and every bar is `h-lh` in the type of the words it stands for.
 */
describe("StatusReportFallback", () => {
  function renderBoth() {
    renderReport("ok", HEALTHY);
    const rows = screen.getAllByRole("listitem");
    const shown = { list: rows[0]?.parentElement, rows };
    const { container } = render(<StatusReportFallback />);
    const list = fallbackList(container);
    return { shown, fallback: { list, rows: Array.from(list?.children ?? []) } };
  }

  /** The column's fourth box is the card; the list is all it holds. */
  const fallbackList = (container: Element) =>
    container.querySelector("main > div")?.children[3]?.firstElementChild;

  it("draws the report's own card, list and rows", () => {
    const { shown, fallback } = renderBoth();
    expect(tokens(fallback.list?.parentElement)).toEqual(tokens(shown.list?.parentElement));
    expect(tokens(fallback.list)).toEqual(tokens(shown.list));
    expect(fallback.rows).toHaveLength(shown.rows.length);
    for (const row of fallback.rows) expect(tokens(row)).toEqual(tokens(shown.rows[0]));
  });

  it("draws every line as a line box of its words' type, the contact line at its wrap", () => {
    const { container } = render(<StatusReportFallback />);
    const column = container.querySelector("main > div");
    const [eyebrow, heading, checked] = Array.from(column?.children ?? []);
    expect(eyebrow).toHaveClass("h-lh", "text-sm");
    expect(heading).toHaveClass("h-lh", "text-3xl");
    expect(checked).toHaveClass("h-lh", "text-sm");
    const rows = Array.from(fallbackList(container)?.children ?? []);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.firstElementChild).toHaveClass("h-lh", "text-base");
    const contact = Array.from(column?.lastElementChild?.children ?? []);
    expect(contact).toHaveLength(3);
    for (const line of contact) expect(line).toHaveClass("h-lh", "text-sm");
    expect(contact.filter((line) => line.classList.contains("sm:hidden"))).toHaveLength(1);
  });
});
