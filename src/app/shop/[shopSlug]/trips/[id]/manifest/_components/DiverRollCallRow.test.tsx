// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripManifest } from "@/lib/manifests";
import { DiverRollCallRow } from "./DiverRollCallRow";
import {
  boardedAt,
  dangerToned,
  diver,
  diverContext,
  notBackAt,
  renderList,
  t,
} from "./diver-roll-call-test-fixtures";

afterEach(cleanup);

/**
 * **A blocked diver's mark still says what was recorded** (review of #1840).
 * Readiness takes the tap away at the dock, but it must not take the fact
 * away: a diver blocked *and* recorded aboard drew the empty dashed "held"
 * ring while the pill beside it said Boarded — the rail's one picture of
 * where a person is, saying nobody had called them.
 */
describe("a blocked diver's mark at the dock", () => {
  const blocked = {
    status: "blocked",
    blockers: [{ code: "certification_missing" }],
  } as TripManifest["divers"][number]["readiness"];
  const markOf = (container: HTMLElement) =>
    container.querySelector("[data-mark-state]")?.getAttribute("data-mark-state");

  it("draws aboard for a blocked diver recorded aboard, with no tap", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [diver({ readiness: blocked, rollCall: boardedAt() })],
    });
    expect(markOf(container)).toBe("aboard");
    expect(screen.queryByRole("button", { name: /Boarded|Mark boarded/ })).not.toBeInTheDocument();
  });

  it("draws ashore for a blocked diver recorded not boarded", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [diver({ readiness: blocked, rollCall: notBackAt() })],
    });
    expect(markOf(container)).toBe("ashore");
  });

  // The row says it too (review of #1840): aboard over a block is the
  // count's loud line ("1 blocked person aboard", HeadCount), so the row
  // wears the blocked tone, not the calm boarded green. The circle still
  // draws aboard — the tone is the exception, the mark is the fact.
  it("wears the blocked tone on a blocked diver recorded aboard", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [diver({ readiness: blocked, rollCall: boardedAt() })],
    });
    const row = container.querySelector("li[id^='diver-row-']") as HTMLElement;
    expect(row.className).toContain("border-danger");
    expect(row.className).not.toContain("bg-success-tint");
    expect(markOf(container)).toBe("aboard");
  });

  it("draws held only while nothing is recorded", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [diver({ readiness: blocked })],
    });
    expect(markOf(container)).toBe("held");
  });
});

/**
 * **The mark keeps room for its focus ring on the last row.** The roll-call
 * card is `overflow-hidden`. While glare's 44px floor shrank the name button
 * to 52px (#1981), the mark column set the
 * row's height, and the last row's mark ended on the card's bottom edge: its
 * 5px ring lost its bottom (pixel probe, `manifest-seen-boat-mode`). Pinned as
 * structure, because jsdom has no layout; the probe measures the ring.
 */
describe("the mark's room for its focus ring", () => {
  it("pads the mark's column as much below the mark as above it (py-2.5), beside the name button in the same row", () => {
    renderList({ divers: [diver()] });
    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });
    const column = trigger.parentElement?.lastElementChild as HTMLElement;
    expect(column).not.toBe(trigger);
    expect(column.querySelector("button")).not.toBeNull();
    expect(column).toHaveClass("py-2.5");
    expect(column.className).not.toMatch(/(^|\s)p[tb]-/);
  });

  it("draws the mark as a circle, so the ring around it is one too", () => {
    // It asked for `rounded-full` through `className`, which lost to the
    // button's own `rounded-lg`: a 56px rounded square with a rounded-square
    // ring (pixel probe, K-44). A radius the class list carries twice is the
    // defect, whichever one wins.
    renderList({ divers: [diver()] });
    const mark = within(screen.getByRole("listitem")).getByRole("button", {
      name: "Mark boarded",
    });
    expect(mark).toHaveClass("rounded-full");
    expect(mark).not.toHaveClass("rounded-lg");
  });

  it("takes the tap over the whole mark column, not only inside its circle", () => {
    // A browser clips a hit area to the border radius, so the round mark lost
    // its square's corners as a target, and a thumb there met the column's
    // bare padding (K-44 review). A stretched `::after` is the target, reaching
    // exactly as far as the column's own padding.
    renderList({ divers: [diver()] });
    const mark = within(screen.getByRole("listitem")).getByRole("button", {
      name: "Mark boarded",
    });
    const column = mark.closest("div.shrink-0") as HTMLElement;
    expect(column).toHaveClass("py-2.5", "ps-3", "pe-3");
    expect(mark).toHaveClass(
      "relative",
      "after:absolute",
      "after:-inset-y-2.5",
      "after:-inset-x-3",
    );
    expect(mark.className).not.toMatch(/after:rounded/);
  });
});

/**
 * **The mark centres on the row it sits in** (K-266). The row was
 * `flex items-start` and the mark's column held it 10px from the top, which
 * centres a 56px mark only on a 76px name button. A name that wraps grows the
 * button, its index and caret move to the new middle, and the mark stayed up:
 * 19px above them on a phone. The mark rides in `PersonSheet`'s trailing slot,
 * one `items-center` row with the button, so it centres on the button's real
 * height.
 */
describe("the mark beside a name that wraps", () => {
  it("sits in the name button's own items-center row", () => {
    renderList({ divers: [diver()] });
    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });
    const row = trigger.parentElement as HTMLElement;
    expect(row).toHaveClass("flex", "items-center");
    expect(row.className).not.toMatch(/items-start/);
    const mark = within(screen.getByRole("listitem")).getByRole("button", {
      name: "Mark boarded",
    });
    expect(row).toContainElement(mark);
  });
});

/**
 * **A diver first counted aboard after a dive is boarding then** (domain
 * review of #2123): they joined at the second site, so the row says what the
 * dock would have said about their readiness. The tap stays — after a dive the
 * roll call is a head count readiness never gates — but the crew decide with
 * the blocker in view.
 */
describe("a diver with no earlier boarding, after a dive", () => {
  const blocked: TripManifest["divers"][number]["readiness"] = {
    status: "blocked",
    blockers: [{ code: "certification_missing" }],
  };

  it("shows the dock's readiness warning, and keeps the tap", () => {
    const { container } = renderList({
      divers: [diver({ readiness: blocked, boardedEarlier: false })],
    });
    expect(dangerToned(container).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Mark boarded" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(t("manifest.resolveBlockersLink"));
  });

  it("puts no paperwork word on a diver recorded not back aboard", () => {
    renderList({
      divers: [diver({ readiness: blocked, boardedEarlier: false, rollCall: notBackAt() })],
    });
    // Paper still carries the readiness word (the print-only block); the
    // screen's capsule is the alarm alone.
    const onScreen = screen
      .queryAllByText("Blocked")
      .filter((element) => !element.closest(".hidden.print\\:block"));
    expect(onScreen).toHaveLength(0);
  });

  it("shows no other capsule beside a diver recorded not back aboard", () => {
    renderList({
      divers: [
        diver({
          readiness: blocked,
          boardedEarlier: true,
          birthday: { status: "today" },
          rollCall: notBackAt(),
        }),
      ],
    });
    const onScreen = screen
      .queryAllByText(/Birthday/)
      .filter((element) => !element.closest(".hidden.print\\:block"));
    expect(onScreen).toHaveLength(0);
  });

  it("keeps the split buddy team's alert beside a diver recorded not back aboard", () => {
    renderList({
      divers: [
        diver({
          boardedEarlier: true,
          buddyAlert: "separated_after_dive",
          buddyTeam: { teamId: "t-1", others: [] },
          rollCall: notBackAt(),
        }),
      ],
    });
    const onScreen = screen
      .queryAllByText("Buddy not back aboard")
      .filter((element) => !element.closest(".hidden.print\\:block"));
    expect(onScreen.length).toBeGreaterThan(0);
  });

  it("stays quiet for a diver counted aboard earlier", () => {
    const { container } = renderList({
      divers: [diver({ readiness: blocked, boardedEarlier: true })],
    });
    expect(dangerToned(container)).toHaveLength(0);
  });
});

describe("DiverRollCallRow, drawn on its own", () => {
  it("is one list item carrying the diver's row id and the alarm's screen order", () => {
    const missing = diver({ rollCall: notBackAt() });
    const { container } = render(
      <ul>
        <DiverRollCallRow
          context={diverContext({ divers: [missing] })}
          diver={missing}
          index={0}
          divers={[missing]}
          firstOnScreenBookingId={missing.bookingId}
          sharedAdvisoryTexts={new Set()}
        />
      </ul>,
    );
    const row = container.querySelector("li") as HTMLElement;
    expect(row.id).toBe(`diver-row-${missing.bookingId}`);
    expect(row.className).toContain("order-first");
    expect(row.className).toContain("print:order-none");
  });
});

/**
 * **The person sheet says role and age once, status as a line, and keeps one
 * primary at its foot** (visual review 2026-10-24, B08). The contact card holds
 * the contact alone; the minor flag stays where it was.
 */
describe("the person sheet's head and foot", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("button", { name: /Open details for Meera Iyer/ }));

  it("puts the age in the subtitle and drops the lone age chip", () => {
    renderList({ checkpoint: "departure", divers: [diver({ age: 27, minor: false })] });
    open();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Diver · age 27")).toBeInTheDocument();
    expect(within(dialog).queryByText("Age 27")).toBeNull();
    // Status in words under the name, not a chip in the header's actions.
    expect(dialog).toHaveAccessibleDescription(/Diver · age 27/);
  });

  it("keeps the minor flag for a minor whose row lost the capsule to a block", () => {
    renderList({
      checkpoint: "departure",
      divers: [
        diver({
          age: 12,
          minor: true,
          readiness: {
            status: "blocked",
            blockers: [{ code: "certification_missing" }],
          } as TripManifest["divers"][number]["readiness"],
        }),
      ],
    });
    open();
    expect(within(screen.getByRole("dialog")).getByText(/12/, { selector: "span" })).toBeVisible();
  });

  it("holds only the contact in its card, with the exception step outside it and never filled", () => {
    renderList({ checkpoint: "departure", divers: [diver({ age: 27, minor: false })] });
    open();
    const dialog = screen.getByRole("dialog");
    const contact = within(dialog)
      .getByText(/Asha Iyer/)
      .closest("p") as HTMLElement;
    expect(contact).toHaveClass("rounded-inset");
    const step = within(dialog).getByRole("button", { name: "Mark not boarded" });
    expect(contact).not.toContainElement(step);
    // dde-a F1: the exception is the deliberate second step. It must never
    // wear the action color a crew taps for the act itself.
    expect(step).not.toHaveClass("bg-primary");
    expect(step).not.toHaveClass("text-primary-foreground");
    expect(step).toHaveClass("bg-surface", "border-border-strong");
    for (const button of within(dialog).getAllByRole("button")) {
      if (/not boarded|not back aboard/i.test(button.textContent ?? "")) {
        expect(button).not.toHaveClass("bg-primary");
      }
    }
  });
});
