"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import type { DoctorAnswersState } from "./doctor-core";

/**
 * What the unlock settled: the answers once the diver's date of birth matched,
 * or the whole questionnaire when there was nothing to unlock.
 */
export type RevealedAnswers = Extract<DoctorAnswersState, { status: "open" } | { status: "whole" }>;

type Revealed = {
  answers: RevealedAnswers | null;
  reveal: (answers: RevealedAnswers) => void;
};

const RevealedContext = createContext<Revealed | null>(null);

/**
 * **What the doctor's sheet may print** (issue #2745): the answers the diver
 * unlocked in this tab, and nothing else.
 *
 * The server never renders an answer (security review of layer r5-3, F1), so
 * the sheet cannot be drawn with them either: it is drawn without, and this
 * hands it the unlock's result once `DoctorAnswers` has one. The answers live
 * in this render only, exactly as on screen: a reload, a forwarded link or a
 * second tab prints the sheet that says they are not included.
 */
export function DoctorPaper({ children }: { children: ReactNode }) {
  const [answers, setAnswers] = useState<RevealedAnswers | null>(null);
  return (
    <RevealedContext.Provider value={{ answers, reveal: setAnswers }}>
      {children}
    </RevealedContext.Provider>
  );
}

/** Hands the sheet what the unlock settled; a no-op outside a {@link DoctorPaper}. */
export function useRevealAnswers(): (answers: RevealedAnswers) => void {
  return useContext(RevealedContext)?.reveal ?? noop;
}

function noop() {}

/**
 * **The answers on the doctor's sheet**: the unlocked prompts, in the order
 * the unlock returned them, the whole questionnaire once the unlock settled on
 * it, or else the line saying the answers are not in this printout. No control
 * and no date of birth: the sheet only ever reads.
 */
export function SheetAnswers({
  omitted,
  whole,
  note,
}: {
  omitted: string;
  whole: string;
  note: string;
}) {
  const answers = useContext(RevealedContext)?.answers ?? null;
  if (answers?.status === "whole") {
    return <p className="mt-2 text-sm">{whole}</p>;
  }
  if (!answers) {
    return (
      <p className="mt-2 text-sm text-muted" data-testid="doctor-sheet-answers-omitted">
        {omitted}
      </p>
    );
  }
  return (
    <>
      <ul className="mt-2 flex flex-col gap-2" data-testid="doctor-sheet-answers">
        {answers.items.map((item) => (
          <li key={item.label} className="text-sm">
            <span className="font-semibold">{item.label}</span>
            <span lang="en" className="block">
              {item.prompt}
            </span>
          </li>
        ))}
      </ul>
      {answers.source ? <p className="mt-2 text-xs text-muted">{answers.source}</p> : null}
      <p className="mt-2 text-sm text-muted">{note}</p>
    </>
  );
}
