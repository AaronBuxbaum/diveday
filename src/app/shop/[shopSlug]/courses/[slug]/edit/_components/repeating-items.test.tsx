// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPEATING_ITEM_CARD_CLASS,
  repeatingItemAddClass,
  repeatingItemRemoveClass,
} from "@/components/editor/RepeatingItemCard";
import { DayByDayEditor, type DayByDayEditorCopy } from "./DayByDayEditor";
import { FaqEditor, type FaqEditorCopy } from "./FaqEditor";

afterEach(cleanup);

const DAY_COPY: DayByDayEditorCopy = {
  dayLabel: "Day {number}",
  removeDay: "Remove day",
  dayTitleLabel: "Day {number} title",
  dayTitlePlaceholder: "",
  startTimeLabel: "Day {number} start time",
  endTimeLabel: "Day {number} end time",
  timeNoteLabel: "Day {number} time note",
  timeNoteDescription: "",
  timeNoteTitle: "",
  timeNotePlaceholder: "",
  whatHappens: "Day {number} — what happens",
  whatHappensHint: "",
  itemsPlaceholder: "",
  itemsOverMaxOne: "",
  itemsOverMaxOther: "",
  daysMaxOne: "",
  daysMaxOther: "",
  addDay: "Add day",
};

const FAQ_COPY: FaqEditorCopy = {
  questionLabel: "Question {number}",
  questionPlaceholder: "",
  answerLabel: "Answer",
  answerPlaceholder: "",
  removeFaq: "Remove question {number}",
  addFaq: "Add a question",
  faqsMaxOne: "",
  faqsMaxOther: "",
  empty: "",
};

const CARD = REPEATING_ITEM_CARD_CLASS.split(" ");
const REMOVE = repeatingItemRemoveClass.split(" ");
const ADD = repeatingItemAddClass.split(" ");

/** The card a control sits in, and that card's header row. */
function cardOf(control: HTMLElement) {
  const card = control.closest(`.${CARD.join(".")}`) as HTMLElement | null;
  return { card, header: card?.firstElementChild as HTMLElement | null };
}

/**
 * **The course editor's days and questions are one card** (docs/design/
 * pixel-craft.md, class 12). On one page the days were unfilled with a bordered
 * red "Remove day" at their head and a 48px "Add day", and the questions grey
 * with a borderless red Remove at their foot and a 44px "Add a question".
 */
describe("the course editor's repeating items", () => {
  it("draws a day on the repeating-item card, its title and Remove in the header", () => {
    render(
      <DayByDayEditor
        initialDays={[{ title: "Pool day", items: [] }]}
        storageKey="test-days"
        copy={DAY_COPY}
      />,
    );
    const remove = screen.getByRole("button", { name: "Remove day" });
    const { card, header } = cardOf(remove);
    expect(card).not.toBeNull();
    expect(header?.lastElementChild).toBe(remove);
    expect(within(header as HTMLElement).getByRole("heading", { name: "Day 1" })).toBeTruthy();
    expect(remove).toHaveClass(...REMOVE);
    expect(card).toContainElement(screen.getByRole("textbox", { name: "Day 1 title" }));
    expect(screen.getByRole("button", { name: "Add day" })).toHaveClass(...ADD);
  });

  it("draws a question on the same card, its Remove in the header rather than at its foot", () => {
    render(
      <FaqEditor
        initialFaqs={[{ question: "Is gear included?", answer: "Yes." }]}
        storageKey="test-faqs"
        copy={FAQ_COPY}
      />,
    );
    const remove = screen.getByRole("button", { name: "Remove question 1" });
    const { card, header } = cardOf(remove);
    expect(card).not.toBeNull();
    expect(header?.lastElementChild).toBe(remove);
    expect(remove).toHaveClass(...REMOVE);
    const question = screen.getByRole("textbox", { name: "Question 1" });
    expect(card).toContainElement(question);
    expect(header).not.toContainElement(question);
    // One field gap: `FieldGrid`'s own, as on the day cards.
    expect(card?.querySelector(".gap-y-3")).toBeNull();
    expect(screen.getByRole("button", { name: "Add a question" })).toHaveClass(...ADD);
  });
});
