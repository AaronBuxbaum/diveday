// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RecapSite } from "@/db/recap";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { AfterState, type AfterStateProps } from "./AfterState";
import { props } from "./after-state-test-fixtures";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";
import { DiveRecord } from "./DiveRecord";

afterEach(cleanup);

/** The record as `AfterState` hands it over, from the same props the page test builds. */
function RecordOf({ context }: { context: AfterStateProps }) {
  return (
    <DiveRecord
      t={context.t}
      locale={context.locale}
      shop={context.shop}
      trip={context.trip}
      when={context.when}
      diverName={context.diverName}
      sites={context.sites}
      diveRecord={context.diveRecord}
      observedSpecies={context.observedSpecies}
      visitCount={context.visitCount}
      siteMark={context.siteMark}
      postcard={context.postcard}
      course={context.course}
    />
  );
}

/**
 * **What the record may claim** — the rules a review added on 2026-08-28,
 * after the print pass turned this card into a one-page logbook entry with a
 * ruled Notes block and a **Divemaster** signature rule.
 *
 * That framing is the reason these are not style preferences. Logged dive
 * counts and depths are what divers present for course prerequisites (Rescue,
 * Divemaster, Master Scuba Diver at 50 dives), and a divemaster handed this
 * page to sign is being asked to attest to whatever is printed on it. DiveDay
 * records nothing about dives *performed*, so the only honest page is one that
 * prints what the shop wrote down and leaves the rest as ruled blanks.
 */
/**
 * A compile-time half of the rule below: `RecapSite` carries the site's name
 * and nothing else, so a widened projection is a `pnpm typecheck` failure
 * here, beside the paragraph saying why, rather than a depth quietly reaching
 * a page a divemaster is asked to sign (issue #1120).
 */
type AssertNever<T extends never> = T;
type _RecapSiteCarriesOnlyItsName = AssertNever<Exclude<keyof RecapSite, "name">>;

describe("what the record may claim", () => {
  it("counts no dives — DiveDay has no record of dives performed", () => {
    // It printed `max(trips.planned_dives, sites.length)` as "{n} dives
    // logged": a number a shop typed on the trip row weeks earlier, so a diver
    // who sat out the second tank with an ear squeeze read "2 dives logged".
    // The key is gone from both bundles; this holds the surface to it.
    const { container } = render(<RecordOf context={props()} />);
    expect(container.textContent).not.toContain("diveCountSummary");
  });

  it("claims nothing was verified — only who recorded it", () => {
    render(<RecordOf context={props()} />);
    expect(screen.queryByText(/verifiedRecord/)).toBeNull();
    expect(screen.getByText("recap.recordedBy(Blue Mantis Divers)")).toBeInTheDocument();
  });

  it("names the sites and has nothing else about them to print", () => {
    // `dive_sites.max_depth_meters` is the *site's* deepest point — the
    // glossary says it "exists solely to be comparable to a certification's
    // depth ceiling" — and when it was null the label fell back to
    // `depth_range`, free-text briefing prose, so "Max depth: 40–60 ft, sandy
    // patches" could print under a max-depth label. Neither is this diver's
    // dive.
    //
    // Both used to sit in `props()` so this test could watch them not render.
    // They are gone from `RecapSite` itself as of issue #1120, which is the
    // stronger guarantee: the surface cannot print a depth it is not handed,
    // and `_RecapSiteCarriesOnlyItsName` above fails `pnpm typecheck` the
    // moment the projection grows a second field. What is left here is the
    // half a type cannot state — that the sites *are* named.
    render(<RecordOf context={props()} />);
    const sites = screen.getByTestId(AFTER_STATE_TEST_IDS.sites);
    expect(sites.textContent).toContain("French Reef");
    expect(sites.textContent).not.toContain("maxDepthLabel");
  });

  it("still gives the printer its ruled blanks to write the dive up on", () => {
    // The numbers are the diver's to write and the signing divemaster's to
    // countersign. Deleting the claims without leaving the blanks would have
    // taken the keepsake down with them.
    render(<RecordOf context={props()} />);
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.printNotes)).toBeInTheDocument();
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.printSignature)).toBeInTheDocument();
  });
});

describe("the milestone stamp", () => {
  it("stamps a milestone visit instead of the plain count", () => {
    render(<RecordOf context={props({ visitCount: 10 })} />);
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.stamp)).toBeInTheDocument();
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.visitLine)).toBeNull();
  });

  it("leaves an ordinary visit its plain line and no stamp", () => {
    render(<RecordOf context={props({ visitCount: 12 })} />);
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.stamp)).toBeNull();
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.visitLine)).toBeInTheDocument();
  });

  it("says in words what the roundel draws", () => {
    // Colour and shape never carry a state alone: the whole label is the
    // `<svg>`'s accessible name, however its lines are broken up inside.
    render(<RecordOf context={props({ visitCount: 1 })} />);
    expect(screen.getByRole("img", { name: "recap.milestoneStampFirst" })).toBeInTheDocument();
  });
});

describe("the keepsake prints like a logbook page", () => {
  it("carries a ruled notes block and a signature rule, print-only", () => {
    render(<RecordOf context={props()} />);
    for (const id of [AFTER_STATE_TEST_IDS.printNotes, AFTER_STATE_TEST_IDS.printSignature]) {
      const block = screen.getByTestId(id);
      // `hidden` on screen, `print:block` on paper — the two halves of "this
      // exists for the printer and nowhere else".
      expect(block.className).toContain("hidden");
      expect(block.className).toContain("print:block");
    }
  });

  it("hides everything except the dive record when printing", () => {
    const { container } = render(
      <RecordOf context={props({ shoutout: "Come back for the wreck." })} />,
    );
    const record = screen.getByTestId(AFTER_STATE_TEST_IDS.record);
    for (const child of [...(container.querySelector("main")?.children ?? [])]) {
      if (child === record) {
        expect(child.className).not.toContain("print:hidden");
      } else {
        expect(child.className).toContain("print:hidden");
      }
    }
  });

  it("rules the facts' top edge on paper only, where the band's wash is gone", () => {
    // On screen the band's wash is the facts' top edge, and a rule 20px
    // under it drew that edge twice (K-595). In print the band goes
    // transparent and the rule is the only edge left.
    render(<RecordOf context={props()} />);
    const facts = screen.getByTestId(AFTER_STATE_TEST_IDS.record).querySelector("dl");
    expect(facts).toHaveClass("print:border-t", "divide-y");
    expect(facts).not.toHaveClass("border-t");
  });
});

describe("the postcard (ADR 20260901-diveday-reimagined, slice 13i)", () => {
  it("wears the shop's brand when the shop has one, and DiveDay's own when not", () => {
    const { container, unmount } = render(
      <AfterState
        context={props({
          shop: {
            ...props().shop,
            brandColor: DIVEDAY_BRAND_COLOR,
            brandDisplayFont: "bricolage_grotesque",
          },
        })}
      />,
    );
    const style = container.querySelector("[data-brand-style]");
    expect(style?.textContent).toContain("--primary:");
    expect(style?.textContent).toContain("--brand-display:");
    unmount();
    const plain = render(<RecordOf context={props()} />);
    expect(plain.container.querySelector("[data-brand-style]")).toBeNull();
  });

  it("draws the day's site on the record's face, decorative and off the printed page", () => {
    const { container } = render(<RecordOf context={props({ siteMark: "wreck" })} />);
    const face = screen.getByTestId(AFTER_STATE_TEST_IDS.face);
    const mark = face.querySelector("[data-site-mark]");
    expect(mark?.getAttribute("data-site-mark")).toBe("wreck");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.className).toContain("print:hidden");
    // One drawing on the page, and it sits on the shell so it keeps an edge
    // against the band that is the wash.
    expect(container.querySelectorAll("[data-site-mark]")).toHaveLength(1);
    expect(mark?.className).toContain("bg-surface");
    // The heading is still the heading — the face restyles it, never adds a
    // second one, and the day's facts below it still render once.
    expect(screen.getByRole("heading", { level: 2, name: "recap.logbookHeading" })).toBeTruthy();
    expect(screen.getAllByTestId(AFTER_STATE_TEST_IDS.sites)).toHaveLength(1);
  });

  it("lets the stamp leave the heading's row when the row cannot hold all three", () => {
    // At 390 the 120px mark and the stamp left "Dive log entry" 101px of the
    // 140 it needs, and it broke onto a second line for one word (K-596).
    // Wrapping, the stamp drops under the mark and the heading keeps one line.
    render(<RecordOf context={props({ visitCount: 1 })} />);
    const face = screen.getByTestId(AFTER_STATE_TEST_IDS.face);
    expect(face).toHaveClass("flex", "flex-wrap", "gap-y-3");
  });
});

/**
 * **The postcard's face says a number** (H-20260904-reef-go-all-way c, slice 16i).
 *
 * It said "Your 3rd dive day with Blue Mantis Divers" — a clause naming the
 * shop on a card whose eyebrow and whose footer both already name it, three
 * times on one postcard. The milestone roundel is the deliberate exception: on
 * the visits `visit-milestones.ts` names, the count *is* the moment and gets a
 * sentence of its own.
 */
describe("the dive-day number", () => {
  it("says the number and stops, without naming the shop again", () => {
    render(<RecordOf context={props({ visitCount: 3 })} />);
    const chip = screen.getByTestId(AFTER_STATE_TEST_IDS.visitLine);
    expect(chip).toHaveTextContent("recap.diveDayNumber(3)");
    expect(chip.textContent).not.toContain("Blue Mantis");
  });

  it("leaves the milestone roundel its own sentence", () => {
    render(<RecordOf context={props({ visitCount: 10 })} />);
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.stamp)).toBeInTheDocument();
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.visitLine)).toBeNull();
  });
});

/**
 * **The certifying session says so on the record** (fourth review, item 55),
 * and only from the card the shop issued from it: no card, no line.
 */
describe("the certified line", () => {
  it("names the level the shop recorded from this session", () => {
    const context = props();
    render(
      <RecordOf
        context={{
          ...context,
          course: {
            title: "Open Water Diver",
            nextStep: null,
            certification: { level: "open_water", issuedAt: new Date(0) },
          },
        }}
      />,
    );
    const line = screen.getByTestId(AFTER_STATE_TEST_IDS.certified);
    expect(line.textContent).toContain("recap.certifiedLabel");
    expect(line.textContent).toContain("course.certificationLevels.openWater");
  });

  it("says nothing about a session that issued no card", () => {
    const context = props();
    render(
      <RecordOf
        context={{
          ...context,
          course: { title: "Open Water Diver", nextStep: null, certification: null },
        }}
      />,
    );
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.certified)).toBeNull();
  });
});
