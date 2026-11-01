// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupLabelClass } from "@/components/ui/group-label";
import { ScheduleBuilder } from "./ScheduleBuilder";
import {
  actions,
  baseTrip,
  COPY,
  type FixtureDay,
  loadMovePreflight,
  loadOptions,
  MORE,
  PRICE,
  resetScheduleBuilderFixtures,
  weekFrom,
} from "./schedule-builder-test-fixtures";

vi.mock("next/navigation", async () => {
  const navigation = await import("./schedule-builder-test-fixtures");
  return {
    usePathname: navigation.usePathname,
    useRouter: navigation.useRouter,
    useSearchParams: navigation.useSearchParams,
  };
});

afterEach(resetScheduleBuilderFixtures);

/**
 * **The move panel's impact preview** (issue #1203, D43).
 *
 * The whole feature is a read: the panel says what moving this departure will
 * cost — who has already been told the date, the crew rostered onto it, the kit
 * that travels, the money already taken — before the form is filled in. What is
 * asserted here is mostly the *absence* cases, because they are what keeps a
 * form calm: nothing while it loads, nothing for a departure with no
 * consequences, and nothing at all when the read fails.
 */
describe("ScheduleBuilder move impact preview (issue #1203)", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [baseTrip()],
    },
  ];

  function renderBoard() {
    return render(
      <ScheduleBuilder
        context={{
          shopSlug: "blue-mantis",
          week: weekFrom(days),
          loadOptions,
          loadMovePreflight,
          price: PRICE,
          actions,
          defaultDateIso: "2026-08-01",
          canConfigure: true,
          locale: "en-US",
          copy: COPY,
          more: MORE,
          initialCourse: null,
          openAdd: "closed",
        }}
      />,
    );
  }

  async function openMovePanel() {
    await userEvent.click(
      screen.getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Move Two-Tank Reef/ }));
  }

  /**
   * The board carries a page of departures and every panel on it is closed, so
   * the counts are asked for on the path that opens one — never shipped with
   * the render. Same contract as the add panel's option lists.
   */
  it("asks for nothing until a move panel is opened", async () => {
    renderBoard();
    expect(loadMovePreflight).not.toHaveBeenCalled();

    await openMovePanel();
    // `null` for the date: the panel opens on the date the departure already
    // sits on, and moving a boat to where it is has no consequences to preview.
    expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", null);
  });

  it("says what the move will cost, once it knows", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        { kind: "told", reminded: 4 },
        { kind: "gear", count: 1 },
        { kind: "money", paid: 5, cancellationWindowHours: 48 },
      ],
    }));
    renderBoard();
    await openMovePanel();

    expect(
      await screen.findByText(
        "4 divers have already been told this date. Moving it tells them the new one.",
      ),
    ).toBeInTheDocument();
    // Singular and plural both resolved server-side, picked here by count.
    expect(screen.getByText("1 reserved unit travels with it.")).toBeInTheDocument();
    expect(screen.getByText("5 seats are already paid.")).toBeInTheDocument();
    expect(screen.getByText("Cancellations close 48 hours before it departs.")).toBeInTheDocument();
    expect(screen.getByText(COPY.impactTitle)).toBeInTheDocument();
  });

  /**
   * "If you move it" is a group label like every other in the app, not a
   * small-caps line spelled by hand at a quarter of their letter-spacing
   * (`tracking-wide`, 0.025em, beside the week's 0.14em; pixel-craft K-336).
   */
  it("titles the consequences with the app's one group label", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [{ kind: "gear", count: 1 }],
    }));
    renderBoard();
    await openMovePanel();

    const title = await screen.findByText(COPY.impactTitle);
    expect(title).toHaveClass(...groupLabelClass("muted").split(" "));
    expect(title).not.toHaveClass("tracking-wide");
  });

  /**
   * **The clash is not a footnote** (issue #1345). Every other line here is a
   * cost of going ahead — letters to write, kit to re-reserve. The clash is a
   * state `setTripCrew`/`changeTripCrew` refuse outright and the manifest
   * prints twice, so it is announced and carries the blocked line's weight
   * while the gear count stays under the heading.
   *
   * The blackout stays muted with the costs on purpose: it is the crew
   * member's own note, and the owner's answer named the clash.
   */
  it("says a crew clash as an alert, not a footnote", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        { kind: "crew", clashes: [{ name: "Marisol", departure: "Thu 07:00 Night Dive" }] },
        { kind: "crewAway", names: ["Ivo"] },
        { kind: "gear", count: 1 },
      ],
    }));
    renderBoard();
    await openMovePanel();

    const clash = await screen.findByText(
      "Marisol is already rostered on Thu 07:00 Night Dive at that time.",
    );
    expect(clash).toHaveClass("text-warning");
    expect(screen.getAllByRole("alert")).toContain(clash);

    const gear = screen.getByText("1 reserved unit travels with it.");
    const away = screen.getByText("Ivo has told you they are away then.");
    for (const line of [gear, away]) {
      expect(line.closest("ul")).not.toBeNull();
    }
    for (const alert of screen.getAllByRole("alert")) {
      expect(alert).not.toHaveTextContent("1 reserved unit travels with it.");
      expect(alert).not.toHaveTextContent("Ivo has told you they are away then.");
    }
    expect(screen.getByText(COPY.impactTitle)).toBeInTheDocument();
  });

  /**
   * **A tight turnaround is advice** (issue #2141, Aaron's decision (b)): one
   * muted line per near miss, under every clash line, naming the other
   * departure and the minutes — never an alert, and the Move button stays.
   */
  it("says a tight turnaround under the clash lines, muted, and keeps the move", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        { kind: "boat", clashes: [{ boat: "Mantis I", departure: "Night Dive" }] },
        {
          kind: "turnaround",
          items: [
            { kind: "boat", name: "Mantis I", departure: "Afternoon Wreck", minutes: 10 },
            { kind: "crew", name: "Marisol", departure: "Shore Intro", minutes: 20 },
          ],
        },
      ],
    }));
    renderBoard();
    await openMovePanel();

    const boatLine = await screen.findByText(
      "Tight turnaround: Mantis I has 10 min between this and Afternoon Wreck.",
    );
    const crewLine = screen.getByText(
      "Tight turnaround: Marisol has 20 min between this and Shore Intro, from another meeting point.",
    );
    for (const line of [boatLine, crewLine]) {
      expect(line.closest("ul")).not.toBeNull();
      expect(line).not.toHaveClass("text-warning");
    }
    for (const alert of screen.getAllByRole("alert")) {
      expect(alert).not.toHaveTextContent("Tight turnaround");
    }
    const clash = screen.getByText("Mantis I is already out on Night Dive at that time.");
    expect(clash.compareDocumentPosition(boatLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.moveIt })).toBeEnabled();
  });

  /**
   * A clash on its own used to print the "If you move it" heading over one
   * grey line. The alert says the whole thing; the heading it would have stood
   * under has nothing left to introduce.
   */
  it("renders the alert with no heading when the clash is the only consequence", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        { kind: "crew", clashes: [{ name: "Marisol", departure: "Thu 07:00 Night Dive" }] },
      ],
    }));
    renderBoard();
    await openMovePanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Marisol is already rostered on Thu 07:00 Night Dive at that time.",
    );
    expect(screen.queryByText(COPY.impactTitle)).toBeNull();
  });

  /**
   * **Louder, never a gate.** Issue #1345 asked whether `moveTrip` should
   * refuse a clash or quietly drop the clashing people; the answer was
   * neither — the owner assigns crew, and a panel that disabled its own button
   * would be the preview becoming the gate the blocked-line test above
   * deliberately is not either.
   */
  it("still lets the move go through with a clash on screen", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        {
          kind: "crew",
          clashes: [
            { name: "Marisol", departure: "Thu 07:00 Night Dive" },
            { name: "Ivo", departure: "Thu 08:00 Reef Drift" },
          ],
        },
      ],
    }));
    renderBoard();
    await openMovePanel();

    // One alert per person, not one paragraph naming both: a screen reader
    // announces two clashes the way it announces two facts.
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getByRole("button", { name: COPY.moveIt })).toBeEnabled();
  });

  /**
   * The restraint case. A departure nobody has been told about, with no crew,
   * no kit and no money composes to no sections — and the panel must then look
   * exactly as it did before this feature existed, heading included.
   */
  it("renders no block at all for a departure with no consequences", async () => {
    renderBoard();
    await openMovePanel();

    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalled());
    expect(screen.queryByText(COPY.impactTitle)).toBeNull();
    expect(screen.getByLabelText(COPY.newDate)).toBeInTheDocument();
  });

  /**
   * A preview is a courtesy, never a gate: if the read fails the panel is the
   * two fields and the button it has always been, with no error furniture.
   */
  it("leaves the form untouched when the read fails", async () => {
    loadMovePreflight.mockImplementation(async () => {
      throw new Error("nope");
    });
    renderBoard();
    await openMovePanel();

    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalled());
    expect(screen.queryByText(COPY.impactTitle)).toBeNull();
    expect(screen.getByLabelText(COPY.newDate)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY.moveIt })).toBeInTheDocument();
  });

  /**
   * Said up front, in the words the post-move notice would have used. The form
   * is deliberately still submittable — `moveTrip` is the one that decides, and
   * a panel that disabled its own button would be the preview becoming a gate.
   */
  it("warns before the form is filled in when the departure cannot move", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: "already_sailed",
      sections: [{ kind: "told", reminded: 6 }],
    }));
    renderBoard();
    await openMovePanel();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(COPY.impactBlockedSailed);
    expect(screen.getByRole("button", { name: COPY.moveIt })).toBeEnabled();
    // The facts survive the refusal — they are why it is worth reading.
    expect(
      screen.getByText(
        "6 divers have already been told this date. Moving it tells them the new one.",
      ),
    ).toBeInTheDocument();
  });

  it("names the canceled refusal instead, when that is the one that applies", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: "not_scheduled",
      sections: [],
    }));
    renderBoard();
    await openMovePanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(COPY.impactBlockedNotScheduled);
  });

  /**
   * Two departures, two previews. The panel is keyed by the row it opened from,
   * so a second Move must ask about *its* departure rather than reuse the first
   * answer — the bug a single module-level cache would introduce.
   */
  it("asks again for a different departure", async () => {
    const twoDays: FixtureDay[] = [
      {
        ...days[0],
        trips: [baseTrip(), baseTrip({ id: "trip-2", title: "Night Dive" })],
      },
    ];
    render(
      <ScheduleBuilder
        context={{
          shopSlug: "blue-mantis",
          week: weekFrom(twoDays),
          loadOptions,
          loadMovePreflight,
          price: PRICE,
          actions,
          defaultDateIso: "2026-08-01",
          canConfigure: true,
          locale: "en-US",
          copy: COPY,
          more: MORE,
          initialCourse: null,
          openAdd: "closed",
        }}
      />,
    );

    await openMovePanel();
    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", null));

    await userEvent.click(
      screen.getByRole("button", { name: /^Move, copy, or remove Night Dive/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Move Night Dive/ }));
    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalledWith("trip-2", null));
  });

  /**
   * **The two crew lines, and the re-read that makes them possible** (issue
   * #1310).
   *
   * Every other line in this preview is a property of the departure and is the
   * same wherever it lands, so the panel could — and did — fetch once on
   * mount. These have to be asked again for each date *and time* a staff
   * member picks, because the rule is an overlap of hours rather than a shared
   * day: a morning boat and an afternoon boat are an ordinary double shift.
   */
  it("asks again, with the date and the time, when either changes", async () => {
    loadMovePreflight.mockImplementation(
      async (_tripId: string, target: { date: string; startTime: string } | null) => ({
        blocked: null,
        sections:
          target?.date === "2026-08-06"
            ? [
                {
                  kind: "crew" as const,
                  clashes: [{ name: "Marcus Webb", departure: "Night Dive" }],
                },
              ]
            : [],
      }),
    );
    renderBoard();
    await openMovePanel();
    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", null));

    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });

    // The other boat is named, because otherwise the reader has to leave the
    // panel to find out whether "another departure" is the 07:00 or the 15:00
    // — which is the question they opened it to settle.
    expect(
      await screen.findByText("Marcus Webb is already rostered on Night Dive at that time."),
    ).toBeInTheDocument();
    expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", {
      date: "2026-08-06",
      startTime: "08:30",
    });

    // The time is part of the question too, so changing it asks again.
    fireEvent.change(screen.getByLabelText(COPY.newDepartureTime), {
      target: { value: "14:00" },
    });
    await waitFor(() =>
      expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", {
        date: "2026-08-06",
        startTime: "14:00",
      }),
    );
  });

  /**
   * The blackout is a separate sentence because it is a separate fact — the
   * crew member's own statement, which the app has held since #1235 and which
   * *informs rather than gates*, so nobody is taken off a boat by it and no
   * clash is ever found for it. Without this line the panel is silent on the
   * case the shop wrote down.
   */
  it("says who has told the shop they are away, in its own words", async () => {
    loadMovePreflight.mockImplementation(async (_tripId: string, target) => ({
      blocked: null,
      sections: target ? [{ kind: "crewAway" as const, names: ["Talia Okonkwo"] }] : [],
    }));
    renderBoard();
    await openMovePanel();
    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });

    expect(
      await screen.findByText("Talia Okonkwo has told you they are away then."),
    ).toBeInTheDocument();
  });

  /**
   * **One hull, one departure at a time** (H-20260916-may-one-hull-carry, issue #1780): the hull's own
   * overlap is announced at the clash's weight, above the crew line.
   */
  it("announces the hull already out at those hours, ahead of the crew", async () => {
    loadMovePreflight.mockImplementation(async (_tripId: string, target) => ({
      blocked: null,
      sections: target
        ? [
            {
              kind: "boat" as const,
              clashes: [{ boat: "Mantis I", departure: "Night Dive" }],
            },
            {
              kind: "crew" as const,
              clashes: [{ name: "Marcus Webb", departure: "Night Dive" }],
            },
          ]
        : [],
    }));
    renderBoard();
    await openMovePanel();
    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });

    const boatLine = await screen.findByText("Mantis I is already out on Night Dive at that time.");
    expect(boatLine).toHaveAttribute("role", "alert");
    const alerts = screen.getAllByRole("alert").map((node) => node.textContent);
    expect(alerts).toEqual([
      "Mantis I is already out on Night Dive at that time.",
      "Marcus Webb is already rostered on Night Dive at that time.",
    ]);
  });

  it("names each of them on its own line, never a count of them", async () => {
    // The deliberate call the ticket turns on: a count read `crew: 2` on 24 of
    // the demo board's 25 departures, and the row this panel opens under
    // already prints the crew's names.
    loadMovePreflight.mockImplementation(async (_tripId: string, target) => ({
      blocked: null,
      sections: target
        ? [
            {
              kind: "crew" as const,
              clashes: [
                { name: "Marcus Webb", departure: "Night Dive" },
                { name: "Talia Okonkwo", departure: "Two-Tank Reef" },
              ],
            },
          ]
        : [],
    }));
    renderBoard();
    await openMovePanel();
    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });

    expect(
      await screen.findByText("Marcus Webb is already rostered on Night Dive at that time."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Talia Okonkwo is already rostered on Two-Tank Reef at that time."),
    ).toBeInTheDocument();
  });

  it("asks nothing new when the fields return to where the departure already is", async () => {
    renderBoard();
    await openMovePanel();
    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", null));

    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });
    await waitFor(() =>
      expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", {
        date: "2026-08-06",
        startTime: "08:30",
      }),
    );

    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(loadMovePreflight.mock.calls.at(-1)).toEqual(["trip-1", null]));
    // Three reads for three distinct answers, not one per keystroke: a date or
    // time input publishes a value only once all its segments are filled.
    expect(loadMovePreflight).toHaveBeenCalledTimes(3);
  });
});
