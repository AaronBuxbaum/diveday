"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Toast } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";
import { fillField } from "./AssistDraftButton";

/** What the one conversation assist did (`assistConversationAction`). */
export type ConversationAssistAnswer =
  | { kind: "reply"; text: string }
  | { kind: "request"; href: string; text: string | null }
  | {
      kind: "none";
      reason: "unavailable" | "declined" | "nothing-to-answer" | "draft-exists";
    };

/**
 * **The one AI button beside the reply box.** A tap lets the server read the
 * diver's latest message: a reply lands in the box for staff to edit. A
 * booking ask also fills the Took-a-call form, and a follow-up link to it
 * appears beside the button; the page never moves on its own. When nothing
 * usable comes back, a toast says why, and it leaves by itself.
 */
export function AssistConversationButton({
  run,
  fieldId,
  label,
  pendingLabel,
  followUpLabel,
  failures,
}: {
  run: () => Promise<ConversationAssistAnswer>;
  fieldId: string;
  label: string;
  pendingLabel: string;
  /** The link that opens the booking request the message asked for. */
  followUpLabel: string;
  /** What each empty answer says, in the reader's words. */
  failures: Record<Extract<ConversationAssistAnswer, { kind: "none" }>["reason"], string>;
}) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<{ text: string; n: number } | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);

  function tap() {
    setFailure(null);
    setFollowUp(null);
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
        if (answer.text?.trim()) fillField(fieldId, answer.text);
        setFollowUp(answer.href);
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
      {followUp ? (
        <Link href={followUp} className={buttonClass({ variant: "secondary", size: "sm" })}>
          {followUpLabel}
        </Link>
      ) : null}
      {failure ? (
        <Toast message={failure.text} occurrenceKey={failure.n} durationMs={6000} pausable />
      ) : null}
    </>
  );
}
