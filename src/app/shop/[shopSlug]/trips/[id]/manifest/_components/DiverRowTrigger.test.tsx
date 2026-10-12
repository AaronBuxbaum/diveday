// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiverRowTrigger } from "./DiverRowTrigger";
import {
  dangerToned,
  diver,
  renderList,
  type TestLocale,
  TRANSLATORS,
  t,
} from "./diver-roll-call-test-fixtures";

afterEach(cleanup);

/**
 * **The capsule has the whole row's width** (issue #2008). A Badge never wraps,
 * and the longest capsule ("Someone unaccounted for", "Alguien sin
 * contabilizar") is wider than the name column at 390px, so beside the name it
 * would spill over the caret and the mark. It takes its own line under the
 * row, from the index's edge to the caret's, still inside the name button:
 * the tap target and what the button opens are unchanged. jsdom has no
 * layout, so this pins the structure that gives it the room.
 */
describe("the exception capsule's line", () => {
  function capsuleLine(row: HTMLElement, text: string) {
    const pill = within(row).getByText(text);
    const line = pill.parentElement;
    if (!line) throw new Error("no line around the capsule");
    return { pill, line };
  }

  it.each([
    ["a birthday", diver({ birthday: { status: "today" } }), "Birthday today"],
    ["a seat the desk wrote off", diver({ notHere: true }), "Not here"],
  ] as const)("puts %s on a full-width line inside the name button", (_label, row, text) => {
    const { container } = renderList({ divers: [row] });
    const { pill, line } = capsuleLine(container, text);
    const button = line.parentElement;
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.className).toContain("flex-wrap");
    expect(line.className).toContain("basis-full");
    // Not inside the name's own column, whose width is what ran out.
    const name = within(container).getByText("Meera Iyer");
    expect(name.closest(".flex-1")?.contains(pill)).toBe(false);
  });

  it("renders no empty line for a row with no exception", () => {
    const { container } = renderList({ divers: [diver()] });
    expect(container.querySelector(".basis-full")).toBeNull();
  });
});

/**
 * The welcome word (issue #1182, delight report D22; ADR
 * 20260904-reef-all-the-way-down slice 16d). D22's boundary is that a cue
 * invites a human welcome and is never a profile badge, so what these assert is
 * the difference: muted text under the name, at manifest size, outside the
 * row's one-capsule chain.
 */
describe("the welcome word", () => {
  /** The element carrying the cue's words, wherever it sits in the row. */
  function welcomeLine(container: HTMLElement, text: string) {
    return [...container.querySelectorAll<HTMLElement>("span")].find(
      (element) => element.textContent === text,
    );
  }

  it("says nothing about a diver who consented to nothing", () => {
    const { container } = renderList({ divers: [diver()] });
    expect(container.textContent).not.toContain("first time with us");
  });

  it("renders as muted text under the name, at 16px", () => {
    const { container } = renderList({
      divers: [diver({ welcomeCue: { kind: "first_trip" } })],
    });
    const line = welcomeLine(container, "first time with us");
    expect(line).toBeDefined();
    // `text-base`, not the 12.5px the canvas drew: this is a safety surface,
    // where the licence to trade legibility for restraint stops.
    expect(line?.className).toContain("text-base");
    expect(line?.className).toContain("text-muted");
  });

  it("is never a badge", () => {
    const { container } = renderList({
      divers: [diver({ welcomeCue: { kind: "returning", years: 3 } })],
    });
    const line = welcomeLine(container, "back after 3 years");
    expect(line).toBeDefined();
    // A `Badge` is a pill: rounded-full, a tint fill, a border. None of those.
    expect(line?.className).not.toMatch(/rounded-full|bg-\w+-tint|border/);
  });

  it("leaves the row's one capsule to the exception that earned it", () => {
    // A diver with both a cue and a birthday shows the birthday capsule *and*
    // the cue as text — the cue does not enter the priority chain at all.
    const { container } = renderList({
      divers: [
        diver({
          welcomeCue: { kind: "first_trip" },
          birthday: { status: "today" },
        }),
      ],
    });
    expect(welcomeLine(container, "first time with us")).toBeDefined();
    expect(container.textContent).toContain("Birthday today");
  });
});

/**
 * **A released seat and a diver still walking down the dock are not the same
 * row** (#1209, `dive-domain-expert` review 20260911).
 *
 * The manifest keeps every non-cancelled booking on purpose, so the counter's
 * write-off stays on the list — and until this chip the only booking signal it
 * carried was "Checked in", which made a settled seat read as somebody merely
 * late. On the row rather than in the person sheet, because the sheet costs a
 * tap and the point is to stop the crew looking.
 */
describe("the counter's write-off is on the row", () => {
  const NOT_HERE: Record<TestLocale, string> = { "en-US": "Not here", "es-ES": "No vino" };

  it.each(["en-US", "es-ES"] as const)(
    "shows it without opening the sheet, in %s",
    (locale: TestLocale) => {
      renderList({
        locale,
        checkpoint: "departure",
        divers: [diver({ notHere: true, checkedIn: true })],
      });
      const row = screen.getByRole("listitem");
      const trigger = within(row).getByRole("button", { name: /Meera Iyer/ });
      expect(within(trigger).getByText(NOT_HERE[locale])).toBeVisible();
      // Quiet, not an alarm: it is the absence of an exception, and the row a
      // crew most wants calm is not the place for a second loud thing.
      expect(dangerToned(trigger)).toEqual([]);
      // And it never becomes a gate — the boarding tap is exactly where it was,
      // because a crew member looking at a body outrules the desk.
      expect(
        within(row).getByRole("button", { name: TRANSLATORS[locale]("manifest.markBoarded") }),
      ).toBeVisible();
    },
  );

  it("says nothing about a diver nobody wrote off", () => {
    renderList({ checkpoint: "departure", divers: [diver({ checkedIn: true })] });
    expect(screen.queryByText(NOT_HERE["en-US"])).toBeNull();
  });
});

describe("DiverRowTrigger, drawn on its own", () => {
  it("numbers the row from one and holds no capsule line when there is nothing to say", () => {
    const { container } = render(
      <DiverRowTrigger diver={diver()} index={4} capsule={null} typeBadge={null} t={t} />,
    );
    expect(container.textContent).toMatch(/^05Meera Iyer/);
    expect(container.querySelector(".basis-full")).toBeNull();
  });

  it("gives the capsule its own full-width line", () => {
    const { container } = render(
      <DiverRowTrigger
        diver={diver()}
        index={0}
        capsule={<span>Blocked</span>}
        typeBadge={null}
        t={t}
      />,
    );
    expect(container.querySelector(".basis-full")).toHaveTextContent("Blocked");
  });
});
