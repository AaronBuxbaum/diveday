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

describe("the guests ledger (slice 5d)", () => {
  it("files every seat under a group band that owns the state word and the count", () => {
    renderRoster(fixtures);

    // The band is a real heading, once per group — the word plus the tally.
    expect(screen.getByRole("heading", { name: "Still to clear · 1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ready · 1" })).toBeVisible();
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
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
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
      compact: true,
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
      within(addDiver as HTMLElement).getByRole("heading", { name: "Add a diver" }),
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
  it("keeps the notes in their own band of the seat's panel, ruled off from the facts", () => {
    const { container } = renderRoster(fixtures);

    const row = container.querySelector(`#booking-${blocked.booking.id}`);
    const notes = within(row as HTMLElement)
      .getByText("Add a private note")
      .closest("details");
    expect(notes?.lastElementChild).toHaveClass("mt-2");
    expect(notes?.parentElement).toHaveClass("border-t", "border-border");
  });

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

  /**
   * K-354: every group band opens with a hairline except "ADD A DIVER". The
   * band draws `border-t … first:border-t-0`, and the add-diver band sat
   * first inside the `#add-diver` wrapper, so `first:` stripped its rule
   * though it is the card's last group. The group's rule is drawn by the
   * element that is the card's child: the band, or the box holding it.
   */
  it("opens the add-diver group with the same rule as every other group", () => {
    const { container } = renderRoster({
      ...fixtures,
      addDiverGroup: <p>Find a returning diver</p>,
    });

    const addDiver = container.querySelector("#add-diver");
    const ready = screen.getByRole("heading", { name: "Ready · 1" }).parentElement;
    // Siblings in the card, each drawing the rule between groups.
    expect(addDiver?.parentElement).toBe(ready?.parentElement);
    for (const group of [addDiver, ready]) {
      expect(group).toHaveClass("border-t", "first:border-t-0");
    }
    // The band inside the add-diver box draws none of its own.
    const band = within(addDiver as HTMLElement).getByRole("heading", {
      name: "Add a diver",
    }).parentElement;
    expect(band).not.toBe(addDiver);
    expect(band).not.toHaveClass("border-t");
  });
});

/**
 * **On the departure page the roster is spaced by the page** (K-262). It hung
 * `mt-5` there, one of five different steps between the page's sections; the
 * page's one `space-y-10` spaces it now. A roster outside that stack keeps its
 * own step.
 */
describe("the roster's place on the departure page", () => {
  it("carries no top margin of its own when compact", () => {
    const { container } = renderRoster({
      roster: [],
      readiness: new Map() as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      compact: true,
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

  it("offers to carry the gear a held seat paid for to the fit, ticked", () => {
    // The checkout kept it on the booking (dive-domain review of issue #2144);
    // "Same person" is where it can reach the fit, and the staffer may decline.
    const held = entry("w", "Wen Ito", { identityBookedAs: "Wen I." });
    Object.assign(held.booking, {
      identityUnconfirmedAt: new Date("2026-10-01T12:00:00Z"),
      paidRentalKinds: ["regulator", "wetsuit", "nitrox"],
    });
    const { container } = renderRoster({
      roster: [held],
      readiness: new Map([["w", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
    });
    const box = container.querySelector<HTMLInputElement>('input[name="applyPaidGear"]');
    expect(box?.checked).toBe(true);
    expect(box?.closest("label")?.textContent).toBe(
      "Add what they paid for to their fit: Regulator and Wetsuit",
    );
  });

  it("asks nothing about gear on a held seat that paid for none", () => {
    const held = entry("w", "Wen Ito", { identityBookedAs: "Wen I." });
    Object.assign(held.booking, { identityUnconfirmedAt: new Date("2026-10-01T12:00:00Z") });
    const { container } = renderRoster({
      roster: [held],
      readiness: new Map([["w", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
    });
    expect(container.querySelector('input[name="applyPaidGear"]')).toBeNull();
  });
});
