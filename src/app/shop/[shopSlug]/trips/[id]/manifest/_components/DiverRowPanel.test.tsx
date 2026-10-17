// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverBlockerText } from "./DiverFacts";
import { DiverRowPanel } from "./DiverRowPanel";
import {
  dangerToned,
  diver,
  diverContext,
  notBackAt,
  renderList,
  t,
} from "./diver-roll-call-test-fixtures";
import { diverRowState } from "./diver-row-state";
import type { MissingReportAction } from "./MissingReportButton";

afterEach(cleanup);

/**
 * ADR 20260828-a-missing-diver-gets-a-sentence. The note was deleted and came
 * back narrowed, and the narrowing is the whole decision — so what is pinned is
 * where the box appears rather than what it looks like.
 */
describe("the row offers one place to say what happened, and only where it applies", () => {
  const noteBoxes = (container: HTMLElement) =>
    // Not `[name='note']`: the private staff note on the same row posts under
    // that name too, to a different action.
    [...container.querySelectorAll<HTMLTextAreaElement>("textarea[data-roll-call-note]")];

  it("offers no box at the dock, where not boarded means never left", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [diver({ bookingId: "b-1" })],
    });
    expect(noteBoxes(container)).toHaveLength(0);
  });

  it("offers exactly one after a dive, on the control about to raise the alarm", () => {
    const { container } = renderList({ divers: [diver({ bookingId: "b-1" })] });
    fireEvent.click(within(container).getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(noteBoxes(document.body)).toHaveLength(1);
    // Inside the form that posts the mark, so there is no second save to lose
    // and nothing to mirror to the device.
    expect(noteBoxes(document.body)[0]?.closest("form")).not.toBeNull();
  });

  it("keeps it to one once the alarm stands, on the sighting rather than the undo", () => {
    // Both controls render on an alarmed row: "Mark back aboard" and the
    // settled exception control. Two boxes asking one question side by side is
    // what the rule avoids — the sighting takes it, the `cleared` undo has
    // nothing to observe.
    const { container } = renderList({
      divers: [diver({ bookingId: "b-1", rollCall: notBackAt() })],
    });
    fireEvent.click(within(container).getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(noteBoxes(document.body)).toHaveLength(1);
  });

  it("shows what was already written, so nobody types it twice", () => {
    const { container } = renderList({
      divers: [
        diver({
          bookingId: "b-1",
          rollCall: { ...notBackAt(), note: "Surfaced 200 m north, picked up by Reef Runner." },
        }),
      ],
    });
    const row = within(container).getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Surfaced 200 m north, picked up by Reef Runner.",
    );
  });
});

describe("asserting aboard over a missing mark is never the cheap direction", () => {
  // ADR 20260815-offline-can-unsay-a-missing-diver: "neither makes retracting a
  // mark harder than making one". That record left the live manifest out on the
  // grounds that it "already has the honest undo one tap away" — which stopped
  // being true the moment the exception control moved into the person's panel.
  it("takes the row's tap away once a diver is recorded not back", () => {
    renderList({ divers: [diver({ rollCall: notBackAt() })] });
    const row = screen.getByRole("listitem");
    expect(within(row).queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
  });

  it("costs the same two gestures in both directions, from the person's panel", () => {
    renderList({ divers: [diver({ rollCall: notBackAt() })] });
    const row = screen.getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Open details for Meera Iyer" }));
    const sheet = screen.getByRole("dialog");
    const backAboard = within(sheet).getByRole("button", { name: /^Mark back aboard/ });
    const retract = within(sheet).getByRole("button", { name: "Not back aboard" });
    expect(backAboard).toBeDefined();
    expect(retract).toBeDefined();
  });

  /**
   * **Both controls wear an opaque fill** (issue #2341). A translucent
   * `bg-<hue>/N` takes its contrast from whatever is under it, and these are
   * the two controls read in direct sunlight with someone possibly in the
   * water.
   */
  it("paints both directions on an opaque tint, never a see-through one", () => {
    renderList({ divers: [diver({ rollCall: notBackAt() })] });
    fireEvent.click(screen.getByRole("button", { name: "Open details for Meera Iyer" }));
    const sheet = screen.getByRole("dialog");
    const backAboard = within(sheet).getByRole("button", { name: /^Mark back aboard/ });
    const retract = within(sheet).getByRole("button", { name: "Not back aboard" });
    expect(backAboard.className).toContain("bg-success-tint");
    expect(retract.className).toContain("bg-danger-tint");
    for (const control of [backAboard, retract]) {
      expect(control.className).not.toMatch(/\bbg-[a-z]+\/\d+/);
    }
  });

  it("still says a diver is blocked at the dock, where readiness does gate boarding", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
        }),
      ],
    });
    expect(dangerToned(container).length).toBeGreaterThan(0);
    // A blocked diver has no tap to offer: the act that clears them is ashore.
    expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
  });
});

describe("the person panel's spacing", () => {
  const open = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: `Open details for ${name}` }));
    return screen.getByRole("dialog");
  };

  /**
   * **A list with nothing in it takes no room** (pixel-craft class 4, K-361).
   * The quiet facts under a diver's details — checked in, the age — are a list
   * whose every item is conditional; for a diver with neither it rendered
   * empty, and its `mt-3` stood on the note form's own, 24px where the panel's
   * blocks sit 12 apart (31px from the last fact to the note's label).
   */
  it("hides a list of facts with none to show", () => {
    renderList({ divers: [diver()] });
    const sheet = open("Meera Iyer");
    const empty = [...sheet.querySelectorAll("ul")].filter((list) => list.childNodes.length === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const list of empty) expect(list).toHaveClass("empty:hidden");
  });

  /**
   * **The rule under "Resolve blockers on Divers →" sits as far from the link's
   * words as from the next line's** (pixel-craft class 4, K-362). The link is a
   * 44px target round a 24px line, so about 15px of its box is already air under
   * its words; the rule's `my-3` added 12px more above and 12 below — 27px of
   * ink to rule, against 18 from the rule to "Emergency contact". The link's
   * own air is the space above.
   */
  it("spaces the blockers' rule by the ink on each side, not by its box", () => {
    renderList({
      checkpoint: "departure",
      divers: [
        diver({ readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] } }),
      ],
    });
    const rule = open("Meera Iyer").querySelector("hr");
    expect(rule).toHaveClass("mt-0", "mb-3");
    expect(rule?.className).not.toMatch(/(^|\s)my-/);
  });
});

describe("DiverRowPanel, drawn on its own", () => {
  it("lists a blocked diver's blockers and their one fix at the dock", () => {
    const blocked = diver({
      readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
    });
    render(
      <DiverRowPanel
        context={diverContext({ checkpoint: "departure", isDeparture: true, divers: [blocked] })}
        diver={blocked}
        state={diverRowState(blocked, "departure", true, "America/New_York")}
        sharedAdvisoryTexts={new Set()}
        bookingNotes={[]}
      />,
    );
    expect(screen.getByRole("link", { name: t("manifest.resolveBlockersLink") })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/00000000-0000-4000-8000-0000000000ff#booking-${blocked.bookingId}`,
    );
  });

  /**
   * **A medical hold the capsule lost still has a home** (#2380 review). After a
   * dive a split team outranks the hold, the dock's blocker list is gone, and the
   * waiver fact is empty for a referred or refused record — so the panel says it.
   */
  it("names a medical hold that a split team took the capsule from", () => {
    const boardedOver = diver({
      boardedEarlier: true,
      readiness: { status: "blocked", blockers: [{ code: "medical_not_cleared" }] },
      buddyAlert: "separated_after_dive",
      buddyTeam: { teamId: "t-1", others: [] },
    });
    const state = diverRowState(boardedOver, "after_dive_1", false, "America/New_York");
    expect(state.capsuleKind).toBe("buddy");
    const { container } = render(
      <DiverRowPanel
        context={diverContext({ divers: [boardedOver] })}
        diver={boardedOver}
        state={state}
        sharedAdvisoryTexts={new Set()}
        bookingNotes={[]}
      />,
    );
    expect(container).toHaveTextContent(
      diverBlockerText(t, boardedOver, { code: "medical_not_cleared" }),
    );
    // Warning, never the dock's red: after a dive readiness gates nothing.
    expect(dangerToned(container)).toHaveLength(0);
    expect(screen.queryByRole("link", { name: t("manifest.resolveBlockersLink") })).toBeNull();
  });

  it("offers the way back aboard only to a diver recorded not back", () => {
    const missing = diver({ rollCall: notBackAt() });
    render(
      <DiverRowPanel
        context={diverContext({ divers: [missing] })}
        diver={missing}
        state={diverRowState(missing, "after_dive_1", false, "America/New_York")}
        sharedAdvisoryTexts={new Set()}
        bookingNotes={[]}
      />,
    );
    expect(screen.queryByRole("link", { name: t("manifest.resolveBlockersLink") })).toBeNull();
    expect(
      screen.getAllByRole("button").some((button) => /back aboard/i.test(button.textContent ?? "")),
    ).toBe(true);
  });
});

/**
 * Safety sheet 2026-10-15, item 2: a row marked not back aboard is where the
 * missing diver report starts, for the people who may start one, and nowhere
 * else.
 */
describe("the missing diver report starts from the row that raised it", () => {
  const start = () => screen.queryByRole("button", { name: /Start a missing diver report/ });

  function renderPanel(
    rollCall: ReturnType<typeof notBackAt> | undefined,
    startMissingDiverReport: MissingReportAction | null,
    checkpoint: "departure" | "after_dive_1" = "after_dive_1",
  ) {
    const row = diver({ bookingId: "b-9", fullName: "Hugo Brandt", rollCall });
    render(
      <DiverRowPanel
        context={diverContext({
          divers: [row],
          checkpoint,
          isDeparture: checkpoint === "departure",
          startMissingDiverReport,
        })}
        diver={row}
        state={diverRowState(row, checkpoint, checkpoint === "departure", "America/New_York")}
        sharedAdvisoryTexts={new Set()}
        bookingNotes={[]}
      />,
    );
  }

  it("offers it, named for the diver, on a row marked not back aboard", () => {
    renderPanel(
      notBackAt(),
      vi.fn(async () => null),
    );
    expect(start()).toHaveAccessibleName(`${t("incidents.missingDiver.start")} — Hugo Brandt`);
  });

  it("offers nothing to a reader who may not start a report", () => {
    renderPanel(notBackAt(), null);
    expect(start()).toBeNull();
  });

  it("offers nothing on a row that is not missing, or at the dock", () => {
    renderPanel(
      undefined,
      vi.fn(async () => null),
    );
    expect(start()).toBeNull();
    cleanup();
    // At the dock "not boarded" is "never left": no missing diver.
    renderPanel(
      notBackAt(),
      vi.fn(async () => null),
      "departure",
    );
    expect(start()).toBeNull();
  });
});
