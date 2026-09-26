// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass } from "@/components/ui/button";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import type { SignedWaiverEntry } from "@/db/waivers";
import { staffTranslator } from "@/i18n/staff-messages";
import { SignatureLog, signatureRowId } from "./SignatureLog";

afterEach(cleanup);

const t = staffTranslator("en-US");
/** The demo shop's zone: UTC-5, so a late-evening UTC instant is still "yesterday" here. */
const TIMEZONE = "America/Cancun";

function entry(overrides: Partial<SignedWaiverEntry> & { id: string }): SignedWaiverEntry {
  const base: SignedWaiverEntry = {
    id: overrides.id,
    personId: `person-${overrides.id}`,
    personName: "Grace Mensah",
    tripId: "trip-1",
    tripTitle: "Two-Tank Reef — Molasses & French",
    tripStartsAt: new Date("2026-08-27T11:00:00Z"),
    status: "completed",
    signedAt: new Date("2026-08-28T02:41:00Z"),
    templateVersion: 4,
    guardian: null,
    integrity: "valid",
    flaggedPrompts: [],
  };
  return { ...base, ...overrides };
}

function renderLog(entries: SignedWaiverEntry[], pinned?: SignedWaiverEntry) {
  return render(
    <SignatureLog
      entries={entries}
      pinned={pinned ?? null}
      shopSlug="blue-mantis"
      locale="en-US"
      timezone={TIMEZONE}
      t={t}
    />,
  );
}

function rowFor(container: HTMLElement, id: string) {
  const row = container.querySelector(`#${signatureRowId(id)}`);
  if (!(row instanceof HTMLDetailsElement)) throw new Error(`no disclosure for ${id}`);
  return row;
}

/**
 * **The pin: a badge marks the exception, never the expectation** (ADR
 * 20260827-people-not-lists, decision 4; ADR
 * 20260827-clearwater-surface-language, decision 3).
 *
 * The shipped log wrote a green "Integrity verified" beside every row, which
 * is a page of green that teaches a reviewer to stop reading — and the one row
 * that has something to say then looks like more of the same. Absence is
 * asserted as hard as presence here for that reason.
 */
describe("integrity", () => {
  it("says nothing at all when the seal verifies", () => {
    renderLog([entry({ id: "a" })]);
    expect(screen.queryByText("Integrity mismatch")).toBeNull();
    expect(screen.queryByText("Not sealed")).toBeNull();
    // …and the row is still there to say nothing about.
    expect(screen.getByText("Grace Mensah")).toBeInTheDocument();
  });

  it("wears a word, not only a tone, when it does not", () => {
    renderLog([
      entry({ id: "a", integrity: "invalid", personName: "Yara Halabi" }),
      entry({ id: "b", integrity: "unsealed", personName: "Priya Sharma" }),
    ]);
    expect(screen.getByText("Integrity mismatch")).toBeInTheDocument();
    expect(screen.getByText("Not sealed")).toBeInTheDocument();
  });
});

/**
 * The day is the shared fact, so it is stated once at the head of the group
 * rather than on every row — and a group never stands over nothing.
 */
describe("day groups", () => {
  it("state the day once and order the days newest first", () => {
    const { container } = renderLog([
      entry({ id: "a" }),
      // 2026-08-26 16:18 in Cancun, an evening earlier in UTC terms.
      entry({ id: "b", signedAt: new Date("2026-08-26T21:18:00Z"), personName: "Lena Fischer" }),
    ]);
    const labels = [...container.querySelectorAll("section > h3")].map((node) => node.textContent);
    expect(labels).toEqual(["Aug\u00A027, 2026", "Aug\u00A026, 2026"]);
    // The time rides the row; the date does not repeat inside it.
    const row = rowFor(container, "a");
    expect(within(row).getByText("9:41 PM")).toBeInTheDocument();
  });

  it("render nothing when there is nothing signed", () => {
    const { container } = renderLog([]);
    expect(container.querySelectorAll("section")).toHaveLength(0);
  });
});

/**
 * "Pinned to the top" means first **within its own day**, never lifted out of
 * the grouping: the reviewer arriving from the roster's "View signed record"
 * is about to read the rows around it, and a row hoisted above the day
 * headings has lost the fact they are read by.
 */
describe("the ?record= pin", () => {
  it("leads its day group without leaving it", () => {
    const pinned = entry({
      id: "pinned",
      signedAt: new Date("2026-08-26T21:18:00Z"),
      personName: "Lena Fischer",
    });
    const { container } = renderLog(
      [
        entry({ id: "today", personName: "Yara Halabi" }),
        // Signed later the same day than the pinned record, and still second.
        entry({
          id: "later",
          signedAt: new Date("2026-08-26T23:00:00Z"),
          personName: "Noor Rahman",
        }),
      ],
      pinned,
    );

    const sections = [...container.querySelectorAll("section")];
    expect(sections).toHaveLength(2);
    expect(sections[0]?.querySelector("h3")?.textContent).toBe("Aug\u00A027, 2026");

    const yesterday = sections[1];
    if (!yesterday) throw new Error("the second day group did not render");
    expect(yesterday.querySelector("h3")?.textContent).toBe("Aug\u00A026, 2026");
    const ids = [...yesterday.querySelectorAll("details")].map((node) => node.id);
    expect(ids).toEqual([signatureRowId("pinned"), signatureRowId("later")]);
    // Opened, because reading it is why the reviewer followed the link.
    expect(rowFor(container, "pinned").open).toBe(true);
    expect(rowFor(container, "later").open).toBe(false);
  });
});

/**
 * The medical detail keeps the gating the trip roster already applies: the
 * summary says a follow-up is flagged, and the prompts a reviewer must read
 * are one deliberate gesture away, inside the row rather than on the page.
 */
describe("a flagged medical answer", () => {
  it("shows the flag on the row and keeps the answers behind it", () => {
    const { container } = renderLog([
      entry({
        id: "a",
        status: "medical_review",
        flaggedPrompts: ["Have you had chest surgery in the last 12 months?"],
      }),
    ]);
    const row = rowFor(container, "a");
    const summary = row.querySelector("summary");
    if (!summary) throw new Error("the row has no summary");

    expect(within(summary).getByText("Medical follow-up flagged")).toBeInTheDocument();
    expect(row.open).toBe(false);
    expect(
      within(row).getByText("Have you had chest surgery in the last 12 months?"),
    ).toBeInTheDocument();
    // The disclosure is the row's own, and it is what the answers sit behind —
    // never the summary, which would put them on the page at rest.
    expect(within(summary).queryByText(/chest surgery/)).toBeNull();
  });
});

describe("a row's box", () => {
  it("draws its rules on a ledger row's box and its square fill across the whole box, 8px clear of the name", () => {
    // The pixel probe (2026-09-25, staff-waivers-record): the summary is the
    // row's hover fill, and with no room of its own the fill's edge ran
    // straight into the diver's name (0px). The ledger's geometry, not a
    // rounded chip hanging past square rules: the row takes a `LedgerRow`'s
    // box, and the summary takes the row's room back as a negative margin and
    // keeps it as padding, so the fill runs rule to rule.
    const { container } = renderLog([entry({ id: "a" })]);
    const row = rowFor(container, "a").closest("li");
    expect(row).toHaveClass(...ledgerRowBoxClass.split(" "));
    const summary = rowFor(container, "a").querySelector("summary");
    expect(summary).toHaveClass("-mx-2", "px-2");
    expect(summary?.className).not.toMatch(/rounded/);
  });

  it("draws the pinned record's bar outside the box, so the pinned name and rules sit where every other row's do", () => {
    // As a start border with padding to clear it, the bar pushed the pinned
    // name 2px right of its neighbours and started its rules 12px left of
    // theirs. A pseudo-element takes no room from the row.
    const pinned = entry({ id: "pinned" });
    const { container } = renderLog([entry({ id: "b" })], pinned);
    const pinnedRow = rowFor(container, "pinned").closest("li");
    const plainRow = rowFor(container, "b").closest("li");
    expect(pinnedRow).toHaveClass("before:absolute", "before:bg-border-strong");
    const box = (li: Element | null) =>
      [...(li?.classList ?? [])].filter((token) => /^-?(?:m|p)[xse]-|^border-s/.test(token));
    expect(box(pinnedRow)).toEqual(box(plainRow));
  });

  it("rings a focused row inside its own box, so the ring never paints over the pinned bar", () => {
    // The bar sits 2-4px outside the row's box (`before:-start-1`, 2px wide),
    // and the global ring 2-5px outside it: outset, the ring covered the one
    // mark saying which record the link resolved, on the row a reviewer
    // arriving from the roster is there to read (dive-domain-expert review,
    // 2026-09-25). Inset, it is drawn inside the box, clear of the bar, and
    // every row rings the same way so the pinned one is not the odd one out.
    const pinned = entry({ id: "pinned" });
    const { container } = renderLog([entry({ id: "b" })], pinned);
    expect(rowFor(container, "pinned").closest("li")).toHaveClass(
      "before:-start-1",
      "before:w-0.5",
    );
    for (const id of ["pinned", "b"]) {
      const summary = rowFor(container, id).querySelector("summary");
      expect(summary).toHaveClass("focus-visible:focus-ring-inset");
    }
  });
});

/**
 * A row is a door that does not navigate: opening it reveals the two records
 * this signature belongs to, and the release it was given against — the fact
 * that decides whether it still counts, and the one thing on the row a
 * reviewer cannot infer from anything else.
 */
describe("the evidence block", () => {
  it("carries the release version and both doors", () => {
    const { container } = renderLog([entry({ id: "a", templateVersion: 3 })]);
    const row = rowFor(container, "a");
    expect(within(row).getByText("Release version 3")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Open the diver record" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-a",
    );
    expect(within(row).getByRole("link", { name: "Open the departure" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1",
    );
  });

  it("offers no departure door for an imported record that never had one", () => {
    const { container } = renderLog([
      entry({ id: "a", tripId: null, tripTitle: null, tripStartsAt: null }),
    ]);
    const row = rowFor(container, "a");
    expect(within(row).queryByRole("link", { name: "Open the departure" })).toBeNull();
    expect(within(row).getByText("Imported record")).toBeInTheDocument();
  });
});

function summaryOf(container: HTMLElement, id: string) {
  const summary = rowFor(container, id).querySelector("summary");
  if (!(summary instanceof HTMLElement)) throw new Error(`no summary for ${id}`);
  return summary;
}

/**
 * **A signature row is a ledger row's height** (docs/design/pixel-craft.md,
 * class 12). The pixel probe (staff-waivers, 2026-09-25) measured the rows 49px
 * apart against every other hairline ledger's 52: the summary kept the
 * ledger's old `min-h-12` under the row's 1px rule. A `LedgerRow` is
 * `min-h-13` on the element that carries its rule, so the summary under this
 * row's rule is the 51px left.
 */
describe("a row's height", () => {
  it("stands 52px from rule to rule, a LedgerRow's floor: the 1px rule and a 51px summary", () => {
    const { container } = renderLog([entry({ id: "a" })]);
    expect(rowFor(container, "a").closest("li")).toHaveClass("border-t");
    const summary = summaryOf(container, "a");
    expect(summary).toHaveClass("min-h-12.75");
    expect(summary).not.toHaveClass("min-h-12");
  });
});

/**
 * **On a phone the departure is read whole, on a line of its own** (class 8).
 * The pixel probe (staff-waivers@390): the departure shared the first line
 * with the name, the time and the caret, and truncated to 38–182px of its
 * 276–351px on every row — the date never showed, and a "Not sealed" row kept
 * only "Two-…". The column is 358px, wider than the longest seeded value, so
 * below `sm` the row takes `LedgerRow`'s `stacked` grammar: the name, time
 * and caret on the first line, the departure under them at full width.
 *
 * A badge is the exception, and below `sm` it takes a line of its own under
 * the departure. Left on the first line, "Medical follow-up flagged" (about
 * 193px with its mark) beside a name, the time and the caret needs more than
 * the 358px column for any name over about 62px, so on every flagged row the
 * time and caret wrapped to a middle line at its start and the departure took
 * a third. From `sm` up it is the one-line row it was.
 */
describe("a row on a phone", () => {
  it("drops the departure to a full-width line under the name instead of cutting it", () => {
    const { container } = renderLog([entry({ id: "a", integrity: "unsealed" })]);
    const summary = summaryOf(container, "a");
    const trip = within(summary).getByText(/Two-Tank Reef/);
    expect(trip).toHaveClass("max-sm:order-last", "max-sm:basis-full", "sm:truncate");
    expect(trip).not.toHaveClass("truncate");
    // The name pushes the time and caret to the first line's end.
    expect(within(summary).getByText("Grace Mensah")).toHaveClass("max-sm:me-auto");
  });

  it("keeps a flagged row's time and caret on the name's line, the badges on a line of their own", () => {
    const { container } = renderLog([
      entry({
        id: "a",
        integrity: "unsealed",
        flaggedPrompts: ["Have you had chest surgery in the last 12 months?"],
      }),
    ]);
    const summary = summaryOf(container, "a");
    const badges = within(summary).getByText("Medical follow-up flagged").parentElement;
    expect(within(summary).getByText("Not sealed").parentElement).toBe(badges);
    expect(badges?.parentElement).toBe(summary);
    // Below `sm` a full-width line after the departure's; from `sm` up the
    // badges are the row's own items again, where they always stood.
    expect(badges).toHaveClass("max-sm:order-last", "max-sm:basis-full", "sm:contents");
    // The name, the time and the caret keep their places on the first line.
    const moved = [...summary.children].filter((child) =>
      [...child.classList].some((token) => token.startsWith("max-sm:order")),
    );
    expect(moved).toEqual([within(summary).getByText(/Two-Tank Reef/), badges]);
  });

  it("draws no badge line on a row with nothing to flag", () => {
    const { container } = renderLog([entry({ id: "a" })]);
    const summary = summaryOf(container, "a");
    const fullWidth = [...summary.children].filter((child) =>
      child.classList.contains("max-sm:basis-full"),
    );
    expect(fullWidth).toEqual([within(summary).getByText(/Two-Tank Reef/)]);
  });
});

/**
 * **The open record reads evenly down to its closing rule** (class 4). The
 * pixel probe (staff-waivers-record@1280, ink to ink): the version line sat
 * 24px under the name, the doors 34px under the version and the closing rule
 * 31px under the doors — each door is a 44px target around a 20px line, so
 * its 12px of unseen box above and below stacked on the block's own
 * `gap-3` and `pb-4`. The gap counts the room above the doors (`gap-1`),
 * and the doors sink the room below into the block's padding (`outdent`)
 * when they end it; the padding (`pb-5`) is then the same 20px under the
 * doors as under the flagged answers, and keeps the ring 3px clear of the rule.
 */
describe("the evidence block's rhythm", () => {
  const tokens = (className: string) => className.split(/\s+/).filter(Boolean);

  it("counts the doors' unseen room in its gap, and sinks it into its padding when the doors end the block", () => {
    const { container } = renderLog([entry({ id: "a" })]);
    const row = rowFor(container, "a");
    expect(row.querySelector("summary + div")).toHaveClass("gap-1", "pb-5");
    const doors = within(row).getAllByRole("link");
    expect(doors).toHaveLength(2);
    for (const door of doors) {
      expect(door).toHaveClass(
        ...tokens(buttonClass({ variant: "link", size: "sm", flush: true, outdent: "block-end" })),
      );
    }
  });

  it("leaves the doors whole when the flagged answers close the block", () => {
    const { container } = renderLog([
      entry({ id: "a", flaggedPrompts: ["Have you had chest surgery in the last 12 months?"] }),
    ]);
    const row = rowFor(container, "a");
    const block = row.querySelector("summary + div");
    expect(block).toHaveClass("gap-1", "pb-5");
    expect(block?.lastElementChild?.textContent).toMatch(/chest surgery/);
    for (const door of within(row).getAllByRole("link")) {
      expect(door).not.toHaveClass("-mb-3");
    }
  });
});
