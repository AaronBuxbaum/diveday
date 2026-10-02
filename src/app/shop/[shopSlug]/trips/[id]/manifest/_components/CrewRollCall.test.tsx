// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, RollCallRecord, TripManifest } from "@/lib/manifests";
import { CrewRollCall } from "./CrewRollCall";

/**
 * **The crew half of the same two rules** slice 5a owes ADR
 * 20260827-the-departure-is-two-working-surfaces — and it needs its own file
 * rather than a shared one, because "written twice" is exactly how these two
 * lists came to disagree before (a green-checked "Not boarded ✓" beside a diver
 * who had not come back from dive one). A divemaster who did not surface is the
 * same claim about the same kind of body, so their row obeys the same
 * gestures as a diver's:
 *
 * - **decision 3** — the not-back path is not reachable in one tap from the
 *   list; it lives inside the person's own panel.
 * - **decision 4** — no danger tone at a checkpoint where nobody has recorded
 *   an exception.
 * - **ADR 20260815-offline-can-unsay-a-missing-diver** — over a stated
 *   missing-diver mark, asserting "aboard" is never the cheap direction and
 *   retracting is never the expensive one.
 */

afterEach(cleanup);

const t = staffTranslator("en-US");

function crew(overrides: Partial<TripManifest["crew"][number]> = {}): TripManifest["crew"][number] {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    fullName: "Keiko Tanaka",
    roles: ["divemaster"],
    emergencyContactName: "Haru Tanaka",
    emergencyContactPhone: "+81-3-555-0103",
    buddyTeams: [],
    buddyAlert: null,
    ...overrides,
  } as TripManifest["crew"][number];
}

function notBackAt(): RollCallRecord {
  return {
    state: "not_boarded",
    occurredAt: new Date("2026-09-11T12:29:00.000Z"),
    recordedByName: "Sal Moretti",
  } as RollCallRecord;
}

function renderCrew({
  members,
  checkpoint = "after_dive_1",
}: {
  members: TripManifest["crew"];
  checkpoint?: RollCallCheckpoint;
}) {
  return render(
    <CrewRollCall
      crew={members}
      checkpoint={checkpoint}
      isDeparture={checkpoint === "departure"}
      shopSlug="blue-mantis"
      tripId="00000000-0000-4000-8000-0000000000ff"
      locale="en-US"
      timezone="America/New_York"
      crewRollCallAction={vi.fn(async () => ({ ok: true }) as const)}
      crewRollCallButtonCopy={{ errorRefusal: "Try again", blockedMessage: "Blocked" }}
      buddyTeamLabel={() => null}
      t={t}
    />,
  );
}

function hiddenAtRest(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.classList.contains("hidden")) return true;
  }
  return false;
}

function dangerToned(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[class]")].filter(
    (element) =>
      /(^|[\s:/])(text|bg|border|ring|from|to|via)-danger(\b|-)/.test(element.className) &&
      !hiddenAtRest(element),
  );
}

function control(row: HTMLElement, name: string) {
  return [...row.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
}

/**
 * **No crew is a card in a tone, not a box of its own shape.** With nobody
 * assigned, the warning panel stands where the crew list's card would, under
 * the same heading — so it takes that card's geometry (`TONE_PANEL_CLASS`):
 * it was a hand-rolled `p-4` with no `sm:` step and no bed, 4px inside every
 * card's words from `sm` up (pixel-craft class 3). What it says, and the door
 * to fixing it, do not change: the checkpoint's crew half stays open until a
 * crew member is on the departure.
 */
describe("a departure with no crew", () => {
  it("says so on the card's own geometry, with the way to fix it", () => {
    renderCrew({ members: [] });
    const note = screen.getByText(t("manifest.noCrew"));
    const panel = note.parentElement as HTMLElement;
    expect(panel).toHaveClass(...TONE_PANEL_CLASS.split(" "), "border-warning/50", "bg-warning/10");
    const fix = within(panel).getByRole("link", { name: t("manifest.addCrewToTrip") });
    expect(fix).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/00000000-0000-4000-8000-0000000000ff?view=details#crew",
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("draws no warning panel once anyone is crewing", () => {
    renderCrew({ members: [crew()] });
    expect(screen.queryByText(t("manifest.noCrew"))).toBeNull();
    expect(screen.queryByRole("link", { name: t("manifest.addCrewToTrip") })).toBeNull();
  });
});

describe("a crew row obeys the diver row's gestures", () => {
  it("carries the affirmative tap and hides the exception behind the person's panel", () => {
    renderCrew({ members: [crew()] });
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("button", { name: "Mark aboard" })).toBeVisible();
    const exception = control(row, "Mark not back aboard");
    expect(exception).toBeUndefined();
    expect(
      within(row).getByRole("button", { name: "Open details for Keiko Tanaka" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("renders nothing in danger tone with nothing recorded", () => {
    const { container } = renderCrew({ members: [crew()] });
    expect(dangerToned(container)).toHaveLength(0);
  });

  it("takes the row's tap away once a crew member is recorded not back", () => {
    const { container } = renderCrew({ members: [crew({ rollCall: notBackAt() })] });
    const row = screen.getByRole("listitem");
    // Both directions out of the alarm cost the same two gestures, and neither
    // is on the row: asserting a divemaster is aboard over a stated
    // missing-diver mark is the tap that turns the loudest row green.
    expect(within(row).queryByRole("button", { name: "Mark aboard" })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Open details for Keiko Tanaka" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: /^Mark back aboard/ })).toBeVisible();
    expect(within(sheet).getByRole("button", { name: "Not back aboard" })).toBeVisible();
    // …and the alarm itself is on screen, earned by that record.
    expect(dangerToned(container).length).toBeGreaterThan(0);
  });
});

/**
 * **On paper the rows take the card's inner corner.** The print packets lift
 * every `overflow` clip on purpose, so the card's rounded corner stopped
 * cutting the rows and a crew row's 4px state stripe stood square across it
 * (pixel probe, day-packet-print). The corners are print-only because on
 * screen the card still clips.
 */
describe("the crew rows on paper", () => {
  it("rounds the first row's top corners and the last row's bottom ones, in print only", () => {
    renderCrew({
      members: [
        crew(),
        crew({ id: "00000000-0000-4000-8000-0000000000c2", fullName: "Sal Moretti" }),
      ],
    });
    for (const row of screen.getAllByRole("listitem")) {
      expect(row).toHaveClass(
        "border-l-4",
        "break-inside-avoid",
        "print:first:rounded-t-[calc(var(--radius-panel)-1px)]",
        "print:last:rounded-b-[calc(var(--radius-panel)-1px)]",
      );
    }
  });
});

/**
 * **The mark keeps room for its focus ring on the last row.** The roll-call
 * card is `overflow-hidden`. While glare's 44px floor shrank the name button
 * to 52px (#1981; a floor now, `glare-mode.test.ts`), the mark column set the
 * row's height, and the last row's mark ended on the card's bottom edge: its
 * 5px ring lost its bottom (pixel probe, `manifest-seen-boat-mode`). Pinned as
 * structure, because jsdom has no layout; the probe measures the ring.
 */
describe("the mark's room for its focus ring", () => {
  it("pads the mark's column as much below the mark as above it (py-2.5), beside the name button in the same row", () => {
    renderCrew({ members: [crew()] });
    const trigger = screen.getByRole("button", { name: "Open details for Keiko Tanaka" });
    const column = trigger.parentElement?.lastElementChild as HTMLElement;
    expect(column).not.toBe(trigger);
    expect(column.querySelector("button")).not.toBeNull();
    expect(column).toHaveClass("py-2.5");
    expect(column.className).not.toMatch(/(^|\s)p[tb]-/);
  });

  it("takes the tap over the whole mark column, as the diver row's does", () => {
    // The mark's stretched `::after` reaches as far as the diver row's column
    // padding (`RollCallControls`); this column must be padded the same.
    renderCrew({ members: [crew()] });
    const trigger = screen.getByRole("button", { name: "Open details for Keiko Tanaka" });
    const column = trigger.parentElement?.lastElementChild as HTMLElement;
    const mark = column.querySelector("button");
    expect(column).toHaveClass("py-2.5", "ps-3", "pe-3");
    expect(mark).toHaveClass("relative", "after:-inset-y-2.5", "after:-inset-x-3");
  });
});

describe("the crew list's hairlines", () => {
  /**
   * **The rule between two crew rows is the rule colour, never the row's tone**
   * (pixel-craft class 12, K-165). The list drew its rules with `divide-y
   * divide-border`, which colours each `<li>`'s own border — and every row's
   * tone (`ROLL_CALL_ROW_TONE`) sets that border's colour for its 4px stripe,
   * and won. An untouched crew rule read `border-strong` where the diver rules
   * read `border`, and a boarded or missing crew member's would turn green or
   * red. The rule is drawn inside the row now, off the diver list's helper.
   */
  it("draws each rule inside its row, in the rule colour, from the second row down", () => {
    const { container } = renderCrew({
      members: [
        crew(),
        crew({
          id: "00000000-0000-4000-8000-0000000000c2",
          fullName: "Sal Moretti",
          rollCall: notBackAt(),
        }),
      ],
    });
    const rows = [...container.querySelectorAll<HTMLElement>("li[id^='crew-row-']")];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.parentElement?.className).not.toMatch(/(^|\s)divide-/);
    const rule = (row: HTMLElement | undefined) => row?.firstElementChild?.className ?? "";
    expect(rule(rows[0])).toContain("border-t-0");
    expect(rule(rows[0])).toContain("print:border-t-0");
    expect(rule(rows[1])).toMatch(/(^|\s)border-t(\s|$)/);
    expect(rule(rows[1])).toContain("border-border");
    expect(rule(rows[1])).toContain("print:border-t");
    // The tone keeps its colour on the row's own box, whose one border is the
    // stripe.
    expect(rows[1]?.className).toContain("border-danger");
  });
});

/**
 * **The mark centres on the row it sits in** (K-266): the diver row's rule, on
 * the crew row that repeats it. A crew member's clash line wraps the name
 * button past 76px, and a mark held 10px from the top stayed above it.
 */
describe("the mark beside a name that wraps", () => {
  it("sits in the name button's own items-center row", () => {
    renderCrew({ members: [crew()] });
    const trigger = screen.getByRole("button", { name: "Open details for Keiko Tanaka" });
    const row = trigger.parentElement as HTMLElement;
    expect(row).toHaveClass("flex", "items-center");
    expect(row.className).not.toMatch(/items-start/);
    expect(row).toContainElement(screen.getByRole("button", { name: "Mark aboard" }));
  });
});
