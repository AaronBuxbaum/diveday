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
import { shopQuestionsCopy } from "./ShopQuestionsPanel";

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
    expect(screen.getByText(COPY.optionsCount)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(COPY.optionsLabel), {
      target: { value: "A friend\n\n  Online search \n" },
    });
    expect((posted(container) as ShopQuestion[])[0]).toMatchObject({
      kind: "choice",
      options: ["A friend", "Online search"],
    });
  });
});
