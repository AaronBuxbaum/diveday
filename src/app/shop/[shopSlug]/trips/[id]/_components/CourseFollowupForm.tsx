"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { CourseFollowupResult } from "@/features/training/course-pulse";

export function CourseFollowupForm({
  action,
  revision,
  intent,
  words,
}: {
  action: (previous: CourseFollowupResult | null, form: FormData) => Promise<CourseFollowupResult>;
  revision: number;
  intent: "claim" | "release";
  words: { label: string; busy: string; ariaLabel: string; changed: string; unavailable: string };
}) {
  const [result, submit] = useActionState(action, null);
  return (
    <form action={submit}>
      <input type="hidden" name="expectedRevision" value={revision} />
      <input type="hidden" name="intent" value={intent} />
      <SubmitButton
        className={buttonClass({ variant: "ghost", size: "sm" })}
        pendingLabel={words.busy}
        ariaLabel={words.ariaLabel}
      >
        {words.label}
      </SubmitButton>
      {result && !result.ok ? <FormStatus tone="danger">{words[result.reason]}</FormStatus> : null}
    </form>
  );
}
