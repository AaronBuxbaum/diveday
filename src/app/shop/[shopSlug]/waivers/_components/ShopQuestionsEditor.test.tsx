// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  parseHealthWords,
  parseShopQuestions,
  SHOP_QUESTIONS_MAX,
  type ShopQuestion,
} from "@/lib/waiver-questions";
import { type ShopQuestionsCopy, ShopQuestionsEditor } from "./ShopQuestionsEditor";
import { shopQuestionHealthWords, shopQuestionsCopy } from "./ShopQuestionsPanel";

afterEach(cleanup);

const t = staffTranslator("en-US");
const COPY: ShopQuestionsCopy = shopQuestionsCopy(t);
const HEALTH_WORDS = parseHealthWords(t("waiversStaff.questions.healthWords"));

const QUESTIONS: ShopQuestion[] = [
  { id: "first000001", kind: "yes_no", prompt: "Do you carry dive insurance?", required: false },
  { id: "second00001", kind: "text", prompt: "Where are you staying?", required: true },
];

function posted(container: HTMLElement): unknown {
  const hidden = container.querySelector<HTMLInputElement>(
    'input[type="hidden"][name="questions"]',
  );
  if (!hidden) throw new Error("no questions field");
  return JSON.parse(hidden.value);
}

function promptBoxes(): HTMLInputElement[] {
  return screen.getAllByLabelText(COPY.promptLabel) as HTMLInputElement[];
}

/** Glossary *Shop question*; dive-domain review B1 and point 2. */
describe("ShopQuestionsEditor", () => {
  it("says what DiveDay already asks, so a shop does not ask it twice", () => {
    render(<ShopQuestionsEditor initialQuestions={[]} healthWords={HEALTH_WORDS} copy={COPY} />);
    const guidance = screen.getByText(COPY.alreadyAsked).textContent ?? "";
    for (const asked of ["date of birth", "emergency contact", "certification card", "guardian"]) {
      expect(guidance).toContain(asked);
    }
    expect(screen.getByText(COPY.empty)).toBeTruthy();
  });

  it("posts the list as the server parses it", () => {
    const { container } = render(
      <ShopQuestionsEditor initialQuestions={QUESTIONS} healthWords={HEALTH_WORDS} copy={COPY} />,
    );
    const list = posted(container);
    expect(list).toEqual(QUESTIONS);
    expect(parseShopQuestions(list)).toMatchObject({ ok: true, questions: QUESTIONS });
    // Only the one hidden field posts: no row leaks fields of its own.
    expect(container.querySelectorAll("[name]")).toHaveLength(1);
  });

  it("warns beside a health-worded prompt, and never refuses it", () => {
    const { container } = render(
      <ShopQuestionsEditor initialQuestions={QUESTIONS} healthWords={HEALTH_WORDS} copy={COPY} />,
    );
    expect(container.querySelectorAll("[data-health-warning]")).toHaveLength(0);
    const [first] = promptBoxes();
    if (!first) throw new Error("no prompt box");
    fireEvent.change(first, { target: { value: "Any heart conditions?" } });
    expect(container.querySelectorAll("[data-health-warning]")).toHaveLength(1);
    expect(screen.getByText(COPY.healthWarning)).toBeTruthy();
    expect((posted(container) as ShopQuestion[])[0]?.prompt).toBe("Any heart conditions?");
  });

  it("moves a question and Deletes one, keeping each id", () => {
    const { container } = render(
      <ShopQuestionsEditor initialQuestions={QUESTIONS} healthWords={HEALTH_WORDS} copy={COPY} />,
    );
    const [, moveDownSecond] = screen.getAllByRole("button", { name: COPY.moveDown });
    expect(moveDownSecond).toBeDisabled();
    const [firstMoveDown] = screen.getAllByRole("button", { name: COPY.moveDown });
    if (!firstMoveDown) throw new Error("no move button");
    fireEvent.click(firstMoveDown);
    expect((posted(container) as ShopQuestion[]).map((q) => q.id)).toEqual([
      "second00001",
      "first000001",
    ]);
    const [deleteFirst] = screen.getAllByRole("button", { name: COPY.delete });
    if (!deleteFirst) throw new Error("no delete button");
    fireEvent.click(deleteFirst);
    expect((posted(container) as ShopQuestion[]).map((q) => q.id)).toEqual(["first000001"]);
  });

  it("adds an optional yes-or-no question with a fresh id, up to the cap", () => {
    const { container } = render(
      <ShopQuestionsEditor initialQuestions={[]} healthWords={HEALTH_WORDS} copy={COPY} />,
    );
    const add = screen.getByRole("button", { name: COPY.add });
    fireEvent.click(add);
    const [added] = posted(container) as ShopQuestion[];
    expect(added).toMatchObject({ kind: "yes_no", required: false, prompt: "" });
    expect(added?.id).toMatch(/^[a-z0-9]{8,32}$/);
    for (let i = 1; i < SHOP_QUESTIONS_MAX + 2; i += 1) fireEvent.click(add);
    expect(posted(container) as ShopQuestion[]).toHaveLength(SHOP_QUESTIONS_MAX);
    expect(add).toBeDisabled();
    expect(screen.getByText(COPY.full)).toBeTruthy();
  });

  it("posts a choice question's options one per line", () => {
    const { container } = render(
      <ShopQuestionsEditor initialQuestions={QUESTIONS} healthWords={HEALTH_WORDS} copy={COPY} />,
    );
    const [kind] = screen.getAllByLabelText(COPY.kindLabel);
    if (!kind) throw new Error("no kind select");
    fireEvent.change(kind, { target: { value: "choice" } });
    // Two to eight options, said as a problem under the box from the start.
    expect(screen.getByText(COPY.problems.optionsCount)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(COPY.optionsLabel), {
      target: { value: "A friend\n\n  Online search \n" },
    });
    expect((posted(container) as ShopQuestion[])[0]).toMatchObject({
      kind: "choice",
      options: ["A friend", "Online search"],
    });
  });

  // Dive-domain review 2, S2: the editor checks the server's rules as the
  // staffer types, and the browser's own gate stops Publish, so a refused
  // list never throws away what was typed.
  describe("a list the server would refuse", () => {
    function withChoice(options: string) {
      const view = render(
        <form aria-label="release">
          <ShopQuestionsEditor
            initialQuestions={[
              {
                id: "heardabout1",
                kind: "choice",
                prompt: "How did you hear about us?",
                required: false,
                options: ["A friend", "Online search"],
              },
            ]}
            healthWords={HEALTH_WORDS}
            copy={COPY}
          />
        </form>,
      );
      fireEvent.change(screen.getByLabelText(COPY.optionsLabel), { target: { value: options } });
      const form = view.container.querySelector("form");
      if (!form) throw new Error("no form");
      return form;
    }

    it("makes the form invalid with one option, or nine, and says so under the options", () => {
      expect(withChoice("Only one").checkValidity()).toBe(false);
      expect(screen.getByText(COPY.problems.optionsCount)).toBeTruthy();
      cleanup();
      const nine = Array.from({ length: 9 }, (_, i) => `Option ${i + 1}`).join("\n");
      expect(withChoice(nine).checkValidity()).toBe(false);
      cleanup();
      expect(withChoice("A friend\nOnline search").checkValidity()).toBe(true);
    });

    it("makes the form invalid when two options are the same, or one is too long", () => {
      expect(withChoice("A friend\nA friend").checkValidity()).toBe(false);
      expect(screen.getByText(COPY.problems.duplicateOption)).toBeTruthy();
      cleanup();
      expect(withChoice(`A friend\n${"x".repeat(81)}`).checkValidity()).toBe(false);
      expect(screen.getByText(COPY.problems.optionTooLong)).toBeTruthy();
    });

    it("shows the refused question's problem at once after a server refusal", () => {
      render(
        <ShopQuestionsEditor
          initialQuestions={[
            ...QUESTIONS,
            {
              id: "third000001",
              kind: "choice",
              prompt: "Pick",
              required: false,
              options: ["One"],
            },
          ]}
          healthWords={HEALTH_WORDS}
          copy={COPY}
          refusedNumber={3}
        />,
      );
      const third = screen.getByRole("listitem", { name: "Question 3" });
      expect(third.textContent).toContain(COPY.problems.optionsCount);
    });
  });

  // Dive-domain review 1, S2 and S3: the questions shops copy from the RSTC
  // form, matched by the bundles' own lists, in a prompt or in an option.
  describe("the health warning", () => {
    const words = shopQuestionHealthWords();

    it.each([
      "Are you on blood thinners or any prescription drugs?",
      "Have you ever had decompression sickness or the bends?",
      "Any lung problems or trouble breathing?",
      "I confirm I am fit to dive",
      "Any recent illness or hospital stay?",
      "Do you have a pacemaker or stent?",
      "Do you suffer from panic attacks or anxiety?",
      "Any history of seizures or epilepsy?",
      "Are you diabetic?",
      "Are you pregnant?",
      "List any medication you take",
      "¿Toma anticoagulantes?",
      "¿Ha tenido enfermedad por descompresión?",
    ])("warns on %s", (prompt) => {
      const { container } = render(
        <ShopQuestionsEditor
          initialQuestions={[{ id: "healthq0001", kind: "text", prompt, required: false }]}
          healthWords={words}
          copy={COPY}
        />,
      );
      expect(container.querySelectorAll("[data-health-warning]")).toHaveLength(1);
    });

    it("warns on a health word in a choice option, and never refuses it", () => {
      const { container } = render(
        <form aria-label="release">
          <ShopQuestionsEditor
            initialQuestions={[
              {
                id: "anything001",
                kind: "choice",
                prompt: "Anything we should know?",
                required: false,
                options: ["Asthma", "Heart condition", "None of these"],
              },
            ]}
            healthWords={words}
            copy={COPY}
          />
        </form>,
      );
      expect(container.querySelectorAll("[data-health-warning]")).toHaveLength(1);
      expect(container.querySelector("form")?.checkValidity()).toBe(true);
    });

    it("says an answer is never checked or shown to the crew, and points at the medical alert", () => {
      expect(COPY.healthWarning).toContain("never checked");
      // Issue #2960: the field the crew does read.
      expect(COPY.healthWarning).toContain(
        "every release already asks for a medical alert for the crew",
      );
      expect(COPY.healthWarning).toContain("never shown to the crew as a medical alert");
    });

    it("leaves an ordinary question alone", () => {
      const { container } = render(
        <ShopQuestionsEditor
          initialQuestions={[
            {
              id: "ordinary001",
              kind: "choice",
              prompt: "How did you hear about us?",
              required: false,
              options: ["A friend", "Our hotel", "Instagram"],
            },
            {
              id: "insurance01",
              kind: "yes_no",
              prompt: "Do you carry DAN insurance?",
              required: false,
            },
          ]}
          healthWords={words}
          copy={COPY}
        />,
      );
      expect(container.querySelectorAll("[data-health-warning]")).toHaveLength(0);
    });
  });
});
