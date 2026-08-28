// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CERTIFICATION_ROW_STATE_BADGE } from "@/i18n/card-labels";
import { readinessStatusText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import type { CertificationCardRowState } from "@/lib/certification-cards";
import { BookingStoryRow, CertificationCardRow, WaiverStateRow } from "./rows";

afterEach(cleanup);

const t = staffTranslator("en-US");
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rows.tsx"), "utf8");

/**
 * `Badge` is the app's only pill (ADR 20260827-clearwater-surface-language,
 * decision 3), and `rounded-full` is what makes one — so this finds a badge
 * without asserting anything about which one it is.
 */
function badgeIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".rounded-full");
}

/**
 * **The state→badge table, complete** (ADR 20260827-people-not-lists, decision
 * 6). The first case is the one worth the file: a certified card renders no
 * badge at all, because a badge marks the exceptional state and being certified
 * is what the shop wants. The silence is the design.
 */
describe("CertificationCardRow — the state→badge table", () => {
  it("renders no badge at all for a certified card", () => {
    const { container } = render(
      <CertificationCardRow as="div" t={t} title="PADI Open Water" state="verified" />,
    );
    expect(badgeIn(container)).toBeNull();
    // Not a tinted row either: the absence is total, not a quieter marking.
    expect(container.innerHTML).not.toMatch(/bg-success|bg-warning|bg-danger/);
  });

  it("marks a card awaiting review with the warning badge, glyph and word", () => {
    const { container } = render(
      <CertificationCardRow as="div" t={t} title="PADI Open Water" state="pending" />,
    );
    const badge = badgeIn(container);
    expect(badge).toHaveClass("bg-warning-tint", "text-warning-strong");
    expect(badge?.textContent).toContain("⚠️");
    expect(badge?.textContent).toContain(t("divers.shared.cardStatus.pending"));
  });

  it("words a diver's own claim as the diver's claim", () => {
    const { container } = render(
      <CertificationCardRow as="div" t={t} title="PADI Open Water" state="self_declared" />,
    );
    expect(badgeIn(container)).toHaveClass("bg-warning-tint");
    expect(screen.getByText(t("divers.certifications.selfDeclaredLabel"))).toBeTruthy();
  });

  it("prompts rather than warns on an imported card whose confirm is outstanding", () => {
    // Neutral, not warning: the card arrived already checked by the shop's own
    // previous system and one tap opens the gate — a prompt, not an alarm. The
    // *blocker* derived from the same fact carries the blocker's own tone.
    const { container } = render(
      <CertificationCardRow
        as="div"
        t={t}
        title="PADI Enriched Air"
        state="imported_unconfirmed"
      />,
    );
    const badge = badgeIn(container);
    expect(badge).toHaveClass("bg-surface-sunken", "text-muted");
    expect(badge?.className).not.toMatch(/bg-warning|bg-danger/);
    expect(badge?.textContent).toContain(t("divers.shared.cardStatus.confirmToClear"));
  });

  /**
   * Tone escalation, stated as a test because it reads as drift otherwise: on
   * an *artifact* row a card awaiting review is a warning. The blocker derived
   * from it — the record's status ledger, the home's station, readiness itself
   * — is what carries danger. One fact, two contexts.
   */
  it("never renders danger on the artifact row, whatever the state", () => {
    for (const state of Object.keys(CERTIFICATION_ROW_STATE_BADGE) as CertificationCardRowState[]) {
      const { container } = render(
        <CertificationCardRow as="div" t={t} title="PADI Open Water" state={state} />,
      );
      expect(container.innerHTML, state).not.toMatch(/danger/);
      cleanup();
    }
  });

  it("gives every non-certified state a visible word, never colour or a glyph alone", () => {
    for (const state of ["pending", "self_declared", "imported_unconfirmed"] as const) {
      const { container } = render(
        <CertificationCardRow as="div" t={t} title="PADI Open Water" state={state} />,
      );
      const badge = badgeIn(container);
      // The glyph is `aria-hidden`, so what is left is what a screen reader and
      // a colourblind scan actually get.
      const word = badge?.textContent?.replace(/\u26a0\ufe0f|\u2705|\u274c/gu, "").trim() ?? "";
      expect(word.length, state).toBeGreaterThan(0);
      cleanup();
    }
  });
});

describe("CertificationCardRow — provenance", () => {
  it("marks an imported card in words, on the line that carries its small print", () => {
    const { container } = render(
      <CertificationCardRow
        as="div"
        t={t}
        title="PADI Open Water"
        detail="card ···7231"
        state="verified"
        imported={{}}
      />,
    );
    expect(container.textContent).toContain(t("divers.certifications.importedLabel"));
    // A tint has never been allowed to carry this fact.
    expect(container.innerHTML).not.toMatch(/bg-warning|bg-danger|bg-primary/);
  });

  it("names the old system when the import knows it", () => {
    render(
      <CertificationCardRow
        as="div"
        t={t}
        title="PADI Open Water"
        state="verified"
        imported={{ source: "DiveShop360" }}
      />,
    );
    expect(
      screen.getByText(t("divers.certifications.importedWithSource", { source: "DiveShop360" })),
    ).toBeTruthy();
  });

  it("still marks an imported level card that reads plain certified", () => {
    // The trap H-24 sets: an imported *level* card genuinely clears, so its
    // state is `verified` and it renders no badge — and it must still say where
    // it came from, or the record shows a card this shop never sighted with
    // nothing at all distinguishing it.
    const { container } = render(
      <CertificationCardRow
        as="div"
        t={t}
        title="PADI Open Water"
        state="verified"
        imported={{}}
      />,
    );
    expect(badgeIn(container)).toBeNull();
    expect(container.textContent).toContain(t("divers.certifications.importedLabel"));
  });

  it("says nothing about provenance for a card the shop entered itself", () => {
    const { container } = render(
      <CertificationCardRow
        as="div"
        t={t}
        title="PADI Open Water"
        detail="card ···7231"
        state="verified"
      />,
    );
    expect(container.textContent).not.toContain(t("divers.certifications.importedLabel"));
  });
});

describe("WaiverStateRow", () => {
  it("gives every state a word", () => {
    for (const state of ["current", "expired", "none", "medical_review", "failed"] as const) {
      const { container } = render(<WaiverStateRow as="div" t={t} state={state} />);
      expect(container.textContent?.trim().length, state).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("distinguishes a lapsed signature from one that never existed", () => {
    // Two different conversations at the desk, and the record's own card said
    // "Not signed" about both until the shared vocabulary landed.
    const { container: expired } = render(<WaiverStateRow as="div" t={t} state="expired" />);
    const expiredWord = expired.textContent;
    cleanup();
    const { container: none } = render(<WaiverStateRow as="div" t={t} state="none" />);
    expect(none.textContent).not.toBe(expiredWord);
  });

  it("states the delivery failure rather than colouring the row red in silence", () => {
    const { container } = render(<WaiverStateRow as="div" t={t} state="failed" />);
    expect(container.textContent).toContain(t("divers.stats.waiverFailed"));
    expect(container.querySelector(".text-danger")).not.toBeNull();
  });

  it("lets the caller's own sentence stand when it has one", () => {
    render(
      <WaiverStateRow as="div" t={t} state="current" detail="signed Wed, Aug 26 · release v4" />,
    );
    expect(screen.getByText("signed Wed, Aug 26 · release v4")).toBeTruthy();
  });

  it("wears no colour and no pill when the release is current", () => {
    const { container } = render(<WaiverStateRow as="div" t={t} state="current" />);
    expect(badgeIn(container)).toBeNull();
    expect(container.innerHTML).not.toMatch(/text-warning|text-danger/);
  });

  it("puts the send routes beside the state, not under a second heading", () => {
    render(
      <WaiverStateRow
        as="div"
        t={t}
        state="none"
        actions={<button type="button">Email waiver</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Email waiver" })).toBeTruthy();
  });
});

describe("BookingStoryRow", () => {
  it("is a door to the departure it names", () => {
    render(
      <BookingStoryRow
        t={t}
        date="Thu, Aug 27"
        title="Two-Tank Reef — Molasses & French"
        meta="7:00 AM · waiver signed"
        href="/shop/blue-mantis/trips/t1"
      />,
    );
    expect(screen.getByRole("link", { name: "Two-Tank Reef — Molasses & French" })).toBeTruthy();
  });

  it("names the door by its own words when the title is not the destination", () => {
    // `href` and `linkLabel` are one union on `LedgerRow`, so a row cannot open
    // a door it has not named. The title is only the fallback: a caller with a
    // better sentence for where the row goes supplies it, and that sentence is
    // what a screen reader announces instead of the trip's name.
    render(
      <BookingStoryRow
        t={t}
        date="Thu, Aug 27"
        title="Two-Tank Reef — Molasses & French"
        href="/shop/blue-mantis/trips/t1"
        linkLabel="Open Thursday's two-tank reef trip"
      />,
    );
    expect(screen.getByRole("link", { name: "Open Thursday's two-tank reef trip" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Two-Tank Reef — Molasses & French" })).toBeNull();
  });

  it("marks an imported visit and refuses to be a door, even handed one", () => {
    // An imported row is a booking record the previous system held — evidence a
    // seat was reserved, not evidence anybody dived. There is no trip here to
    // open (ADR 20260725-import-prior-visits).
    render(
      <BookingStoryRow
        t={t}
        date="Mar 3"
        title="Reef morning — two tanks"
        href="/shop/blue-mantis/trips/t9"
        imported
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(new RegExp(t("divers.history.imported")))).toBeTruthy();
  });

  it("renders nothing money-shaped when no money fact was supplied", () => {
    // No "No order" badge by default: nothing is owed until something is
    // raised, and a grey pill on every un-invoiced seat is a permanent mark on
    // every shop that settles at the counter.
    const { container } = render(
      <BookingStoryRow t={t} date="Jul 12" title="Two-Tank Reef — Benwood & Elbow" past />,
    );
    expect(badgeIn(container)).toBeNull();
    expect(container.textContent).not.toContain(t("divers.payments.noOrder"));
  });

  it("keeps settled money quiet and marks the two states a staffer scans for", () => {
    const { container: paid } = render(
      <BookingStoryRow
        t={t}
        date="Jul 12"
        title="Benwood & Elbow"
        money={{ state: "paid", label: "$95.00" }}
      />,
    );
    expect(badgeIn(paid)).toBeNull();
    expect(screen.getByText("$95.00")).toHaveClass("tabular-nums", "text-muted");
    cleanup();

    const { container: open } = render(
      <BookingStoryRow
        t={t}
        date="Thu, Aug 27"
        title="Molasses & French"
        money={{ state: "open", label: "$95.00 due" }}
      />,
    );
    expect(badgeIn(open)).toHaveClass("bg-primary-tint");
    cleanup();

    const { container: refunded } = render(
      <BookingStoryRow
        t={t}
        date="Jun 2"
        title="Night dive"
        money={{ state: "refunded", label: "$120.00 back" }}
      />,
    );
    expect(badgeIn(refunded)).toHaveClass("bg-warning-tint");
  });
});

/**
 * The two facts about this module that no rendering can state, and that a later
 * slice adopting these rows would break silently.
 */
describe("the rows own no vocabulary and no formatter", () => {
  it("constructs no Intl formatter — every value arrives pre-formatted", () => {
    // A row that formatted a date would format it in the host zone, which is
    // UTC on every server and CI box: a 7:00 departure rendering as 11:00.
    // `date`, `meta` and a money `label` are the caller's, already locale- and
    // timezone-aware (AGENTS.md's clock and timezone rules).
    expect(SOURCE).not.toMatch(/new Intl\.|toLocale[A-Za-z]*String|nowDate\(|new Date\(/);
  });

  it("spells no readiness or certification-level word of its own", () => {
    // Those words resolve through `src/i18n/readiness-labels.ts` and arrive as
    // the caller's `title`; a second mapping here is how "Blocked" starts
    // reading two ways on two screens.
    expect(SOURCE).not.toMatch(/shared\.readiness\.|CERTIFICATION_LEVEL_KEYS|SPECIALTY_KEYS/);
    render(
      <CertificationCardRow
        as="div"
        t={t}
        title={readinessStatusText(t, "blocked")}
        state="pending"
      />,
    );
    expect(screen.getByText(readinessStatusText(t, "blocked"))).toBeTruthy();
  });
});
