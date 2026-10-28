// @vitest-environment jsdom

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass } from "@/components/ui/button";
import {
  blocked,
  deepRow,
  entry,
  fixtures,
  readinessRow,
  ready,
  renderRoster,
  signedWaiver,
} from "./roster-test-fixtures";
import type { ReadinessByBooking, RosterEntry, WaiverByBooking } from "./types";

afterEach(cleanup);

/**
 * The rules slice 5d ships on (ADR
 * 20260827-the-departure-is-two-working-surfaces): the roster is **one
 * grouped ledger** whose group bands own the state word and the count, a
 * cleared seat is a name and a drawn mark with no per-row state word, open
 * work keeps its sentence and its fix in the open, and the filter chips are
 * gone because the groups are the filter. Pinned as rules, never pixels —
 * a restyle may move everything here except what these assert.
 */

describe("the decompression reminder on the roster (H-144)", () => {
  const words = "decompression card";
  const rowsFor = (type: "diver" | "snorkeler" | "rider") => ({
    roster: [entry("b1", "Meera Iyer", { participantType: type })],
    readiness: new Map([["b1", readinessRow("ready")]]) as unknown as ReadinessByBooking,
    waivers: new Map() as unknown as WaiverByBooking,
  });

  it("shows once on a decompression departure with a diver aboard", () => {
    renderRoster({ ...rowsFor("diver"), exceedsNoDecoLimits: true });
    expect(screen.getAllByText(new RegExp(words))).toHaveLength(1);
  });

  it("is silent on a departure not marked as decompression diving", () => {
    renderRoster({ ...rowsFor("diver"), exceedsNoDecoLimits: false });
    expect(screen.queryByText(new RegExp(words))).toBeNull();
  });

  it.each(["snorkeler", "rider"] as const)("is silent when only a %s is booked", (type) => {
    renderRoster({ ...rowsFor(type), exceedsNoDecoLimits: true });
    expect(screen.queryByText(new RegExp(words))).toBeNull();
  });

  it("shows for a guide in the water when every guest is a snorkeler", () => {
    renderRoster({ ...rowsFor("snorkeler"), exceedsNoDecoLimits: true, divingCrew: true });
    expect(screen.getAllByText(new RegExp(words))).toHaveLength(1);
  });

  it("is silent once the last diver is released as a no-show", () => {
    const released = rowsFor("diver");
    (released.roster[0].booking as { status: string }).status = "no_show";
    renderRoster({ ...released, exceedsNoDecoLimits: true });
    expect(screen.queryByText(new RegExp(words))).toBeNull();
  });

  it("is silent on a finished departure's record", () => {
    renderRoster({
      ...rowsFor("diver"),
      exceedsNoDecoLimits: true,
      record: {
        dock: new Map(),
        afterDive: new Set(),
        rollCallTaken: true,
        unaccounted: new Set(),
        countedAboardBlocked: new Map(),
      } as never,
    });
    expect(screen.queryByText(new RegExp(words))).toBeNull();
  });
});

describe("the guests ledger (slice 5d)", () => {
  it("files every seat under a group band that owns the state word and the count", () => {
    renderRoster(fixtures);

    // The band is a real heading, once per group — the word plus the tally.
    expect(screen.getByRole("heading", { name: "Still to clear · 1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ready · 1" })).toBeVisible();
  });

  /**
   * **The bands are the Divers tab's second level** (UX review 2026-10-13,
   * item 39). The departure page draws the roster under its own H1 with no
   * summary heading, and the bands were H3: a screen reader moving by level
   * found nothing at 2 on the page the desk uses most.
   */
  it("gives its group bands the level under the page title, skipping none", () => {
    renderRoster(fixtures);

    const bands = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(bands).toEqual(expect.arrayContaining(["Still to clear · 1", "Ready · 1"]));
    expect(screen.queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  it("never repeats the group's state word down its rows: a cleared seat is a name and a drawn mark", () => {
    const { container } = renderRoster(fixtures);

    // "Ready" appears exactly once on the surface — the group band. The old
    // roster printed it (with a 🌊) beside all seven cleared rows, which is
    // the repetition principle 9 forbids and this ledger removes.
    const readyWords = screen.getAllByText(/^Ready/);
    expect(readyWords).toHaveLength(1);

    // The cleared seat's mark is drawn SVG (decision 5) — no emoji anywhere
    // on the ledger, in any state.
    const row = container.querySelector(`#booking-${ready.booking.id}`);
    expect(row).not.toBeNull();
    expect(row?.querySelector("summary svg")).not.toBeNull();
    expect(container.textContent).not.toMatch(/[\u{1F30A}\u{1F382}\u{2705}\u{26A0}\u{274C}]/u);
  });

  it("keeps a blocked seat's sentence in the open, ahead of the cleared rows", () => {
    const { container } = renderRoster(fixtures);

    // The blocker sentence renders without any tap, under the name...
    expect(screen.getByText("No certification is on file for this trip.")).toBeVisible();
    // ...and said once: the row's panel holds the fix, not the sentence again.
    expect(screen.getAllByText("No certification is on file for this trip.")).toHaveLength(1);
    expect(container.querySelector(`#booking-${blocked.booking.id} details`)).not.toHaveAttribute(
      "open",
    );
    // Its one fix waits behind the row, pointing at the record that clears it.
    expect(
      screen.getByRole("link", { name: /Review certifications/, hidden: true }),
    ).toHaveAttribute("href", `/shop/blue-mantis/divers/${blocked.person.id}#cards`);

    // And the groups order the page's answer: open work above cleared seats.
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Still to clear · 1")).toBeLessThan(headings.indexOf("Ready · 1"));
  });

  /**
   * **A blocker is said on its own diver, however many share it** (Aaron,
   * 2026-10-05). "1 blocker shared with other divers, listed above" named
   * neither the problem nor the fix, and there is no batched action for a
   * blocker that a shared line could stand for.
   */
  it("keeps critical names readable and says a shared blocker on every row it stops", () => {
    const secondBlocked = entry("c", "Mina Patel");
    const thirdBlocked = entry("d", "Owen Reed");
    const roster = [blocked, secondBlocked, thirdBlocked];
    const readiness = new Map([
      ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
      ["c", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
      ["d", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
    ]) as ReadinessByBooking;
    const { container } = renderRoster({
      roster,
      readiness,
      waivers: new Map([
        ["a", signedWaiver],
        ["c", signedWaiver],
        ["d", signedWaiver],
      ]) as WaiverByBooking,
    });

    expect(screen.getByRole("link", { name: "Asha Osei" })).toHaveClass(
      "text-base",
      "font-semibold",
    );
    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).not.toBeNull();
    expect(within(band as HTMLElement).queryByText(/3 divers:/)).toBeNull();
    expect(screen.getAllByText(/No certification/)).toHaveLength(3);
    expect(screen.queryByText(/shared with other divers/)).toBeNull();
    expect(container.querySelector("#roster > div.mt-5")).toBeNull();
  });

  it("keeps a diver's re-entry ask in the open, and off the cleared group", () => {
    // The ask is the one line on this row the diver wrote, and a request the
    // crew has not answered is still to clear — the same rule the free-text
    // preference note carried before D12 replaced it (ADR
    // 20260904-reef-all-the-way-down, D18). It reads as a fact beside a name:
    // no warning colour, no mark that means careful.
    renderRoster({
      roster: [entry("c", "Yara Halabi", { reEntryAsk: "deck_word" })],
      readiness: new Map([["c", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["c", signedWaiver]]) as WaiverByBooking,
    });

    const note = screen.getByText("Asked for a word with the divemaster.");
    expect(note).toBeVisible();
    expect(note.className).not.toMatch(/text-(danger|warning)/);
    expect(screen.getByRole("heading", { name: "Still to clear · 1" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /^Ready ·/ })).toBeNull();
  });

  it("offers no filter chips: the groups are the filter", () => {
    renderRoster(fixtures);

    expect(screen.queryByRole("navigation", { name: /filter/i })).toBeNull();
  });

  /**
   * **A finished departure's Divers tab is its record** (UX review
   * 2026-10-10, item 10): "Sailed" and "Didn't sail", never "Still to clear",
   * "Ready" or a Blocked capsule on a boat that is home.
   */
  it("files a finished departure as who sailed and who did not, with nothing to clear", () => {
    renderRoster({
      ...fixtures,
      record: {
        dock: new Map([
          [ready.booking.id, "boarded"],
          [blocked.booking.id, "not_boarded"],
        ]),
        afterDive: new Set(),
        rollCallTaken: true,
        unaccounted: new Set(),
        countedAboardBlocked: new Map(),
      },
    });
    expect(screen.getByRole("heading", { name: "Sailed · 1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Didn’t sail · 1" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Still to clear|Ready/ })).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("No certification is on file for this trip.")).toBeNull();
  });

  it("says the sailed diver's next dive under their row (fifth-loop ideas, item 4)", () => {
    renderRoster({
      ...fixtures,
      record: {
        dock: new Map([[ready.booking.id, "boarded"]]),
        afterDive: new Set(),
        rollCallTaken: true,
        unaccounted: new Set(),
        countedAboardBlocked: new Map(),
        below: new Map([[ready.booking.id, <p key="next">Booked Sat 11:30 AM</p>]]),
      },
    });
    expect(screen.getByText("Booked Sat 11:30 AM")).toBeVisible();
  });

  it("files a seat nobody counted at the dock under its own band, never as Didn't sail", () => {
    renderRoster({
      ...fixtures,
      record: {
        dock: new Map([[ready.booking.id, "boarded"]]),
        afterDive: new Set(),
        rollCallTaken: true,
        unaccounted: new Set(),
        countedAboardBlocked: new Map(),
      },
    });
    expect(screen.getByRole("heading", { name: "Sailed · 1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Not counted at the dock · 1" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Didn’t sail/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /No roll call taken/ })).toBeNull();
  });

  it("files a diver counted out and not back under its own band, never as Sailed", () => {
    renderRoster({
      ...fixtures,
      record: {
        dock: new Map([
          [ready.booking.id, "boarded"],
          [blocked.booking.id, "boarded"],
        ]),
        afterDive: new Set([blocked.booking.id]),
        rollCallTaken: true,
        unaccounted: new Set([blocked.booking.id]),
        countedAboardBlocked: new Map(),
      },
    });
    expect(screen.getByRole("heading", { name: "Not back aboard · 1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Sailed · 1" })).toBeVisible();
  });

  it("says on a sailed row, in words and with no control, that the diver was counted aboard while blocked", () => {
    renderRoster({
      ...fixtures,
      record: {
        dock: new Map([
          [ready.booking.id, "boarded"],
          [blocked.booking.id, "boarded"],
        ]),
        afterDive: new Set([blocked.booking.id]),
        rollCallTaken: true,
        unaccounted: new Set(),
        countedAboardBlocked: new Map([
          [
            blocked.booking.id,
            { checkpoint: "after_dive_1", blockers: [{ code: "certification_missing" }] },
          ],
        ]),
      },
    });
    expect(screen.getByRole("heading", { name: "Sailed · 2" })).toBeVisible();
    expect(screen.getByText("1 counted aboard while blocked")).toBeVisible();
    const line = screen.getByText(/Counted aboard \(After dive 1\) while blocked: /);
    expect(line).toBeVisible();
    // One line on the one seat, and the record asks for nothing: no Blocked capsule, no fixes.
    expect(screen.getAllByText(/while blocked: /)).toHaveLength(1);
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("makes add diver the terminal ledger group, including on an empty roster", () => {
    const { container } = renderRoster({
      roster: [],
      readiness: new Map() as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      addDiverGroup: <p data-testid="add-diver-form">Find a returning diver</p>,
    });

    const addDiver = container.querySelector("#add-diver");
    expect(addDiver).not.toBeNull();
    expect(
      within(addDiver as HTMLElement).getByRole("heading", { name: "Add a booking" }),
    ).toBeVisible();
    expect(within(addDiver as HTMLElement).getByTestId("add-diver-form")).toBeVisible();
    expect(screen.queryByText("No one on this boat yet")).toBeNull();
  });

  /**
   * The add-diver group sits between its band and the card's bottom edge at
   * one inset (pixel-craft class 5, K-164). Its wrapper was `pt-3 pb-5`, and
   * the search row's own `mt-4` made the top 28px against 20px below on every
   * trip capture; `AddDiverSection` now brings no margin, so the wrapper owns
   * both sides.
   */
  it("insets the add-diver group equally under its band and above the card's edge", () => {
    renderRoster({
      roster: [],
      readiness: new Map() as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      addDiverGroup: <p data-testid="add-diver-form">Find a returning diver</p>,
    });

    const wrapper = screen.getByTestId("add-diver-form").parentElement;
    expect(wrapper).toHaveClass("py-5");
    expect(wrapper?.className).not.toMatch(/(^|\s)(pt|pb)-/);
  });

  /**
   * A cleared seat with no notes and no arrival has nothing to put at the end
   * of its name line, and the pixel probe found the trailing slot rendered
   * anyway: an empty `div` that still took the line's 12px gap on every such
   * row of ten trip captures, and on a phone wrapped to a line of its own
   * whose 4px row gap put the name 2px above the row's centre.
   */
  it("leaves no empty slot at the end of a name line with nothing to show", () => {
    const { container } = renderRoster(fixtures);

    const clearedLine = container.querySelector(`#booking-${ready.booking.id} > div`);
    expect(clearedLine).not.toBeNull();
    expect(clearedLine?.querySelectorAll(":scope > :empty")).toHaveLength(0);
    expect(clearedLine?.children).toHaveLength(1);

    // A seat with a state word still gets the slot, pushed to the line's end.
    const blockedLine = container.querySelector(`#booking-${blocked.booking.id} > div`);
    expect(blockedLine?.children).toHaveLength(2);
    expect(blockedLine?.lastElementChild).toHaveClass("ms-auto");
    expect(blockedLine?.lastElementChild).toHaveTextContent("Blocked");
  });
});

/**
 * Pixel-craft geometry the audit measured on the roster
 * (docs/design/pixel-craft.md). jsdom has no layout, so each case pins the
 * class arithmetic that puts the pixels where they belong; the pixel probe
 * re-measures the rendered rows.
 */
describe("the roster's row geometry", () => {
  /**
   * K-157: the mark was pinned at `top-2.5`, the row's top padding when the
   * `li` was `py-2.5`. The `li` went to `py-1` and the 44px name line moved up
   * 6px; the mark stayed, 6px under the name and the "Blocked" pill on every
   * row. The mark's top is the `li`'s own padding, so the two 44px boxes share
   * one band.
   */
  it("pins each row's mark to the name line's band, at the row's own top padding", () => {
    const { container } = renderRoster(fixtures);

    for (const seat of fixtures.roster) {
      const row = container.querySelector(`#booking-${seat.booking.id}`);
      expect(row).toHaveClass("py-1");
      const mark = row?.querySelector("summary[aria-label]");
      expect(mark).toHaveClass("absolute", "top-1", "size-11");
      expect(mark).not.toHaveClass("top-2.5");
    }
  });

  /** A row that opens on a mark, then its words: the mark stands on the words' first line. */
  function expectMarkOnFirstLine(row: Element | null) {
    expect(row).toHaveClass("flex", "items-baseline");
    const column = row?.firstElementChild;
    expect(column).toHaveClass("shrink-0");
    expect(column?.firstElementChild).toHaveClass("h-lh", "items-center");
    expect(column?.querySelector("svg")).not.toBeNull();
  }

  /**
   * K-494: a bare 16px mark in a stretched `flex gap-2` row stood at the top
   * of the words' 20px line, 2.5–3px above its centre, on every blocker and
   * warning line. Each mark is now the row's `StatusMarkColumn`, a block one
   * line of the row's text tall with the mark centred in it.
   */
  it("stands each blocker's and warning's mark on the first line of its words", () => {
    const rusty = entry("r", "Olga Rust");
    renderRoster({
      roster: [
        blocked,
        { ...rusty, booking: { ...rusty.booking, lastDivedBand: "over_five_years" } },
      ] as RosterEntry[],
      readiness: new Map([
        ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
        ["r", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["a", signedWaiver],
        ["r", signedWaiver],
      ]) as WaiverByBooking,
    });

    const blocker = screen.getByText("No certification is on file for this trip.");
    expectMarkOnFirstLine(blocker.closest("li"));
    const warning = screen.getByText(/^Last dived/);
    expectMarkOnFirstLine(warning.closest("li"));
  });

  /**
   * K-181: the band aligns its title on the first baseline of the facts
   * beside it. Each fact line was `items-start` with a bare mark first, so
   * its baseline was the mark's foot and "STILL TO CLEAR · 3" sat 5px under
   * the sentence. The line is `items-baseline` now, its mark a column with a
   * line of its own, so the fact's words set the baseline the title meets.
   */
  it("lines the band's title up with its first fact's words, not the fact's mark", () => {
    const roster = [blocked, entry("c", "Mina Patel"), entry("d", "Owen Reed")];
    renderRoster({
      roster,
      readiness: new Map(roster.map((seat) => [seat.booking.id, deepRow()])) as ReadinessByBooking,
      waivers: new Map(roster.map((seat) => [seat.booking.id, signedWaiver])) as WaiverByBooking,
    });

    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).toHaveClass("items-baseline");
    const fact = within(band as HTMLElement).getByText(/3 divers: Reaches 30/);
    expectMarkOnFirstLine(fact.closest("p"));
    expect(fact.closest("p")).not.toHaveClass("items-start");
  });

  /**
   * K-267: the facts' column right-aligned each line (`sm:items-end`), so
   * the red marks in front of them stepped left line by line (x 888, 827,
   * 741 on minimum-seats). The column stays at the band's end, placed there
   * by the band's `justify-between`; its lines start on one edge.
   */
  it("starts every shared fact on one edge, so their marks form a column", () => {
    const roster = [blocked, entry("c", "Mina Patel"), entry("d", "Owen Reed")];
    renderRoster({
      roster,
      readiness: new Map(roster.map((seat) => [seat.booking.id, deepRow()])) as ReadinessByBooking,
      waivers: new Map(roster.map((seat) => [seat.booking.id, signedWaiver])) as WaiverByBooking,
    });

    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).toHaveClass("justify-between");
    const facts = within(band as HTMLElement)
      .getByText(/3 divers: Reaches 30/)
      .closest("p")?.parentElement;
    expect(facts).toHaveClass("sm:items-start");
    expect(facts).not.toHaveClass("sm:items-end");
  });

  /**
   * K-278 and K-364, the name line's trailing capsules. From `sm` they sit at
   * the line's end, against the mark, and the verdict is the last of them, so
   * "Blocked" meets the chevron whether or not a "Depth advisory" chip rides
   * with it (it was first, and jumped 136px when the chip was there). On a
   * phone the capsules wrap under the name and start on its column, verdict
   * first, like the name's own wrap (they right-aligned to the mark's edge, 6px
   * off the name, on no shared edge).
   */
  it("ends the capsules on the verdict from sm, and starts a phone's wrapped capsules on the name's column", () => {
    const { container } = renderRoster(fixtures);

    const verdict = within(
      container.querySelector(`#booking-${blocked.booking.id}`) as HTMLElement,
    ).getByText("Blocked");
    expect(verdict).toHaveClass("sm:order-last");
    const capsules = verdict.parentElement;
    expect(capsules?.firstElementChild).toBe(verdict);
    expect(capsules).toHaveClass("ms-auto", "justify-end", "max-sm:ms-0", "max-sm:justify-start");
  });

  /**
   * K-174: the roster drew its waiver send as a hand-rolled pill (fully
   * round, 16px inset, no `pressable`, no disabled state) while the diver
   * record draws the same act as the app's `sm` button. Both are the one
   * button now; an expired link's send wears `danger`.
   */
  it("draws the waiver's send as the app's own sm button, as the diver record does", () => {
    const unsent = entry("n", "Nadia Petrov");
    const lapsed = entry("x", "Xavier Lind");
    const blocker = [{ code: "certification_missing", params: undefined }];
    renderRoster({
      roster: [unsent, lapsed],
      readiness: new Map([
        ["n", readinessRow("blocked", blocker)],
        ["x", readinessRow("blocked", blocker)],
      ]) as ReadinessByBooking,
      waivers: new Map([
        [
          "x",
          {
            waiver: {
              id: "w-x",
              status: "sent",
              completedAt: null,
              signatureMethod: null,
              expiresAt: new Date("2020-01-01T00:00:00Z"),
              medicalAnswers: null,
            },
          },
        ],
      ]) as unknown as WaiverByBooking,
    });

    const send = screen.getByRole("button", { name: "Send waiver" });
    const resend = screen.getByRole("button", { name: "Link expired" });
    expect(send.className).toBe(buttonClass({ variant: "secondary", size: "sm" }));
    expect(resend.className).toBe(buttonClass({ variant: "danger", size: "sm" }));
    for (const control of [send, resend]) expect(control).not.toHaveClass("rounded-full");
  });

  /**
   * K-352: the notes row is the last thing in a row with open work, and its
   * body had no padding of its own below the form, so the bordered "Add
   * private note" button ended 4px above the row's rule: the `li`'s `py-1`,
   * which was sized for the 44px summary's own air. The body keeps 8px, so
   * the button clears the rule by the form's own 12px step.
   */
  /**
   * K-551: "Review certifications →" is 14px of text in a 44px box, and the
   * next line's `mt-3` stacked on the box's unseen 12px below it: 45px from
   * the link's ink to the note row's, where the row's other steps are 24–26.
   * The link gives that unseen half back (`-mb-3`, with `align-bottom` so its
   * line's strut keeps none of it, as `buttonClass`'s `outdent` does), and the
   * target stays whole.
   */
  it("gives back the unseen lower half of the certification link's target", () => {
    renderRoster(fixtures);

    const link = screen.getByRole("link", { name: /Review certifications/ });
    expect(link).toHaveClass("min-h-11", "-mb-3", "align-bottom");
  });
});

/**
 * **On the departure page the roster is spaced by the page** (K-262). It hung
 * `mt-5` there, one of five different steps between the page's sections; the
 * page's one `space-y-10` spaces it now. A roster outside that stack keeps its
 * own step.
 */
describe("the roster's place on the departure page", () => {
  it("carries no top margin of its own", () => {
    const { container } = renderRoster({
      roster: [],
      readiness: new Map() as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
    });
    const roster = container.querySelector("#roster");
    expect(roster).not.toBeNull();
    expect(roster?.className).not.toMatch(/(^|\s)mt-/);
  });
});

/**
 * **Every seat is one line, and the line says why** (owner, 2026-10-05;
 * dive-domain review the same day). The fixes fold behind the row; the facts a
 * crew must read before boarding never do, and a row filed under "Still to
 * clear" always says what keeps it there.
 */
describe("the one-line row", () => {
  it("says each blocker under the name, outside the fold", () => {
    renderRoster({
      roster: [entry("g", "Gus Lin", { dateOfBirth: "2013-01-01" })],
      readiness: new Map([
        [
          "g",
          readinessRow("blocked", [
            { code: "guardian_signature_missing", params: undefined },
            { code: "certification_missing", params: undefined },
          ]),
        ],
      ]) as ReadinessByBooking,
      waivers: new Map([["g", signedWaiver]]) as WaiverByBooking,
    });

    const cert = screen.getByText("No certification is on file for this trip.");
    expect(cert).toBeVisible();
    expect(cert.closest("details")).toBeNull();
    const row = cert.closest('li[id^="booking-"]') as HTMLElement;
    const lines = within(row).getAllByRole("listitem");
    // The guardian sentence and the cert sentence, both in the open.
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.closest("details")).toBeNull();
  });

  it("names the unsent waiver and the unpaid seat when no blocker does", () => {
    renderRoster({
      roster: [entry("w", "Wen Ito")],
      readiness: new Map([
        ["w", { ...readinessRow("ready"), paymentStatus: "unpaid" }],
      ]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      requiresPayment: true,
    });

    expect(screen.getByRole("heading", { name: "Still to clear · 1" })).toBeVisible();
    expect(screen.getByText("Waiver not signed yet")).toBeVisible();
    expect(screen.getByText("Not paid yet")).toBeVisible();
  });

  it("states no waiver reason for a held seat: that waiver is the matched diver's", () => {
    const held = entry("w", "Wen Ito");
    (held.booking as { identityUnconfirmedAt: Date | null }).identityUnconfirmedAt = new Date(
      "2026-10-01T12:00:00Z",
    );
    renderRoster({
      roster: [held],
      readiness: new Map([["w", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
    });
    expect(screen.queryByText("Waiver not signed yet")).toBeNull();
  });
});

/**
 * **A snorkeler held on a medical is told how to board them riding only**
 * (H-109, issue #2382). Staff switch the seat to rider; the rider chip carries
 * the warning. No new clearance exists, so the hint is only a pointer, and only
 * on a seat that is in the water on a medical hold.
 */
describe("a snorkeler held on a medical", () => {
  const hint = /change this seat to Rider/i;
  const medicalBlockers = {
    medical_review: [{ code: "medical_review", params: undefined }],
    medical_not_cleared: [{ code: "medical_not_cleared", params: undefined }],
  };

  it.each(["medical_review", "medical_not_cleared"] as const)(
    "points a snorkeler's %s hold at the switch to rider",
    (code) => {
      const snorkeler = entry("s", "Sky Lund", { participantType: "snorkeler" });
      renderRoster({
        roster: [snorkeler],
        readiness: new Map([
          ["s", readinessRow("blocked", medicalBlockers[code])],
        ]) as ReadinessByBooking,
        waivers: new Map([["s", signedWaiver]]) as WaiverByBooking,
      });
      expect(screen.getAllByText(hint)).toHaveLength(1);
    },
  );

  it("says nothing of the kind to a diver on the same hold", () => {
    renderRoster({
      roster: [entry("d", "Dee Park", { participantType: "diver" })],
      readiness: new Map([
        ["d", readinessRow("blocked", medicalBlockers.medical_review)],
      ]) as ReadinessByBooking,
      waivers: new Map([["d", signedWaiver]]) as WaiverByBooking,
    });
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("says nothing on a snorkeler blocked for something else", () => {
    renderRoster({
      roster: [entry("s", "Sky Lund", { participantType: "snorkeler" })],
      readiness: new Map([
        ["s", readinessRow("blocked", [{ code: "waiver_not_sent", params: undefined }])],
      ]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
    });
    expect(screen.queryByText(hint)).toBeNull();
  });
});

it("keeps readiness neutral for a booked diver already boarded without counter check-in", () => {
  renderRoster({
    ...fixtures,
    roster: [ready],
    arrival: { controls: new Map(), below: new Map(), boarded: new Set([ready.booking.id]) },
  });
  expect(screen.getByRole("heading", { name: "Ready · 1" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: /To arrive/ })).toBeNull();
});
