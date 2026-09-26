// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The chrome's fallbacks read the session module; the body is what is under test.
vi.mock("@/app/_components/MarketingNav", () => ({ MarketingNavFallback: () => <header /> }));
vi.mock("@/components/MarketingFooter", () => ({ MarketingFooterFallback: () => <footer /> }));

const { default: SpreadsheetSwitchLoading } = await import("./loading");

afterEach(cleanup);

/**
 * **The spreadsheet guide lands where its skeleton stood** (K-410).
 *
 * The skeleton drew two headline bars at every width for a title that is one
 * line from `sm`, a two-line lede where a phone wraps four, 44px bars for the
 * 48px demo and set-up doors, a one-line note for a two-line one, and fact
 * bars a line tall. "Where you are today" painted 264px high at 390 and
 * jumped down when the body streamed in. It is now `GuideBodySkeleton`, the
 * competitor guides' skeleton too, with this guide's own line counts.
 */
describe("the spreadsheet guide's loading state", () => {
  function hero() {
    const { container } = render(<SpreadsheetSwitchLoading />);
    return container.querySelector("main > section")?.firstElementChild;
  }

  it("stands 48px bars for the demo and set-up doors", () => {
    const doors = hero()?.children[4];
    expect(doors?.children).toHaveLength(2);
    for (const bar of Array.from(doors?.children ?? [])) expect(bar).toHaveClass("h-12");
  });

  it("draws the title's second line on a phone only", () => {
    const title = Array.from(hero()?.children[2]?.children ?? []);
    expect(title).toHaveLength(2);
    expect(title[1]).toHaveClass("sm:hidden");
  });

  it("draws the lede's four lines on a phone and two from sm", () => {
    const lede = Array.from(hero()?.children[3]?.children ?? []);
    expect(lede).toHaveLength(4);
    expect(lede.filter((line) => line.classList.contains("sm:hidden"))).toHaveLength(2);
  });
});
