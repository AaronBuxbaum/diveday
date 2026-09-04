// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { medicalQuestionField, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { MedicalQuestionnaireFields } from "./MedicalQuestionnaireFields";
import { QuestionnaireProgress } from "./QuestionnaireProgress";
import { WaiverPacing } from "./WaiverPacing";
import { WAIVER_RAIL_TEST_ID, type WaiverRailSegmentId } from "./WaiverStepRail";

afterEach(cleanup);

/**
 * **What the diver's own answers do to the count** — ADR
 * 20260827-the-divers-thread, decision 5 (slice 7e), and the two defects a
 * 2026-08-28 review found in it.
 *
 * `WaiverStepRail.test.tsx` pins the counting *rule* as arithmetic. This pins
 * the two things only a real questionnaire under a real listener can show: that
 * the HTML the server ships already carries the draft's own count, and that a
 * Box a diver's honest yes opens re-opens the medical step until it is
 * answered. Both were wrong, in the same direction: the page claimed more
 * progress than the diver had.
 */

const LABELS: Record<WaiverRailSegmentId, string> = {
  release: "Release",
  medical: "Medical",
  sign: "Sign",
};

/** The published form's own wording never reaches a test; these stand in. */
const COPY = {
  yesLabel: "Yes",
  noLabel: "No",
  referralReassurance: "A doctor should confirm you are fit to dive.",
  followUpReassurance: "This opens a few more questions.",
  outcomeClear: "You are done here.",
  outcomeReferral: "One of your answers needs a doctor.",
  outcomeFollowUpsOpen: "Your answers opened a few follow-up questions above.",
};

const PRIMARY = RSTC_QUESTIONNAIRE.questions.filter((question) => question.section === "primary");
const PRIMARY_FIELDS = PRIMARY.map((question) => medicalQuestionField(question.id));
const ALL_NO: Record<string, boolean> = Object.fromEntries(
  PRIMARY.map((question) => [question.id, false]),
);
/** "I am over 45 years of age" — the most ordinary yes on a dive boat. */
const OVER_45 = /I am over 45 years of age/;

function pacing(props: {
  initialAnswered: readonly string[];
  initialFollowUpsRemaining: number;
  responses?: Readonly<Record<string, boolean>>;
}) {
  return (
    <WaiverPacing
      labels={LABELS}
      progressOne="{done} of {total} done"
      progressOther="{done} of {total} done"
      medicalTotal={PRIMARY.length}
      initialAnswered={props.initialAnswered}
      initialFollowUpsRemaining={props.initialFollowUpsRemaining}
      locale="en-US"
    >
      {/* The page's own nesting: the rail above the release and the sticky
          counter inside the form read one count off one owner, so a test that
          renders only half of that could not catch them disagreeing. */}
      <QuestionnaireProgress
        total={PRIMARY.length}
        labelTemplateOne="{answered} of {total} answered"
        labelTemplateOther="{answered} of {total} answered"
      >
        <MedicalQuestionnaireFields
          questionnaire={RSTC_QUESTIONNAIRE}
          initialResponses={props.responses}
          copy={COPY}
        />
      </QuestionnaireProgress>
    </WaiverPacing>
  );
}

describe("the count the server ships", () => {
  it("opens at nothing on a waiver nobody has touched", () => {
    expect(
      renderToStaticMarkup(pacing({ initialAnswered: [], initialFollowUpsRemaining: 0 })),
    ).toContain("0 of 3 done");
  });

  it("states the draft's own progress in the first paint, beside the answers it restored", () => {
    // The defect this replaces: the count was seeded only by a post-mount
    // effect, so the HTML read "0 of 3 done" above ten radios the server had
    // just rendered checked. On dock wifi that is a wrong number sitting on
    // screen until the bundle boots; with JavaScript off it is permanent, and
    // this page deliberately supports that mode. Both facts are asserted
    // together on purpose — a count is only honest against what is beside it.
    const html = renderToStaticMarkup(
      pacing({
        initialAnswered: PRIMARY_FIELDS,
        initialFollowUpsRemaining: 0,
        responses: ALL_NO,
      }),
    );
    expect(html).toContain("2 of 3 done");
    expect(html).toContain(`${PRIMARY.length} of ${PRIMARY.length} answered`);
    expect(html.match(/checked/g) ?? []).toHaveLength(PRIMARY.length);
  });

  it("does not claim the medical step over a Box the draft left open", () => {
    const html = renderToStaticMarkup(
      pacing({
        initialAnswered: PRIMARY_FIELDS,
        initialFollowUpsRemaining: 4,
        responses: { ...ALL_NO, q2: true },
      }),
    );
    expect(html).toContain("1 of 3 done");
  });
});

describe("the count as the diver moves through the form", () => {
  it("re-opens Medical when an honest yes puts more questions on the page", async () => {
    render(
      pacing({
        initialAnswered: PRIMARY_FIELDS,
        initialFollowUpsRemaining: 0,
        responses: ALL_NO,
      }),
    );
    const rail = screen.getByTestId(WAIVER_RAIL_TEST_ID);
    await waitFor(() => expect(rail).toHaveTextContent("2 of 3 done"));

    await userEvent.click(
      within(screen.getByRole("group", { name: OVER_45 })).getByRole("radio", { name: "Yes" }),
    );

    // Box B's four required questions are on the page and blank. The rail and
    // the outcome line under the questions now say the same thing; before this
    // fix the rail said the section was done while the line three inches below
    // it said "answer those and you're done" and the submit refused.
    await waitFor(() => expect(rail).toHaveTextContent("1 of 3 done"));
    expect(screen.getByText(COPY.outcomeFollowUpsOpen)).toBeInTheDocument();

    const boxB = screen.getByRole("heading", { name: /BOX B/ }).parentElement;
    if (!boxB) throw new Error("Box B did not open under the question that opens it");
    for (const radio of within(boxB).getAllByRole("radio", { name: "No" })) {
      await userEvent.click(radio);
    }

    await waitFor(() => expect(rail).toHaveTextContent("2 of 3 done"));
    expect(screen.getByText(COPY.outcomeClear)).toBeInTheDocument();
  });

  it("leaves a Box the diver never opened blank, so a later yes asks its questions", async () => {
    // **The defect this pins is invisible to a seeded render.** `answer()`
    // cleared a question's children on every no, not only on a no that *closed*
    // an open branch — so working down the page-one list saying no wrote a no
    // into the four Box B questions nobody had ever seen. A later, honest yes
    // to "over 45" then opened Box B with all four already answered: the rail
    // said the medical step was done, the outcome line read `outcomeClear`, and
    // four answers the diver never read submitted into the signed record.
    //
    // Only a clicked run can catch it. Seeding `initialResponses` skips
    // `answer()` entirely, which is why every existing case here passed.
    render(pacing({ initialAnswered: [], initialFollowUpsRemaining: 0, responses: {} }));
    const rail = screen.getByTestId(WAIVER_RAIL_TEST_ID);
    for (const question of PRIMARY) {
      await userEvent.click(
        within(screen.getByRole("group", { name: question.prompt })).getByRole("radio", {
          name: "No",
        }),
      );
    }
    await waitFor(() => expect(rail).toHaveTextContent("2 of 3 done"));

    await userEvent.click(
      within(screen.getByRole("group", { name: OVER_45 })).getByRole("radio", { name: "Yes" }),
    );

    const boxB = screen.getByRole("heading", { name: /BOX B/ }).parentElement;
    if (!boxB) throw new Error("Box B did not open under the question that opens it");
    expect(within(boxB).queryAllByRole("radio", { checked: true })).toHaveLength(0);
    await waitFor(() => expect(rail).toHaveTextContent("1 of 3 done"));
    expect(screen.getByText(COPY.outcomeFollowUpsOpen)).toBeInTheDocument();
  });

  it("re-asks a Box the diver closes and reopens, rather than showing back their old answers", async () => {
    // **Issue #1135, owner ruling 2026-09-02.** The sibling of the case above,
    // and the half it left standing. A diver answers yes to "over 45", works
    // through Box B's four cardiac questions, changes their mind, sets it to
    // no, then back to yes. `answer()` used to write `false` into each child on
    // the way down, so the Box reopened with all four already answered — the
    // diver's own answers from minutes earlier, but ones they had not looked at
    // since, and the next thing they do is sign.
    //
    // Clicked because this is the toggle path, and `answer()` is what it
    // exercises. Seeding is not the weaker harness — it is the *production*
    // path for a restored draft, and it carried its own version of this bug
    // through a different writer; that half is pinned in
    // `MedicalQuestionnaireFields.test.tsx`'s seeded-draft case.
    render(pacing({ initialAnswered: [], initialFollowUpsRemaining: 0, responses: {} }));
    const rail = screen.getByTestId(WAIVER_RAIL_TEST_ID);
    const over45 = () => within(screen.getByRole("group", { name: OVER_45 }));
    const openBoxB = () => {
      const heading = screen.getByRole("heading", { name: /BOX B/ }).parentElement;
      if (!heading) throw new Error("Box B did not open under the question that opens it");
      return heading;
    };

    // The whole page-one list first, so the outcome line under the questions is
    // reporting on a complete answer set and the rail's Medical step is the
    // only thing Box B can move.
    for (const question of PRIMARY) {
      await userEvent.click(
        within(screen.getByRole("group", { name: question.prompt })).getByRole("radio", {
          name: "No",
        }),
      );
    }
    await waitFor(() => expect(rail).toHaveTextContent("2 of 3 done"));

    await userEvent.click(over45().getByRole("radio", { name: "Yes" }));
    for (const radio of within(openBoxB()).getAllByRole("radio", { name: "No" })) {
      await userEvent.click(radio);
    }
    expect(within(openBoxB()).queryAllByRole("radio", { checked: true })).toHaveLength(4);

    // Change of mind, and back again.
    await userEvent.click(over45().getByRole("radio", { name: "No" }));
    await userEvent.click(over45().getByRole("radio", { name: "Yes" }));

    // Nothing is answered for them, and the rail says so rather than reporting
    // a step the diver would have to trust it about.
    expect(within(openBoxB()).queryAllByRole("radio", { checked: true })).toHaveLength(0);
    await waitFor(() => expect(rail).toHaveTextContent("1 of 3 done"));
    expect(screen.getByText(COPY.outcomeFollowUpsOpen)).toBeInTheDocument();
  });

  it("counts the page-one list only, so answering honestly never lengthens the form", async () => {
    // The other half of the same rule: the *denominator* stays the ten
    // questions the diver was handed. A Box answer moves the settle mark, never
    // the counter — the sticky bar over the questions must not climb because
    // somebody told the truth about their age.
    render(pacing({ initialAnswered: [], initialFollowUpsRemaining: 0, responses: {} }));
    await userEvent.click(
      within(screen.getByRole("group", { name: OVER_45 })).getByRole("radio", { name: "Yes" }),
    );
    const counter = await screen.findByText(`1 of ${PRIMARY.length} answered`);
    expect(counter).toBeInTheDocument();
  });
});
