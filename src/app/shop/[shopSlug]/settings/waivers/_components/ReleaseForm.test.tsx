// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { ShopQuestion } from "@/lib/waiver-questions";
import type { ReleaseFormState } from "../release-form-state";
import type { PublishReleaseCopy } from "./PublishRelease";
import { ReleaseForm } from "./ReleaseForm";
import { shopQuestionsCopy } from "./ShopQuestionsPanel";

vi.mock("next/navigation", () => ({ usePathname: () => "/shop/blue-mantis/waivers" }));

afterEach(cleanup);

const t = staffTranslator("en-US");
const BODY = "The release divers sign today, long enough to count as one release.";
const PUBLISHED: ShopQuestion[] = [
  { id: "insurance01", kind: "yes_no", prompt: "Do you carry dive insurance?", required: false },
];
const PUBLISH: PublishReleaseCopy = {
  choiceLegend: "This edit is",
  correction: "A correction: wording only",
  correctionDetail: "Every standing signature stays current.",
  correctionQuestions: "A correction: questions only",
  correctionQuestionsDetail: "Those divers are not asked the new questions.",
  material: "A material change",
  materialDetail: "Asks all 27 standing signatures to sign again.",
  materialQuestions: "A material change: everyone answers the new questions",
  materialQuestionsDetail: "Asks all 27 to sign again and answer.",
  action: "Publish",
  confirm: "Publish: 27 sign again",
  pending: "Publishing…",
};

function renderForm(
  action: (state: ReleaseFormState, data: FormData) => Promise<ReleaseFormState>,
) {
  return render(
    <ReleaseForm
      action={action}
      fieldLabel="Release text"
      placeholder=""
      initialBody={BODY}
      published={{ body: BODY, questions: PUBLISHED }}
      pdfDraft={null}
      standardQuestionnaire={null}
      questionsCopy={shopQuestionsCopy(t)}
      healthWords={[]}
      publishCopy={PUBLISH}
      standingSignatures
      refusalCopy={{
        body: "Too short.",
        materiality: "Say which.",
        questions: "Fix the questions.",
        questionNumbered: "That didn’t publish. Question {number} needs a fix.",
      }}
      status={null}
    />,
  );
}

describe("ReleaseForm", () => {
  // Dive-domain review 2, S1: the choice's words follow what changed.
  it("words the choice for a questions-only edit, and for a text edit", () => {
    renderForm(vi.fn());
    expect(screen.getByText(PUBLISH.correction)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("waiversStaff.questions.add") }));
    fireEvent.change(
      screen.getAllByLabelText(t("waiversStaff.questions.promptLabel"))[1] as Element,
      {
        target: { value: "How did you hear about us?" },
      },
    );
    expect(screen.getByText(PUBLISH.correctionQuestions)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Release text"), {
      target: { value: `${BODY} And one more sentence.` },
    });
    expect(screen.getByText(PUBLISH.correction)).toBeTruthy();
  });

  // Review 2, S2: what the server refuses comes back as it was typed.
  it("stands the typed text, questions and choice back up after a refusal", async () => {
    const typed: ShopQuestion[] = [
      ...PUBLISHED,
      {
        id: "heardabout1",
        kind: "choice",
        prompt: "Heard of us?",
        required: false,
        options: ["One"],
      },
    ];
    const action = vi.fn(
      async (): Promise<ReleaseFormState> => ({
        status: "refused",
        refusal: "questions",
        questionNumber: 2,
        typed: { body: `${BODY} Edited.`, questions: typed, material: "non-material" },
      }),
    );
    const { container } = renderForm(action);
    const form = container.querySelector("form");
    if (!form) throw new Error("no form");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByText("That didn’t publish. Question 2 needs a fix.")).toBeTruthy(),
    );
    expect((screen.getByLabelText("Release text") as HTMLTextAreaElement).value).toBe(
      `${BODY} Edited.`,
    );
    const prompts = screen.getAllByLabelText(t("waiversStaff.questions.promptLabel"));
    expect((prompts[1] as HTMLInputElement).value).toBe("Heard of us?");
    expect(screen.getByRole("listitem", { name: "Question 2" }).textContent).toContain(
      t("waiversStaff.questions.problem.optionsCount"),
    );
    // The text changed too, so the wording pair, with the choice made.
    expect(
      (screen.getByRole("radio", { name: /A correction: wording only/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
