// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, RollCallRecord, TripManifest } from "@/lib/manifests";
import { DiverRollCall } from "./DiverRollCall";
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

const t = staffTranslator("en-US");
const TRANSLATORS = {
  "en-US": t,
  "es-ES": staffTranslator("es-ES"),
} as const;
type TestLocale = keyof typeof TRANSLATORS;

function diver(
  overrides: Partial<TripManifest["divers"][number]> = {},
): TripManifest["divers"][number] {
  return {
    bookingId: "00000000-0000-4000-8000-000000000001",
    fullName: "Meera Iyer",
    email: null,
    emergencyContactName: "Asha Iyer",
    emergencyContactPhone: "+1-305-555-0231",
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "own_kit" },
    nitroxRequested: false,
    checkedIn: false,
    buddyTeam: null,
    buddyAlert: null,
    ...overrides,
  } as TripManifest["divers"][number];
}

function boardedAt(): RollCallRecord {
  return {
    state: "boarded",
    occurredAt: new Date("2026-09-11T12:22:00.000Z"),
    recordedByName: "Keiko Tanaka",
  } as RollCallRecord;
}

function notBackAt(): RollCallRecord {
  return {
    state: "not_boarded",
    occurredAt: new Date("2026-09-11T12:29:00.000Z"),
    recordedByName: "Keiko Tanaka",
  } as RollCallRecord;
}

function renderList({
  divers,
  checkpoint = "after_dive_1",
  locale = "en-US",
}: {
  divers: TripManifest["divers"];
  checkpoint?: RollCallCheckpoint;
  /** Both locales, for the copy this list is the on-screen guarantee for. */
  locale?: TestLocale;
}) {
  return render(
    <DiverRollCall
      divers={divers}
      checkpoint={checkpoint}
      isDeparture={checkpoint === "departure"}
      shopSlug="blue-mantis"
      tripId="00000000-0000-4000-8000-0000000000ff"
      locale={locale}
      timezone="America/New_York"
      notesByBooking={new Map()}
      rollCallAction={vi.fn(async () => ({ ok: true }) as const)}
      addPrivateNoteAction={vi.fn(async () => undefined) as never}
      rollCallButtonCopy={() => ({ errorRefusal: "Try again", blockedMessage: "Still blocked" })}
      buddyTeamLabel={() => null}
      t={TRANSLATORS[locale]}
    />,
  );
}

/** Every element the screen paints in the app's danger hue at rest. */
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

/** The exception control, wherever in the row it happens to be. */
function exceptionControl(row: HTMLElement, name: string) {
  return [...row.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
}

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
        // aboard — so a desk blocker is not an alarm at the rail.
        diver({
          bookingId: "00000000-0000-4000-8000-000000000003",
          fullName: "Amara Osei",
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
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

/**
 * **A diver boarding over a physician's earlier "no" says so on the row**
 * (H-98; dive-domain review of #2096). A clean new release clears the diver,
 * and the warning used to live only in the person sheet, one tap away from
 * the rail where the crew decides. It takes the row's one capsule below a
 * split buddy team and a desk blocker, and above the minor, depth and
 * birthday capsules; the minor flag it displaces still reaches the panel and
 * the paper.
 */
describe("the earlier-refusal capsule", () => {
  const refusedBefore = {
    at: new Date("2026-09-01T12:00:00.000Z"),
    source: "digital",
    overriddenReferralAt: null,
    overriddenRefusal: { recordId: "w-refused", at: new Date("2026-08-20T12:00:00.000Z") },
    clearance: null,
    guardian: null,
  } as unknown as TripManifest["divers"][number]["medicalWaiver"];
  const CAPSULE = "Physician said no before";

  function capsuleOf(container: HTMLElement) {
    return container.querySelector(".basis-full");
  }

  it("puts a warning capsule on the row", () => {
    const { container } = renderList({ divers: [diver({ medicalWaiver: refusedBefore })] });
    const capsule = capsuleOf(container);
    expect(capsule).toHaveTextContent(CAPSULE);
    expect(within(capsule as HTMLElement).getByText(CAPSULE).className).toContain(
      "text-warning-strong",
    );
  });

  it("is short in Spanish too", () => {
    const { container } = renderList({
      divers: [diver({ medicalWaiver: refusedBefore })],
      locale: "es-ES",
    });
    const text = capsuleOf(container)?.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(24);
  });

  it("yields to a split buddy team and to a desk blocker", () => {
    const split = renderList({
      divers: [
        diver({
          medicalWaiver: refusedBefore,
          buddyAlert: "separated_after_dive",
          buddyTeam: { teamId: "t-1", others: [] },
        }),
      ],
    });
    expect(capsuleOf(split.container)).toHaveTextContent("Someone unaccounted for");
    expect(capsuleOf(split.container)).not.toHaveTextContent(CAPSULE);
    split.unmount();

    const blocked = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          medicalWaiver: refusedBefore,
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
        }),
      ],
    });
    expect(capsuleOf(blocked.container)).not.toHaveTextContent(CAPSULE);
  });

  it("outranks the minor, depth and birthday capsules, and the minor flag still shows", () => {
    renderList({
      divers: [
        diver({
          medicalWaiver: refusedBefore,
          age: 13,
          minor: true,
          birthday: { status: "today" },
        }),
      ],
    });
    const row = screen.getByRole("listitem");
    expect(row.querySelector(".basis-full")).toHaveTextContent(CAPSULE);
    expect(row.querySelector(".basis-full")).not.toHaveTextContent("Minor");
    expect(screen.getAllByText("Minor · age 13").length).toBeGreaterThan(0);
  });

  it("dates the refusal by the physician's evaluation, with the year", () => {
    const evaluated = {
      ...refusedBefore,
      overriddenRefusal: {
        recordId: "w-refused",
        at: new Date("2026-08-20T12:00:00.000Z"),
        evaluatedOn: "2026-08-03",
      },
    } as TripManifest["divers"][number]["medicalWaiver"];
    const { container } = renderList({ divers: [diver({ medicalWaiver: evaluated })] });
    expect(container.textContent).toMatch(/did not clear this diver on Aug\s3,\s2026/);
  });
});

/**
 * **A release standing over a referral nobody answered gets a row capsule
 * too** (dive-domain review of #2163), ranked just after the earlier refusal.
 */
describe("the unresolved-referral capsule", () => {
  const referred = {
    at: new Date("2026-09-01T12:00:00.000Z"),
    source: "digital",
    overriddenReferralAt: new Date("2026-06-11T02:00:00.000Z"),
    overriddenRefusal: null,
    clearance: null,
    guardian: null,
  } as unknown as TripManifest["divers"][number]["medicalWaiver"];

  it("puts a warning capsule on the row, and dates the referral with its year", () => {
    const { container } = renderList({ divers: [diver({ medicalWaiver: referred })] });
    expect(container.querySelector(".basis-full")).toHaveTextContent("Referral not cleared");
    expect(container.textContent).toMatch(
      /no physician clearance on file \(referred Jun\s10,\s2026\)/,
    );
  });

  it("yields to an earlier refusal, which keeps the capsule", () => {
    const both = {
      ...referred,
      overriddenRefusal: { recordId: "w", at: new Date("2026-05-02T16:00:00.000Z") },
    } as TripManifest["divers"][number]["medicalWaiver"];
    const { container } = renderList({ divers: [diver({ medicalWaiver: both })] });
    expect(container.querySelector(".basis-full")).toHaveTextContent("Physician said no before");
    expect(container.querySelector(".basis-full")).not.toHaveTextContent("Referral not cleared");
  });

  it("is short in Spanish too", () => {
    const { container } = renderList({
      divers: [diver({ medicalWaiver: referred })],
      locale: "es-ES",
    });
    const text = container.querySelector(".basis-full")?.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(24);
  });
});

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
 * **The name prints.** The name is the trigger that opens the person's sheet,
 * so it lives inside a `<button>`, and the packet's print backstop hides every
 * button in `.trip-print-bundle` (`globals.css`). Both packets printed every
 * roll-call row without its name until the trigger declared that its content
 * is the fact (`print-bundle.test.ts` reads the rule). The caret is the one
 * part of it that is only a control, so it stays off paper.
 */
describe("the roll call on paper", () => {
  it("marks the name trigger as content the packet prints, and keeps its caret off paper", () => {
    renderList({ divers: [diver()] });
    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });
    expect(trigger).toHaveAttribute("data-print-content");
    expect(within(trigger).getByText("Meera Iyer")).toBeVisible();
    const caret = trigger.querySelector("svg:last-child");
    expect(caret).not.toBeNull();
    expect(caret).toHaveClass("print:hidden");
  });

  it("prints the name as one line, not at the deck's 76px row", () => {
    // The mark does not print, so its 76px row and 12px inset have nothing to
    // hold on paper; carried there, every name was a 16mm band and a full
    // boat's roll call ran to extra pages (K-02 review).
    renderList({ divers: [diver()] });
    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });
    expect(trigger).toHaveClass("print:min-h-0", "print:py-1");
  });
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
   * **The rule under "Resolve blockers on Guests →" sits as far from the link's
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
 * **A held seat prints the seat, not the matched person** (issue #1690,
 * H-79). A walk-in tapped onto last season's "Maria Santos" must not carry her
 * next of kin, her daughter's age or her medical hold onto the boat under a
 * name nobody has confirmed: not on screen, and not on the printed sheet,
 * which is the half a screen-only test would miss.
 */
describe("a held seat on the manifest", () => {
  const heldSeat = (checkpoint: RollCallCheckpoint = "departure") =>
    renderList({
      checkpoint,
      divers: [
        diver({
          age: 13,
          minor: true,
          identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
          readiness: {
            status: "blocked",
            blockers: [{ code: "identity_unconfirmed" }, { code: "medical_review" }],
          },
          nitroxRequested: true,
          hotelPickupLocation: "Casa Marina",
        }),
      ],
    });

  it("withholds the contact, the age and the matched person's blockers, on paper too", () => {
    const { container } = heldSeat();
    const everything = container.textContent ?? "";
    expect(everything).not.toContain("Asha Iyer");
    expect(everything).not.toContain("+1-305-555-0231");
    expect(everything).not.toMatch(/age 13/);
    expect(everything).not.toContain(
      "A medical answer needs a doctor’s sign-off before this diver dives.",
    );
    // The print-only block says why, rather than "Not on file".
    const printed = container.querySelector<HTMLElement>(".print\\:block");
    expect(printed).not.toBeNull();
    expect(printed).toHaveTextContent(
      "Their contact, age and other details wait until the desk confirms who this is.",
    );
    expect(printed).not.toHaveTextContent("Not on file");
  });

  it("keeps the seat's own state: its name as booked, the blocked word and the pickup", () => {
    const { container } = heldSeat();
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    // Named as booked; the matched person is not named at the rail.
    expect(container.textContent).toContain("Maria");
    expect(container.textContent).not.toContain("Meera Iyer");
    expect(container.textContent).toContain("Casa Marina");
  });

  /**
   * **A hold behind the identity question still reaches the rail** (dive-domain
   * review 2026-10-06). The crew line says the desk settles it and that other
   * holds may apply, never which: "medical" would be a fact about the matched
   * person, and "confirm who this is" on paper tells the crew to settle it.
   */
  it("flags other holds on a held seat with a medical hold, and never says medical", () => {
    const { container } = heldSeat();
    const crewLine =
      "Not confirmed. The desk must settle who this is before boarding. Other holds may still apply.";
    expect(container.textContent).toContain(crewLine);
    const printed = container.querySelector<HTMLElement>(".print\\:block");
    expect(printed).toHaveTextContent(crewLine);
    expect(container.textContent?.toLowerCase()).not.toContain("medical");
    expect(printed?.textContent?.toLowerCase()).not.toContain("medical");
    expect(container.textContent?.toLowerCase()).not.toContain("confirm who this is");
  });

  it("says nothing of other holds when the identity question is the only one", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
          readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
        }),
      ],
    });
    expect(container.textContent).toContain(
      "Not confirmed. The desk must settle who this is before boarding.",
    );
    expect(container.textContent).not.toContain("Other holds may still apply.");
  });

  it("says the same in the person's own panel", () => {
    heldSeat("after_dive_1");
    fireEvent.click(screen.getByRole("button", { name: "Open details for Maria" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Their contact, age and other details wait until the desk confirms who this is.",
    );
    expect(dialog).not.toHaveTextContent("Asha Iyer");
    expect(dialog).toHaveTextContent("Diver · not yet confirmed");
  });

  it("shows everything again once the desk has confirmed who this is", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          age: 13,
          minor: true,
          readiness: { status: "blocked", blockers: [{ code: "medical_review" }] },
        }),
      ],
    });
    const everything = container.textContent ?? "";
    expect(everything).toContain("Asha Iyer");
    expect(everything).toContain("+1-305-555-0231");
    expect(everything).toContain("Minor · age 13");
    expect(everything).toContain(
      "A medical answer needs a doctor’s sign-off before this diver dives.",
    );
    expect(everything).not.toContain("wait until the desk confirms");
  });

  it("says it in Spanish too", () => {
    const { container } = renderList({
      locale: "es-ES",
      checkpoint: "departure",
      divers: [
        diver({
          readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
        }),
      ],
    });
    expect(container.textContent).toContain(
      "Su contacto, su edad y sus demás datos esperan a que el mostrador confirme de quién se trata.",
    );
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

  it("stays quiet for a diver counted aboard earlier", () => {
    const { container } = renderList({
      divers: [diver({ readiness: blocked, boardedEarlier: true })],
    });
    expect(dangerToned(container)).toHaveLength(0);
  });
});
