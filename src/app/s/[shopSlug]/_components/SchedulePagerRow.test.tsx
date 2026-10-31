// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { SchedulePagerRow } from "./SchedulePagerRow";
import { WEEK_LEDGER_FOLLOWER_CLASS } from "./WeekLedger";

const t = diverTranslator("en-US");
const pager = { earlier: "/s/x?before=1", later: "/s/x?after=2", backToNext: "/s/x" };

afterEach(cleanup);

describe("SchedulePagerRow", () => {
  it("links earlier, later and back to the next departures, in that order", () => {
    render(<SchedulePagerRow pager={pager} showsBackToNext followsWeekLedger={false} t={t} />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([pager.earlier, pager.later, pager.backToNext]);
    expect(screen.getByRole("link", { name: t("schedule.showLater") })).toBeTruthy();
  });

  it("drops a direction with nowhere to go, and the way back when the view is not paged", () => {
    render(
      <SchedulePagerRow
        pager={{ ...pager, earlier: null }}
        showsBackToNext={false}
        followsWeekLedger={false}
        t={t}
      />,
    );
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      pager.later,
    ]);
  });

  it("takes the week ledger's hover room under its list, and its own margin otherwise", () => {
    const { container, rerender } = render(
      <SchedulePagerRow pager={pager} showsBackToNext followsWeekLedger t={t} />,
    );
    const firstClass = WEEK_LEDGER_FOLLOWER_CLASS.split(" ")[0] ?? "";
    expect(container.firstElementChild?.className).toContain(firstClass);
    rerender(<SchedulePagerRow pager={pager} showsBackToNext followsWeekLedger={false} t={t} />);
    expect(container.firstElementChild?.className).toContain("mt-5");
  });
});
