"use client";

import { useRef } from "react";
import { buttonClass } from "@/components/ui/button";
import { fillSavedAnswer } from "@/lib/saved-answers";

export type SavedAnswerChip = { id: string; title: string; body: string };

/**
 * **Saved answers, above the reply box** (fifth loop, item 15). A tap puts the
 * answer in the box, filled for the diver on this record: `{name}` with their
 * first name, `{trip}` with the departure they are booked on next. Words
 * already typed stay, and the answer follows them after a blank line, so a
 * chip never wipes out a sentence.
 *
 * Nothing is sent from here: the box is still the reader's to edit, and Send
 * is still theirs to press.
 */
export function SavedAnswerChips({
  answers,
  fill,
  label,
}: {
  answers: readonly SavedAnswerChip[];
  fill: { name: string | null; trip: string | null };
  label: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  if (answers.length === 0) return null;

  const use = (body: string) => {
    const box = group.current?.closest("form")?.querySelector<HTMLTextAreaElement>(
      'textarea[name="body"]',
    );
    if (!box) return;
    const words = fillSavedAnswer(body, fill);
    const typed = box.value.trimEnd();
    const next = typed ? `${typed}\n\n${words}` : words;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(box, next.slice(0, box.maxLength > 0 ? box.maxLength : undefined));
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  };

  return (
    <div
      ref={group}
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-2"
      data-testid="saved-answer-chips"
    >
      {answers.map((answer) => (
        <button
          key={answer.id}
          type="button"
          onClick={() => use(answer.body)}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {answer.title}
        </button>
      ))}
    </div>
  );
}
