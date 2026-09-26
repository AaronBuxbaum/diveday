// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/badge";
import { staffTranslator } from "@/i18n/staff-messages";
import { SettingsDoorRow, SettingsRow } from "./SettingsRows";

/**
 * The two row kinds as geometry. They sit interleaved in one `InsetGroup`,
 * whose `divide-y` hangs a 1px rule on every row but the last — so what a row
 * is measured from is the element that rule lands on, and the two kinds have
 * to put their height in the same place relative to it. Behaviour (which row
 * opens, what a door says at rest) is pinned in `SettingsRail.test.tsx`.
 */

afterEach(cleanup);

const DOOR = "/shop/blue-mantis/settings/team";

function doorRow(external = false) {
  const { container } = render(
    <SettingsDoorRow
      href={external ? "mailto:help@example.com" : DOOR}
      heading="Team"
      external={external}
    />,
  );
  return container.firstElementChild as HTMLElement;
}

function settingRow(props: Partial<Parameters<typeof SettingsRow>[0]> = {}) {
  const { container } = render(
    <SettingsRow heading="Sales tax & VAT" {...props}>
      <span>form</span>
    </SettingsRow>,
  );
  return container.firstElementChild as HTMLElement;
}

describe("one row height, whichever kind of row", () => {
  /**
   * A door row put `min-h-14` on the very element `divide-y` borders, so its
   * 1px rule came out of its 56px (box-sizing is border-box) and it drew 55px,
   * while a setting's `<summary>` keeps its 56px *inside* the `<details>` that
   * takes the rule. On the settings hub the rules fell at a 56px pitch through
   * the doors and 57px through the settings — "Team" 1px shorter than "Tax"
   * beside it (K-53, SETTINGS-1-14, SETTINGS-2-11).
   */
  it("carries min-h-14 on a child of the element the group's divide-y borders, never on that element", () => {
    for (const row of [doorRow(), settingRow()]) {
      expect(row).not.toHaveClass("min-h-14");
      expect(row.firstElementChild).toHaveClass("min-h-14");
    }
  });
});

describe("where a row states its value", () => {
  /** The boxes that take part in the phone's column: `hidden` ones do not. */
  function phoneLines(row: HTMLElement) {
    return row.querySelectorAll("summary > :not(.hidden)");
  }

  /**
   * On a phone the summary stacks its value under the heading with a
   * symmetric `py-3`. A text value's 20px line carries half-leading under its
   * baseline, so the stack looks centred; a `Badge` paints its whole 28px box,
   * so that air is gone and "Online payments" over "Not connected" sat 2.5px
   * low in its 80px row (K-76, SETTINGS-2-33). A badge is a word-sized status,
   * which fits beside the heading where it already sits from `sm` up.
   */
  it("keeps a badge value on the heading's own line when asked to, on a phone too", () => {
    const row = settingRow({
      value: <Badge tone="warning">Not connected</Badge>,
      valuePlacement: "inline",
    });
    const heading = row.querySelector("h3");
    expect(heading?.parentElement?.contains(within(row).getByText("Not connected"))).toBe(true);
    expect(phoneLines(row)).toHaveLength(1);
  });

  /**
   * Beside the heading on a phone, the pill and the heading both shrank when
   * the line was short for the two: the heading wrapped, and so did the pill's
   * own words, inside a `rounded-full` box. "Pagos en línea" and "Todavía no
   * está lista" need ~358px of a 390px phone's ~324px row, and in English at
   * 360 "Online payments" and "Not connected" need ~306px of ~296px. The pill
   * is kept whole, and the heading's line wraps instead: a pill that does not
   * fit drops under its heading, where a stacked value sits.
   */
  it("keeps an inline pill whole, dropping it under its heading when the line is too short", () => {
    const t = staffTranslator("es-ES");
    const row = settingRow({
      heading: t("settings.main.stripe.rowHeading"),
      value: <Badge tone="warning">{t("settings.main.stripe.notReadyBadge")}</Badge>,
      valuePlacement: "inline",
    });
    const heading = within(row).getByRole("heading", {
      name: t("settings.main.stripe.rowHeading"),
    });
    const pill = within(row).getByText(t("settings.main.stripe.notReadyBadge"));
    const valueBox = pill.parentElement as HTMLElement;
    expect(valueBox).toHaveClass("shrink-0", "whitespace-nowrap");
    // The heading and the pill are the two items of one wrapping line, so the
    // pill moves under the heading whole rather than squeezing beside it.
    expect(valueBox.parentElement).toBe(heading.parentElement);
    expect(heading.parentElement).toHaveClass("flex-wrap");
    expect(heading).toHaveClass("min-w-0");
  });

  it("still stacks a value under its heading on a phone by default", () => {
    const row = settingRow({ value: "12 Harbour Rd" });
    expect(row.querySelector("h3")?.parentElement).not.toHaveTextContent("12 Harbour Rd");
    expect(phoneLines(row)).toHaveLength(2);
  });

  /**
   * The row exists to state the answer, and the component said so for phones
   * only: from `sm` up the value was `truncate` beside a `shrink-0` heading,
   * so Contact, Profile and Diving options were cut to "hello@demo.inva…" at
   * 640–767px and 1024–1279px, where the row is narrowest (K-310,
   * SETTINGS-1-24). A long value wraps in its column, ending at the caret.
   */
  it("wraps a long value in its column from sm up rather than cutting it", () => {
    const long = "hello@demo.invalid · +1 305 555 0100";
    const value = within(settingRow({ value: long })).getByText(long);
    expect(value).toHaveClass("sm:text-end");
    expect(value.className).not.toMatch(/truncate|text-ellipsis|line-clamp/);
  });
});

describe("an opened row's body", () => {
  /**
   * The detail's `mt-1` is the step down from a description. On a row that
   * has a detail and no description it was a margin under nothing: the body
   * began 4px lower than on every other row (label ink to first line 43px at
   * 1280, against 39) — Address, Dock-day rhythm (K-309, SETTINGS-1-10).
   */
  it("starts a detail at the body's top when there is no description above it", () => {
    const row = settingRow({ detail: "Printed on the counter card." });
    expect(within(row).getByText("Printed on the counter card.")).not.toHaveClass("mt-1");
  });

  it("still sets a detail one step under its description", () => {
    const row = settingRow({ description: "What we charge on top.", detail: "Shown at checkout." });
    expect(within(row).getByText("Shown at checkout.")).toHaveClass("mt-1");
  });
});

describe("one focus ring, whichever kind of row", () => {
  /**
   * A setting's `<summary>` is ringed inside itself across the whole row
   * (`LIST_ROW_SUMMARY_RING`), while a door kept the global ring on its link
   * text: a keyboard reader tabbing down the hub saw a row-wide band on "Tax"
   * and a 36×19px square round the word "Team" on the next row (K-101,
   * SETTINGS-1-23, ATLAS-1-19). The door's target is already the whole row —
   * the stretched `::after` — so that overlay wears the inset ring, the way
   * `RowLink` rings its cell, and the text is not ringed a second time.
   */
  for (const external of [false, true]) {
    it(`rings a door row's overlay inside the row, not its words${external ? " (external link)" : ""}`, () => {
      doorRow(external);
      expect(screen.getByRole("link", { name: "Team" })).toHaveClass(
        "after:absolute",
        "after:inset-0",
        "focus-visible:outline-none",
        "focus-visible:after:focus-ring-inset",
      );
    });
  }

  it("bends a door row's ring into the group's corners at either end, as a summary's does", () => {
    // `InsetGroup` clips at its 20px corner; a square ring at the group's first
    // or last row would have its corners shaved off.
    const row = doorRow();
    expect(row).toHaveClass("group/door");
    expect(screen.getByRole("link", { name: "Team" })).toHaveClass(
      "group-first/door:after:rounded-t-panel",
      "group-last/door:after:rounded-b-panel",
    );
  });
});
