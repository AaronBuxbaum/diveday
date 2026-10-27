// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";
import {
  boardedAt,
  dangerToned,
  diver,
  exceptionControl,
  notBackAt,
  renderList,
  type TestLocale,
} from "./diver-roll-call-test-fixtures";
import { rollCallScrollMargin } from "./RollCallControls";

/**
 * **The two rules slice 5a owes ADR
 * 20260827-the-departure-is-two-working-surfaces**, pinned as behaviour rather
 * than as pixels:
 *
 * - **decision 3** — the not-back path is not reachable in one tap from the
 *   list. It lives inside a person's own panel, which costs a deliberate tap on
 *   their name first.
 * - **decision 4** — an alarm is earned by a recorded fact, never by the absence
 *   of one. At a checkpoint where nobody has recorded an exception, nothing on
 *   this list renders in danger tone.
 *
 * Deliberately not a screenshot. A pixel snapshot of this list fails on every
 * legitimate restyle and teaches the next reader to re-baseline without
 * reading, which on a safety surface is the worst habit a test can teach. What
 * these assert is what the ADR actually decided; the layout is free to move.
 */

afterEach(cleanup);

describe("the rail numbering is the roster's order and nothing else", () => {
  /**
   * **The coupling `getTripRoster` calls load-bearing, asserted from the
   * screen** (domain review of issue #1720).
   *
   * That query's docblock says "the index of this array **is** the rail
   * numbering", and three surfaces compute it positionally off the prop —
   * here, the offline dock copy, and the departure log. Nothing pinned it. A
   * future session adding a "blocked first" or an alphabetical sort to a
   * roll-call list would silently re-number the rail with every test still
   * green, and a crew would be counting down a list whose numbers no longer
   * match the sheet in the captain's hand.
   *
   * The prop order below is deliberately **not** alphabetical: a fixture that
   * is already sorted cannot fail if somebody adds a sort.
   */
  it("numbers rows by their position in the prop, never by name", () => {
    const { container } = renderList({
      divers: [
        diver({ bookingId: "00000000-0000-4000-8000-0000000000a1", fullName: "Zoe Adler" }),
        diver({ bookingId: "00000000-0000-4000-8000-0000000000a2", fullName: "Ana Ruiz" }),
        diver({ bookingId: "00000000-0000-4000-8000-0000000000a3", fullName: "Ángel Ferrer" }),
      ],
    });
    const rows = [...container.querySelectorAll("li")];
    const numbered = rows.map((row) => {
      const text = row.textContent ?? "";
      // The badge opens the row's text and runs straight into the name
      // ("01Zoe Adler"), so this anchors rather than looking for a boundary.
      return { line: text.match(/^(\d{2})/)?.[1] ?? null, text };
    });
    expect(numbered.map((row) => row.line)).toEqual(["01", "02", "03"]);
    expect(numbered[0]?.text).toContain("Zoe Adler");
    expect(numbered[1]?.text).toContain("Ana Ruiz");
    expect(numbered[2]?.text).toContain("Ángel Ferrer");
  });
});

describe("the not-back path is a deliberate two-step (decision 3)", () => {
  it("puts no exception control in the row a captain taps down the list", () => {
    renderList({ divers: [diver()] });
    const row = screen.getByRole("listitem");
    // The row's own tap is the affirmative, and it is the only control on the
    // row itself.
    expect(within(row).getByRole("button", { name: "Mark boarded" })).toBeVisible();
    const exception = exceptionControl(row, "Mark not back aboard");
    // The claim that somebody did not come back is absent until the person's
    // own sheet opens; there is no hidden duplicate control in the row DOM.
    expect(row.querySelector("details")).toBeNull();
    expect(exception).toBeUndefined();
    const trigger = within(row).getByRole("button", { name: "Open details for Meera Iyer" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the dock's wording behind the same two steps", () => {
    renderList({ divers: [diver()], checkpoint: "departure" });
    const row = screen.getByRole("listitem");
    const exception = exceptionControl(row, "Mark not boarded");
    expect(exception).toBeUndefined();
  });

  it("offers it once the person's own panel is open", () => {
    renderList({ divers: [diver()] });
    const row = screen.getByRole("listitem");
    // The sheet is the tap on the person — the same one that reveals their
    // contact, medical and notes.
    fireEvent.click(within(row).getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveTextContent("Emergency contact");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Mark not back aboard" }),
    ).toBeVisible();
  });
});

describe("the screen worries only with reason (decision 4)", () => {
  it("renders nothing in danger tone at a checkpoint with no recorded exception", () => {
    const { container } = renderList({
      divers: [
        diver(),
        // Counted back in — the ordinary mid-count state, and the one that
        // used to paint every teammate's row red before anyone had said a word
        // about them.
        diver({
          bookingId: "00000000-0000-4000-8000-000000000002",
          fullName: "Kiona Blackfeather",
          rollCall: boardedAt(),
        }),
        // Readiness never gates boarding after a dive — the diver is already
        // aboard — so a desk blocker is not an alarm at the rail. Boarded at
        // the dock: a row that cannot say so keeps its blocker (#2286).
        diver({
          bookingId: "00000000-0000-4000-8000-000000000003",
          fullName: "Amara Osei",
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
          boardedEarlier: true,
        }),
      ],
    });
    expect(dangerToned(container)).toHaveLength(0);
  });

  it("pins the alarm the moment a human records someone not back", () => {
    const { container } = renderList({
      divers: [diver({ rollCall: notBackAt() })],
    });
    expect(dangerToned(container).length).toBeGreaterThan(0);
    // And it carries a word, never colour alone: the who-and-when of the
    // record itself sits under the name.
    expect(screen.getByRole("listitem")).toHaveTextContent(/Keiko Tanaka/);
  });

  it("keeps the minor flag on screen when something louder took the row's capsule", () => {
    // The two cases where the capsule is spoken for — blocked at the dock, and
    // a split team — are exactly the ones where a 13-year-old is most likely to
    // be on the row that lost it. The captain reading the boarding list has no
    // other way to know a booked diver is 12 (H-21).
    renderList({
      checkpoint: "departure",
      divers: [
        diver({
          age: 13,
          minor: true,
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
        }),
      ],
    });
    expect(screen.getAllByText("Minor · age 13").length).toBeGreaterThan(0);
  });
});

describe("a recorded alarm sorts to the top, and paper does not (decision 4)", () => {
  /** The three seats, in the order the manifest gave them. */
  const roster = () => [
    diver({ bookingId: "b-1", fullName: "Ana Ruiz" }),
    diver({ bookingId: "b-2", fullName: "Diego Marín" }),
    diver({ bookingId: "b-3", fullName: "Priya Sharma", rollCall: notBackAt() }),
  ];

  it("pulls the not-back row to the top on screen while it keeps its manifest number", () => {
    const { container } = renderList({ divers: roster() });
    const rows = [...container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")];
    expect(rows.map((row) => row.id)).toEqual(["diver-row-b-1", "diver-row-b-2", "diver-row-b-3"]);

    // The move is `order-first` on a flex column, not a re-sorted array: the
    // DOM *is* the printed order, so paper never depends on what the screen
    // did. Priya is third in the document and first under a reader's eye.
    const alarmed = rows.find((row) => row.id === "diver-row-b-3");
    expect(alarmed?.className).toContain("order-first");
    expect(alarmed?.className).toContain("print:order-none");
    for (const row of rows.filter((candidate) => candidate.id !== "diver-row-b-3")) {
      expect(row.className).not.toContain("order-first");
    }

    // Her place on the manifest is a fact about the boat, not about the list,
    // so it rides with her.
    expect(within(alarmed as HTMLElement).getByText("03")).toBeTruthy();
  });

  it("draws the top hairline where each medium actually starts the list", () => {
    const { container } = renderList({ divers: roster() });
    const rule = (bookingId: string) =>
      container.querySelector<HTMLElement>(`li[id='diver-row-${bookingId}'] > div`)?.className ??
      "";

    // On screen the list starts at the alarmed row, so that one carries no top
    // rule and Ana -- first in the document -- now does.
    expect(rule("b-3")).toContain("border-t-0");
    expect(rule("b-1")).toMatch(/(^|\s)border-t(\s|$)/);
    // On paper the list starts at the top of the manifest, which is Ana.
    expect(rule("b-1")).toContain("print:border-t-0");
    expect(rule("b-3")).toContain("print:border-t");
  });

  it("holds the printed order in block layout, not on the cascade", () => {
    const { container } = renderList({ divers: roster() });
    const list = container.querySelector<HTMLElement>("ul");
    // `order` is inert outside a flex or grid container, so `print:block` is
    // what makes the DOM order the printed order by construction. Without it
    // the sheet a coastguard reads depends on Tailwind emitting the
    // `print:order-none` variant after `order-first` at equal specificity —
    // true today, and not something a manifest should rest on (dive-domain
    // review 20260828).
    expect(list?.className).toContain("flex");
    expect(list?.className).toContain("print:block");
  });

  it("keeps each row whole across a page break", () => {
    // The printed manifest goes ashore. A diver's name split down the middle
    // by a page boundary is a defect in the record, not a layout nit — the
    // printed tables carry the same class for the same reason.
    const { container } = renderList({ divers: roster() });
    for (const row of container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")) {
      expect(row.className).toContain("break-inside-avoid");
    }
  });

  it("gives the first and last rows the card's inner corner on paper, where nothing clips them", () => {
    // The print packets lift every `overflow` clip on purpose (a clipped box
    // on paper is content that does not exist), so the card's rounded corner
    // stopped cutting the rows and the 4px state stripe stood square across
    // it (pixel probe, day-packet-print: 14px of stripe past the curve at each
    // end). On paper the list is block layout in manifest order, so
    // `:first-child` is the first row painted — which it is not on screen,
    // where an alarmed row is `order-first` and the card still clips.
    const { container } = renderList({ divers: roster() });
    for (const row of container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")) {
      expect(row).toHaveClass(
        "border-l-4",
        "print:first:rounded-t-[calc(var(--radius-panel)-1px)]",
        "print:last:rounded-b-[calc(var(--radius-panel)-1px)]",
      );
      expect(row.className).not.toMatch(/(^|\s)(first|last):rounded/);
    }
  });

  it("keeps two alarmed rows in manifest order among themselves", () => {
    // Equal `order` values fall back to document order, so a second alarm does
    // not reshuffle the first. Worth pinning: a boat with two divers still in
    // the water is the moment a list that reorders under a thumb costs a
    // miscount, and nothing else in the suite states this.
    const { container } = renderList({
      divers: [
        diver({ bookingId: "b-1", fullName: "Ana Ruiz" }),
        diver({ bookingId: "b-2", fullName: "Diego Marín", rollCall: notBackAt() }),
        diver({ bookingId: "b-3", fullName: "Priya Sharma", rollCall: notBackAt() }),
      ],
    });
    const rows = [...container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")];
    expect(rows.map((row) => row.id)).toEqual(["diver-row-b-1", "diver-row-b-2", "diver-row-b-3"]);
    for (const id of ["diver-row-b-2", "diver-row-b-3"]) {
      expect(rows.find((row) => row.id === id)?.className).toContain("order-first");
    }
    // Diego is the first row on screen, so he carries no top rule and Ana --
    // still first in the document -- gains one.
    const rule = (bookingId: string) =>
      container.querySelector<HTMLElement>(`li[id='diver-row-${bookingId}'] > div`)?.className ??
      "";
    expect(rule("b-2")).toContain("border-t-0");
    expect(rule("b-3")).toMatch(/(^|\s)border-t(\s|$)/);
    expect(rule("b-1")).toMatch(/(^|\s)border-t(\s|$)/);
  });

  it("moves nothing when the only records are ordinary ones", () => {
    const { container } = renderList({
      divers: [
        diver({ bookingId: "b-1", fullName: "Ana Ruiz", rollCall: boardedAt() }),
        diver({ bookingId: "b-2", fullName: "Diego Marín" }),
      ],
    });
    for (const row of container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")) {
      expect(row.className).not.toContain("order-first");
    }
    // And the list still starts where the manifest does.
    expect(
      container.querySelector<HTMLElement>("li[id='diver-row-b-1'] > div")?.className,
    ).toContain("border-t-0");
  });
});

/**
 * **"Running late, said 7:42"** (#2319): the diver's own word on the dock row,
 * so the rail does not call missing someone who said they are on the way.
 * Quiet text under the name, never a capsule and never in the mark, and gone
 * the moment the crew board them.
 */
describe("a diver who said they are running late", () => {
  const saidAt = new Date("2026-09-11T11:42:00.000Z"); // 7:42 AM in New York
  const lateLine = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>("span")].find((element) =>
      element.textContent?.startsWith("Running late"),
    );

  it("says so, in the shop's zone, on a dock row nobody has called", () => {
    const { container } = renderList({
      divers: [diver({ runningLateAt: saidAt })],
      checkpoint: "departure",
    });
    const line = lateLine(container);
    // `formatTime` keeps "7:42 AM" whole with a no-break space.
    expect(line?.textContent?.replace(/\s/g, " ")).toBe("Running late, said 7:42 AM");
    expect(line?.className).toContain("text-muted");
    expect(line?.className).not.toMatch(/rounded-full|border|text-danger|text-warning/);
  });

  it("is gone once the diver is boarded", () => {
    const { container } = renderList({
      divers: [diver({ runningLateAt: saidAt, rollCall: boardedAt() })],
      checkpoint: "departure",
    });
    expect(lateLine(container)).toBeUndefined();
  });

  it("is not said after a dive, or on a seat the desk released or checked in", () => {
    for (const [checkpoint, extra] of [
      ["after_dive_1", {}],
      ["departure", { notHere: true }],
      ["departure", { checkedIn: true }],
    ] as const) {
      const { container } = renderList({
        divers: [diver({ runningLateAt: saidAt, ...extra })],
        checkpoint,
      });
      expect(lateLine(container)).toBeUndefined();
      cleanup();
    }
  });

  it("speaks Spanish on a Spanish manifest", () => {
    const { container } = renderList({
      divers: [diver({ runningLateAt: saidAt })],
      checkpoint: "departure",
      locale: "es-ES",
    });
    expect(lateLine(container)).toBeUndefined();
    expect(container.textContent).toContain("Llega tarde, avisó a las 7:42");
  });
});

/**
 * **This heading is what makes the abbreviated checkpoint track safe** (#1320).
 * Below `sm` the manifest's checkpoint switch says only "Dock" / "Dive 2"
 * (*Muelle* / *Inm. 2*), and a short word is a handle for a choice only while
 * the choice is spelled out somewhere on the same screen. That somewhere is
 * this list's opening `<h2>`, rendered unconditionally under the track at every
 * width and in every state. The summary panel *above* the track is not it: it
 * swaps the checkpoint's name for "Roll call complete" the moment every result
 * is in, which is exactly when a phone would otherwise be showing a checkpoint
 * nobody has named.
 *
 * So: whoever conditionalizes, moves or restyles this heading fails here rather
 * than shipping an unnamed checkpoint to a crew at the rail.
 */
describe("the checkpoint is named in full under the abbreviated track (issue #1320)", () => {
  /** The section's opening heading, which is the guarantee's actual position. */
  function rollCallHeading(container: HTMLElement) {
    return container.querySelector("h2")?.textContent;
  }

  /** Nothing recorded, every result in, and the alarm — the three the list has. */
  const states: Record<string, () => TripManifest["divers"]> = {
    "nothing recorded": () => [diver({ bookingId: "b-1", fullName: "Ana Ruiz" })],
    "every result in": () => [
      diver({ bookingId: "b-1", fullName: "Ana Ruiz", rollCall: boardedAt() }),
    ],
    "an alarm standing": () => [
      diver({ bookingId: "b-1", fullName: "Ana Ruiz", rollCall: notBackAt() }),
    ],
  };

  const headings: ReadonlyArray<readonly [TestLocale, RollCallCheckpoint, string]> = [
    ["en-US", "departure", "Before departure roll call"],
    ["en-US", "after_dive_2", "After dive 2 roll call"],
    ["es-ES", "departure", "Pase de lista · Antes de zarpar"],
    ["es-ES", "after_dive_2", "Pase de lista · Después de la inmersión 2"],
  ];

  for (const [locale, checkpoint, heading] of headings) {
    it(`says "${heading}" in every state (${locale})`, () => {
      for (const [state, roster] of Object.entries(states)) {
        const { container } = renderList({ divers: roster(), checkpoint, locale });
        expect(rollCallHeading(container), state).toBe(heading);
      }
    });
  }
});

describe("the skip link's landing", () => {
  /**
   * **"Skip to roll call" lands the list below the pinned count card**
   * (pixel-craft class 9, K-140). The section it jumps to had no scroll margin,
   * so it landed on the chrome bar's 56px, under the sticky count card (113px
   * tall at 1280, 173 at 390): the heading and the first names were under it.
   * The section takes the margin its own rows already wear, which reads the
   * card's published height.
   */
  it.each([
    ["departure", true],
    ["after_dive_1", false],
  ] as const)("clears the count card at %s", (checkpoint, isDeparture) => {
    const { container } = renderList({ divers: [diver()], checkpoint });
    const section = container.querySelector<HTMLElement>("[id$='roll-call-list']");
    expect(section?.tagName).toBe("SECTION");
    expect(section).toHaveClass(rollCallScrollMargin(isDeparture));
  });
});

describe("mixed training depth warning", () => {
  it("shows the conditional depth check before the roll call rows", () => {
    renderList({
      divers: [
        diver({
          bookingId: "intro",
          trainingDive: { courseTitle: "Intro", instructorAboard: false, intro: true },
        }),
        diver({
          bookingId: "entry",
          trainingDive: { courseTitle: "Open Water", instructorAboard: false, intro: false },
        }),
      ],
    });
    expect(
      screen.getByText(
        /If intro participants dive with other students, check the intro program’s depth limit/,
      ),
    ).toBeVisible();
  });
});
