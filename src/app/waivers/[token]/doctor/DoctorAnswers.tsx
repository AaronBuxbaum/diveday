"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import { type DoctorAnswersState, revealDoctorAnswersAction } from "./actions";

const LOCKED: DoctorAnswersState = { status: "locked" };

export type DoctorAnswersCopy = {
  prompt: string;
  birthdate: string;
  submit: string;
  submitting: string;
  mismatch: string;
  rate: string;
  closed: string;
  note: string;
};

/**
 * **The doctor's page's answers, behind the diver's date of birth** (security
 * review of layer r5-3, F1). The page itself prints neither the date nor the
 * answers; the action hands back the published prompts once the date matches,
 * and they live only in this render, so a reload, a forwarded link or a
 * printed footer shows the locked form again. Printing after unlocking prints
 * them, which is the point.
 */
export function DoctorAnswers({ token, copy }: { token: string; copy: DoctorAnswersCopy }) {
  const [state, formAction] = useActionState(revealDoctorAnswersAction.bind(null, token), LOCKED);

  if (state.status === "open") {
    return (
      <>
        <ul className="mt-3 flex flex-col gap-3" data-testid="doctor-referral-items">
          {state.items.map((item) => (
            <li key={item.label} className="text-base text-foreground">
              <span className="font-semibold">{item.label}</span>
              <span lang="en" className="mt-0.5 block">
                {item.prompt}
              </span>
            </li>
          ))}
        </ul>
        {state.source ? <p className="mt-3 text-sm text-muted">{state.source}</p> : null}
        <p className="mt-3 text-base text-muted">{copy.note}</p>
      </>
    );
  }

  const refusal =
    state.status === "mismatch"
      ? copy.mismatch
      : state.status === "rate"
        ? copy.rate
        : state.status === "closed"
          ? copy.closed
          : undefined;

  return (
    <>
      <p className="mt-3 text-base text-muted">{copy.prompt}</p>
      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
        <Field label={copy.birthdate} error={refusal} className="min-w-56">
          <input
            name="birthdate"
            type="date"
            required
            autoComplete="bday"
            className={controlClass}
          />
        </Field>
        <SubmitButton
          pendingLabel={copy.submitting}
          className={buttonClass({ variant: "secondary" })}
        >
          {copy.submit}
        </SubmitButton>
      </form>
    </>
  );
}
