// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KEIKO, renderWeek, THURSDAY } from "./staffing-week-test-fixtures";

afterEach(cleanup);
describe("the phone staffing day", () => {
  function branches(container: HTMLElement) {
    const list = container.querySelector<HTMLElement>('[class~="lg:hidden"]');
    if (!list) throw new Error("the week should render a day list");
    return { list };
  }
  /** Thursday on the phone: a shift, a crewed boat the person is away for, and the away line. */
  function renderPhoneDay({ canManage }: { canManage: boolean }) {
    const rendered = renderWeek({
      canManage,
      people: [
        {
          ...KEIKO,
          crewingTrips: [
            {
              tripId: "trip-drift",
              title: "Reef drift",
              meetings: [
                {
                  startsAt: new Date("2026-08-27T13:00:00.000Z"),
                  endsAt: new Date("2026-08-27T17:00:00.000Z"),
                },
              ],
            },
          ],
        },
      ],
      blocks: [
        {
          id: "away-1",
          personId: KEIKO.personId,
          startsOn: THURSDAY,
          endsOn: THURSDAY,
          note: null,
        },
      ],
    });
    const { list } = branches(rendered.container);
    const name = within(list)
      .getAllByText("Keiko Tanaka")
      .find((node) => node.tagName === "P");
    const entries = name?.nextElementSibling as HTMLElement;
    return { ...rendered, list, entries };
  }

  /**
   * K-213: each departure a person crews was one line of blue text, 358×20
   * (or ×40 wrapped), 4px from the next: a thumb aimed at one landed on its
   * neighbour. Each is now a 44px target, and the day's entries abut, so the
   * list keeps one pitch — every entry a 44px line, as a manager's shift
   * already was beside its Remove.
   */
  it("makes each crewed departure on the phone a 44px target in a list of 44px lines", () => {
    for (const canManage of [true, false]) {
      const { list, entries, unmount } = renderPhoneDay({ canManage });
      expect(entries.className).not.toMatch(/(?:^|\s)gap-/);
      expect(entries.children.length).toBe(2);
      for (const entry of entries.children) expect(entry).toHaveClass("min-h-11");
      const door = within(list).getByRole("link", { name: /Reef drift/ });
      expect(door).toHaveClass("flex", "flex-col", "min-h-11", "justify-center");
      unmount();
    }
  });

  it("distinguishes shifts and days away from the departure crew list", () => {
    const { list } = renderPhoneDay({ canManage: true });
    const heading = within(list).getByRole("heading", { name: "Shifts and days away" });
    const person = within(list)
      .getAllByText("Keiko Tanaka")
      .find((node) => node.tagName === "P");
    if (!person) throw new Error("Missing shift owner");
    expect(heading.compareDocumentPosition(person) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the person's full away dates under their own departure", () => {
    const { list } = renderPhoneDay({ canManage: true });
    const warning = within(list).getByText(/^Away Thu/);
    expect(warning.closest("a")).toHaveTextContent("Keiko Tanaka");
    expect(warning.closest("a")).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-drift?view=details#crew",
    );
  });
});
