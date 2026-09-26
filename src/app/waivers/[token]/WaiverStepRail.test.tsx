// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  WAIVER_RAIL_TEST_ID,
  type WaiverRailSegmentId,
  WaiverStepRail,
  waiverRailProgress,
} from "./WaiverStepRail";

afterEach(cleanup);

const LABELS: Record<WaiverRailSegmentId, string> = {
  release: "Release",
  medical: "Medical",
  sign: "Sign",
};

/** The RSTC form this repo presents asks eleven page-one questions. */
const ELEVEN = 11;

/**
 * **The waiver's pacing, pinned as rules** — ADR 20260827-the-divers-thread,
 * decision 5 (slice 7e).
 *
 * Never a snapshot of the rail. What has to hold is the *counting rule* the
 * SPEC states segment by segment, the promise that the rail is not a navigator
 * until a refusal makes it one, and the accessibility commitment that no state
 * here is carried by colour alone. All three survive a restyle; a picture of
 * the rail would not.
 */
describe("the rail's counting rule", () => {
  it("opens at 0 of 3 on a waiver nobody has touched", () => {
    const progress = waiverRailProgress({
      medicalAnswered: 0,
      medicalTotal: ELEVEN,
      signed: false,
    });
    expect(progress).toMatchObject({ release: false, medical: false, sign: false, done: 0 });
  });

  it("settles Release on the first medical answer, and not before", () => {
    // There is no "I have read this" control on the release — presenting the
    // full text is what typed consent means here — so the honest evidence that
    // a diver has moved past it is that they have started answering the
    // questions underneath it.
    expect(
      waiverRailProgress({ medicalAnswered: 1, medicalTotal: ELEVEN, signed: false }),
    ).toMatchObject({ release: true, medical: false, done: 1 });
  });

  it("settles Medical only when every question the diver was handed is answered", () => {
    expect(
      waiverRailProgress({ medicalAnswered: ELEVEN - 1, medicalTotal: ELEVEN, signed: false }),
    ).toMatchObject({ medical: false, done: 1 });
    expect(
      waiverRailProgress({ medicalAnswered: ELEVEN, medicalTotal: ELEVEN, signed: false }),
    ).toMatchObject({ release: true, medical: true, sign: false, done: 2 });
  });

  it("keeps Medical open while a Box the diver's own answer opened is unanswered", () => {
    // "I am over 45 years of age" is the most ordinary yes on a dive boat, and
    // it puts four more required questions on the page. The page-one list is
    // complete and the form is not — so the *counter* keeps its page-one
    // denominator (one that grows when you answer honestly punishes honesty)
    // and the *settle mark* waits. Ticking here would have the rail calling the
    // section closed three inches above `QuestionnaireOutcome` saying "answer
    // those and you're done", over a submit `readMedicalAnswers` is about to
    // refuse — and a refused submit is the path that can lose the answers.
    expect(
      waiverRailProgress({
        medicalAnswered: ELEVEN,
        medicalTotal: ELEVEN,
        medicalFollowUpsRemaining: 4,
        signed: false,
      }),
    ).toMatchObject({ release: true, medical: false, sign: false, done: 1 });
    expect(
      waiverRailProgress({
        medicalAnswered: ELEVEN,
        medicalTotal: ELEVEN,
        medicalFollowUpsRemaining: 0,
        signed: false,
      }),
    ).toMatchObject({ release: true, medical: true, done: 2 });
  });

  it("never settles Sign on the page a diver is still filling in", () => {
    // A typed name and a ticked box are not a signature until `completeWaiver`
    // has accepted them. The active page therefore tops out at 2 of 3, however
    // complete the form looks.
    for (const answered of [0, 1, ELEVEN]) {
      const progress = waiverRailProgress({
        medicalAnswered: answered,
        medicalTotal: ELEVEN,
        signed: false,
      });
      expect(progress.sign).toBe(false);
      expect(progress.done).toBeLessThan(3);
    }
  });

  it("reads 3 of 3 on the completed state", () => {
    expect(waiverRailProgress({ medicalAnswered: 0, medicalTotal: 0, signed: true })).toMatchObject(
      { release: true, medical: true, sign: true, done: 3 },
    );
  });

  it("leaves Medical open on a signed record the shop is still holding", () => {
    // The completed state used to render "Release ✓ Medical ✓ Sign ✓ · 3 of 3
    // done" three lines under copy saying a doctor must confirm in writing
    // before this diver can go out. That is the product turning its own
    // blocking state into a ticked box (glossary, **Waiver / release**), and
    // the diver who reads the last thing on the page is the one who never
    // chases the sign-off and turns up at the dock unboardable.
    expect(
      waiverRailProgress({
        medicalAnswered: 0,
        medicalTotal: 0,
        medicalStillOpen: true,
        signed: true,
      }),
    ).toMatchObject({ release: true, medical: false, sign: true, done: 2 });
  });

  it("refuses to settle Medical against a questionnaire with no questions", () => {
    // An empty form is a bug, and a rail cheerfully reporting progress through
    // it would hide the bug behind a reassuring number.
    expect(
      waiverRailProgress({ medicalAnswered: 0, medicalTotal: 0, signed: false }),
    ).toMatchObject({ medical: false, done: 0 });
  });
});

describe("the rail as an object on the page", () => {
  function renderRail(overrides: {
    answered?: number;
    signed?: boolean;
    anchors?: Partial<Record<WaiverRailSegmentId, string>>;
  }) {
    const progress = waiverRailProgress({
      medicalAnswered: overrides.answered ?? 0,
      medicalTotal: ELEVEN,
      signed: overrides.signed ?? false,
    });
    return render(
      <WaiverStepRail
        progress={progress}
        labels={LABELS}
        doneLabel={`${progress.done} of 3 done`}
        anchors={overrides.anchors}
      />,
    );
  }

  it("names all three segments and states the count in words", () => {
    // Every colour-carried state also carries a word (ADR
    // 20260827-clearwater-surface-language). The marks differ by shape as well
    // as ink, and the aggregate is a sentence beside them.
    renderRail({ answered: ELEVEN });
    for (const word of ["Release", "Medical", "Sign", "2 of 3 done"]) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
  });

  it("is not a navigator on first pass", () => {
    // No refusal, no links: a diver cannot tap "Sign" to skip the release, and
    // the rail never offers to.
    const { container } = renderRail({ answered: 1 });
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("anchors only the segment a refusal has named", () => {
    const { container } = renderRail({
      answered: 0,
      anchors: { medical: "medical-questionnaire" },
    });
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "#medical-questionnaire");
    expect(links[0]).toHaveTextContent("Medical");
  });

  it("draws a held step as an open mark with the shortfall stated in words", () => {
    // Two settled ends and an open middle, and "2 of 3 done" beside them: the
    // state is legible with no colour perception, which is the whole reason the
    // count is a sentence rather than a row of ticks.
    const progress = waiverRailProgress({
      medicalAnswered: 0,
      medicalTotal: 0,
      medicalStillOpen: true,
      signed: true,
    });
    const { getByTestId } = render(
      <WaiverStepRail progress={progress} labels={LABELS} doneLabel="2 of 3 done" />,
    );
    const rail = getByTestId(WAIVER_RAIL_TEST_ID);
    expect(screen.getByText("2 of 3 done")).toBeInTheDocument();
    expect(rail.querySelector('[data-rail-step="medical"]')?.className).toContain("text-muted");
    expect(rail.querySelector('[data-rail-step="sign"]')?.className).not.toContain("text-muted");
  });

  it("keeps its hairlines and takes no elevation", () => {
    // Resting panels are flat; shadows belong to what floats. The rail rests.
    const { getByTestId } = renderRail({});
    const rail = getByTestId(WAIVER_RAIL_TEST_ID);
    expect(rail.className).toContain("border-y border-border");
    expect(rail.className).not.toMatch(/shadow/);
  });

  it("lays each step out as a box, not as a mark sitting on a line of body text", () => {
    // A block `<li>` set `SettledCheck`'s inline-flex mark on its own 16px/24px
    // text strut, so the list stood 26px tall with the 20px mark at its top:
    // the rings sat 13px under the top hairline and 19px over the bottom one,
    // and the count, centred in that 26px, had its baseline 4px under the
    // labels' (pixel probe, waiver-active 1280, K-225). As a flex box the step
    // is its mark's height, the list is 20px, and the count shares its centre
    // and baseline — and the loaded rail is the skeleton's 46px.
    const { getByTestId } = renderRail({ answered: 1 });
    const steps = getByTestId(WAIVER_RAIL_TEST_ID).querySelectorAll("li[data-rail-step]");
    expect(steps).toHaveLength(3);
    for (const step of steps) {
      expect(step.className.split(" ")).toEqual(expect.arrayContaining(["flex", "items-center"]));
    }
  });

  it("keeps the count on the steps' line at 390, and starts it at the left edge when it wraps", () => {
    // At 390 the steps end at x 277 of a 20–370 column and the count is 75px
    // wide: with 20px between them the row needed 372px, so the count dropped
    // to a line of its own and the rail grew from 50px to 74px (K-533). 16px
    // between the list and the count fits it, while the steps keep their 20px.
    //
    // The count is spread to the row's end, not pushed there by `ms-auto`: on
    // one line it still ends the row, but a count that does wrap (360, or a
    // longer language) starts its line at the column's left edge, where the
    // margin floated it right, under nothing.
    const { getByTestId } = renderRail({});
    const rail = getByTestId(WAIVER_RAIL_TEST_ID);
    const row = rail.className.split(" ");
    expect(row).toEqual(expect.arrayContaining(["justify-between", "gap-x-4"]));
    expect(row).not.toContain("gap-x-5");
    expect(rail.querySelector("ol")?.className.split(" ")).toContain("gap-x-5");
    const count = screen.getByText("0 of 3 done");
    expect(count.className).not.toMatch(/(?:^|\s)(?:[\w-]+:)?ms-auto(?:\s|$)/);
  });
});

describe("what the rail must never say", () => {
  const SOURCE = readFileSync(join(__dirname, "WaiverStepRail.tsx"), "utf8");
  /** Everything below the module's own doc comment. */
  const BODY = SOURCE.slice(SOURCE.indexOf("export const WAIVER_RAIL_TEST_ID"));

  it("holds no copy of its own", () => {
    // Every word on this page sits under the waiver/medical wording freeze
    // (H-01/H-03), so the rail takes its three names and its count from the
    // caller's already-translated bundle and holds none itself. A file with no
    // strings in it is a file a reword cannot reach.
    expect(BODY).not.toContain("useTranslations");
    expect(BODY).not.toContain("@/i18n/");
  });

  it("says nothing about medical outcomes", () => {
    // The rail counts steps, never answers, and never states a consequence of
    // one. `QuestionnaireOutcome` is the only thing on this page that speaks
    // about what an answer means.
    expect(BODY).not.toMatch(/cleared|clearance|fit to dive|physician|referral/i);
  });
});
