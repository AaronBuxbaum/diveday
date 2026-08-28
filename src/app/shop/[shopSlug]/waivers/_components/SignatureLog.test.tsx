// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(labels).toEqual(["Aug 27, 2026", "Aug 26, 2026"]);
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
    expect(sections[0]?.querySelector("h3")?.textContent).toBe("Aug 27, 2026");

    const yesterday = sections[1];
    if (!yesterday) throw new Error("the second day group did not render");
    expect(yesterday.querySelector("h3")?.textContent).toBe("Aug 26, 2026");
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
