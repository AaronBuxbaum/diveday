"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Toast } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";
import { fillField } from "./AssistDraftButton";

/** What the one conversation assist did (`assistConversationAction`). */
export type ConversationAssistAnswer =
  | { kind: "reply"; text: string }
  | { kind: "request"; href: string }
  | {
      kind: "none";
      reason: "unavailable" | "declined" | "nothing-to-answer" | "draft-exists";
    };

/**
 * **The one AI button beside the reply box.** A tap lets the server read the
 * diver's latest message: a reply lands in the box for staff to edit, a
 * booking ask opens the Took-a-call form filled in. When nothing usable comes
 * back, a toast says why, and it leaves by itself: the button is the only
 * thing that stays on the page.
 */
export function AssistConversationButton({
  run,
  fieldId,
  label,
  pendingLabel,
  failures,
}: {
  run: () => Promise<ConversationAssistAnswer>;
  fieldId: string;
  label: string;
  pendingLabel: string;
  /** What each empty answer says, in the reader's words. */
  failures: Record<Extract<ConversationAssistAnswer, { kind: "none" }>["reason"], string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<{ text: string; n: number } | null>(null);

  function tap() {
    setFailure(null);
    startTransition(async () => {
      let answer: ConversationAssistAnswer = { kind: "none", reason: "unavailable" };
      try {
        answer = await run();
      } catch {
        // A server action that threw is the same as an assist that is away.
      }
      if (answer.kind === "reply" && answer.text.trim()) {
        fillField(fieldId, answer.text);
      } else if (answer.kind === "request") {
        router.push(answer.href);
      } else {
        const reason = answer.kind === "none" ? answer.reason : "declined";
        setFailure((previous) => ({ text: failures[reason], n: (previous?.n ?? 0) + 1 }));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={tap}
        disabled={pending}
        aria-busy={pending || undefined}
        className={buttonClass({ variant: "ghost", size: "sm", busy: pending })}
      >
        {pending ? pendingLabel : label}
      </button>
      {failure ? (
        <Toast message={failure.text} occurrenceKey={failure.n} durationMs={6000} pausable />
      ) : null}
    </>
  );
}
