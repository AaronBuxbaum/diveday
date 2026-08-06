// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { MedicalQuestionnaire } from "@/lib/medical";
import { RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { MedicalQuestionnaireFields } from "./MedicalQuestionnaireFields";

/**
 * The medical questionnaire's **branching**, which decides whether a diver is
 * recorded as needing a physician's sign-off.
 *
 * This is a safety-critical surface with real conditional state, and e2e can
 * only ever walk it one way. The property that needs a test of its own is the
 * one a human would never think to click: a Box opened by a primary "yes",
 * answered "yes" inside, and then closed again by changing the primary to "no".
 * Those child answers are now unreachable on screen. If they survive in state,
 * a diver who corrected their answer is still carrying a hidden yes.
 *
 * The words are English by design here (`src/lib/medical.ts` is
 * `i18n-exempt-file`: published UHMS/DMSC wording, pending H-01/H-03), so these
 * tests read the real questionnaire rather than inventing prompts — a question
 * renumbered upstream shows up here.
 */

afterEach(() => {
  cleanup();
});

const LABELS = {
  yesLabel: "Yes",
  noLabel: "No",
  reassurance: "A yes is not a no — it just means we check with a doctor first.",
};

/**
 * A minimal questionnaire with the one shape that matters: a primary question
 * that opens a box, two children inside it, an unrelated primary, and a dental
 * question. Built by hand rather than sliced from the real form so the
 * branching assertions do not move every time the published form is renumbered
 * — the real form is exercised separately below.
 */
const BRANCHING: MedicalQuestionnaire = {
  id: "test-branching",
  version: 1,
  jurisdiction: "rstc",
  title: "Test questionnaire",
  intro: "Answer every question.",
  boxes: [{ section: "box_a", title: "BOX A - I HAVE/HAVE HAD:" }],
  questions: [
    {
      id: "p1",
      prompt: "Have you ever had problems with your heart?",
      section: "primary",
      boxSection: "box_a",
      referral: false,
    },
    {
      id: "box_a_1",
      prompt: "Heart surgery",
      section: "box_a",
      parentId: "p1",
      referral: true,
    },
    {
      id: "box_a_2",
      prompt: "High blood pressure",
      section: "box_a",
      parentId: "p1",
      referral: true,
    },
    {
      id: "p2",
      prompt: "Are you pregnant?",
      section: "primary",
      referral: true,
    },
    {
      id: "d1",
      prompt: "Have you had recent dental surgery?",
      section: "dental",
      referral: true,
    },
  ],
};

/** The Yes/No radios belonging to one question, found by its prompt text. */
function radiosFor(prompt: string) {
  const fieldset = screen.getByRole("group", { name: prompt });
  return {
    yes: within(fieldset).getByRole("radio", { name: LABELS.yesLabel }),
    no: within(fieldset).getByRole("radio", { name: LABELS.noLabel }),
  };
}

describe("branch reveal", () => {
  it("keeps a box hidden until its primary question is answered yes", async () => {
    const user = userEvent.setup();
    render(<MedicalQuestionnaireFields questionnaire={BRANCHING} {...LABELS} />);

    expect(screen.queryByText("BOX A - I HAVE/HAVE HAD:")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Heart surgery" })).not.toBeInTheDocument();

    await user.click(radiosFor("Have you ever had problems with your heart?").yes);

    expect(screen.getByText("BOX A - I HAVE/HAVE HAD:")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Heart surgery" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "High blood pressure" })).toBeInTheDocument();
  });

  it("closes the box again when the primary is corrected to no", async () => {
    const user = userEvent.setup();
    render(<MedicalQuestionnaireFields questionnaire={BRANCHING} {...LABELS} />);
    const heart = radiosFor("Have you ever had problems with your heart?");

    await user.click(heart.yes);
    expect(screen.getByRole("group", { name: "Heart surgery" })).toBeInTheDocument();

    await user.click(heart.no);
    expect(screen.queryByRole("group", { name: "Heart surgery" })).not.toBeInTheDocument();
    expect(screen.queryByText("BOX A - I HAVE/HAVE HAD:")).not.toBeInTheDocument();
  });

  it("does not open a box for a primary question that has none", async () => {
    const user = userEvent.setup();
    render(<MedicalQuestionnaireFields questionnaire={BRANCHING} {...LABELS} />);

    await user.click(radiosFor("Are you pregnant?").yes);
    expect(screen.queryByText("BOX A - I HAVE/HAVE HAD:")).not.toBeInTheDocument();
  });
});

describe("a closed branch carries no hidden yes", () => {
  /**
   * The reason this component clears child answers rather than merely hiding
   * them. A diver ticks yes, ticks yes inside the box, then realises the
   * primary was wrong and corrects it. The box disappears — but if the child
   * yes is still in state, reopening the box shows it, and any submission built
   * from that state reports a referral the diver never stood behind.
   */
  it("clears a child yes when its parent flips to no, proven by reopening the box", async () => {
    const user = userEvent.setup();
    render(<MedicalQuestionnaireFields questionnaire={BRANCHING} {...LABELS} />);
    const heart = radiosFor("Have you ever had problems with your heart?");

    await user.click(heart.yes);
    await user.click(radiosFor("Heart surgery").yes);
    await user.click(radiosFor("High blood pressure").yes);
    expect(radiosFor("Heart surgery").yes).toBeChecked();

    // Correct the primary, then reopen the branch.
    await user.click(heart.no);
    await user.click(heart.yes);

    // Both children must read "no" — not "yes", and not unanswered.
    for (const prompt of ["Heart surgery", "High blood pressure"]) {
      const child = radiosFor(prompt);
      expect(child.yes, `${prompt} must not still be yes`).not.toBeChecked();
      expect(child.no, `${prompt} must be explicitly no`).toBeChecked();
    }
  });

  it("leaves an unrelated question's answer alone when a branch closes", async () => {
    // The clearing must be surgical: it walks `parentId`, so a sibling primary
    // answered yes has to survive its neighbour being corrected.
    const user = userEvent.setup();
    render(<MedicalQuestionnaireFields questionnaire={BRANCHING} {...LABELS} />);
    const heart = radiosFor("Have you ever had problems with your heart?");

    await user.click(radiosFor("Are you pregnant?").yes);
    await user.click(heart.yes);
    await user.click(heart.no);

    expect(radiosFor("Are you pregnant?").yes).toBeChecked();
  });
});

describe("prefilled answers", () => {
  it("reopens a box that initialResponses already answered yes", () => {
    // Resuming a half-finished waiver: the branch must be open on first paint,
    // or the diver silently submits a box they already filled in as unanswered.
    render(
      <MedicalQuestionnaireFields
        questionnaire={BRANCHING}
        initialResponses={{ p1: true, box_a_1: true }}
        {...LABELS}
      />,
    );

    expect(screen.getByRole("group", { name: "Heart surgery" })).toBeInTheDocument();
    expect(radiosFor("Heart surgery").yes).toBeChecked();
  });

  it("does not mutate the caller's initialResponses object", async () => {
    // The prop is `Readonly<Record<string, boolean>>` and the component copies
    // it into state. If it ever held the reference instead, answering would
    // write through to a server-rendered object.
    const user = userEvent.setup();
    const initial = { p1: true, box_a_1: true };
    render(
      <MedicalQuestionnaireFields
        questionnaire={BRANCHING}
        initialResponses={initial}
        {...LABELS}
      />,
    );

    await user.click(radiosFor("Have you ever had problems with your heart?").no);
    expect(initial).toEqual({ p1: true, box_a_1: true });
  });
});

describe("reassurance copy", () => {
  it("appears only under the questions actually answered yes", async () => {
    // A "yes" on a medical form is the moment a diver worries they have just
    // disqualified themselves. The line is shown per-question and only on yes.
    const user = userEvent.setup();
    render(<MedicalQuestionnaireFields questionnaire={BRANCHING} {...LABELS} />);
    expect(screen.queryByText(LABELS.reassurance)).not.toBeInTheDocument();

    await user.click(radiosFor("Are you pregnant?").yes);
    expect(screen.getAllByText(LABELS.reassurance)).toHaveLength(1);

    await user.click(radiosFor("Are you pregnant?").no);
    expect(screen.queryByText(LABELS.reassurance)).not.toBeInTheDocument();
  });
});

describe("form wiring", () => {
  it("names each radio group per question so a browser enforces one answer each", () => {
    // `required` + a shared `name` per question is what makes an unanswered
    // medical question un-submittable. Nothing else in the page enforces it.
    render(<MedicalQuestionnaireFields questionnaire={BRANCHING} {...LABELS} />);
    const pregnant = radiosFor("Are you pregnant?");

    expect(pregnant.yes).toHaveAttribute("name", "q_p2");
    expect(pregnant.no).toHaveAttribute("name", "q_p2");
    expect(pregnant.yes).toBeRequired();
    expect(pregnant.no).toBeRequired();
    expect(pregnant.yes).toHaveAttribute("value", "yes");
    expect(pregnant.no).toHaveAttribute("value", "no");
  });

  it("renders the dental section, which belongs to no box and no primary", () => {
    render(<MedicalQuestionnaireFields questionnaire={BRANCHING} {...LABELS} />);
    expect(
      screen.getByRole("group", { name: "Have you had recent dental surgery?" }),
    ).toBeInTheDocument();
  });
});

describe("the real published questionnaire", () => {
  it("renders every primary question and no box until one is answered", () => {
    // Guards against the component quietly dropping a section as the form is
    // revised: primaries and dental are always visible, boxes never are.
    render(<MedicalQuestionnaireFields questionnaire={RSTC_QUESTIONNAIRE} {...LABELS} />);

    const primaries = RSTC_QUESTIONNAIRE.questions.filter((q) => q.section === "primary");
    const dental = RSTC_QUESTIONNAIRE.questions.filter((q) => q.section === "dental");
    const boxChildren = RSTC_QUESTIONNAIRE.questions.filter((q) => q.parentId);
    expect(primaries.length).toBeGreaterThan(0);
    expect(boxChildren.length).toBeGreaterThan(0);

    expect(screen.getAllByRole("group")).toHaveLength(primaries.length + dental.length);
    for (const question of boxChildren) {
      expect(
        screen.queryByRole("group", { name: question.prompt }),
        `${question.id} must stay hidden until its parent is yes`,
      ).not.toBeInTheDocument();
    }
  });

  it("opens exactly the box belonging to the primary that was answered yes", async () => {
    const user = userEvent.setup();
    render(<MedicalQuestionnaireFields questionnaire={RSTC_QUESTIONNAIRE} {...LABELS} />);

    const opener = RSTC_QUESTIONNAIRE.questions.find((q) => q.boxSection);
    if (!opener?.boxSection) throw new Error("the published form must have a box-opening question");
    const ownChildren = RSTC_QUESTIONNAIRE.questions.filter((q) => q.parentId === opener.id);
    const otherChildren = RSTC_QUESTIONNAIRE.questions.filter(
      (q) => q.parentId && q.parentId !== opener.id,
    );

    await user.click(radiosFor(opener.prompt).yes);

    for (const child of ownChildren) {
      expect(
        screen.getByRole("group", { name: child.prompt }),
        `${child.id} belongs to the opened box`,
      ).toBeInTheDocument();
    }
    for (const child of otherChildren) {
      expect(
        screen.queryByRole("group", { name: child.prompt }),
        `${child.id} belongs to a different box and must stay closed`,
      ).not.toBeInTheDocument();
    }
  });
});
