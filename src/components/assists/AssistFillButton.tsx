"use client";

import { useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { fillFormFields, formTextValues } from "./fill-form";

/**
 * **A Draft button that fills several boxes** (ADR 20261018-claude-assists):
 * the shared quiet pattern of `AssistDraftButton`, for an assist whose answer
 * is more than one field (a description and its Spanish, a briefing and its
 * marine-life paragraph, a set of rental sizes). It sits inside the form it
 * fills; a tap sends the form's current text (never a file) to the server
 * action, and the answer lands in the boxes for the staffer to read and save.
 * Nothing is saved here. An answer that came back empty fills nothing, and
 * `emptyLabel` says so beside the button.
 */
export function AssistFillButton({
  draft,
  label,
  pendingLabel,
  emptyLabel,
  className,
}: {
  /** The server action: the form's text in, field values out, or null. */
  draft: (form: Record<string, string>) => Promise<Record<string, string> | null>;
  label: string;
  pendingLabel: string;
  /** Said beside the button when the answer came back empty. */
  emptyLabel?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [empty, setEmpty] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  function run() {
    const form = ref.current?.form ?? null;
    setEmpty(false);
    startTransition(async () => {
      let values: Record<string, string> | null = null;
      try {
        values = await draft(formTextValues(form));
      } catch {
        // A failed action is an empty answer: the boxes stay as they were.
      }
      if (!values || Object.keys(values).length === 0) {
        setEmpty(true);
        return;
      }
      fillFormFields(form, values);
    });
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={run}
        disabled={pending}
        aria-busy={pending || undefined}
        className={buttonClass({ variant: "ghost", size: "sm", busy: pending, className })}
      >
        {pending ? pendingLabel : label}
      </button>
      <FormStatus tone="neutral">{empty && emptyLabel ? emptyLabel : null}</FormStatus>
    </>
  );
}
