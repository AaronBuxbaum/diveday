"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

export type MedicalAlertResult = { ok: true; text: string } | { ok: false };

export type MedicalAlertRevealCopy = {
  show: string;
  showing: string;
  /** Says the tap is recorded before anyone makes it. */
  showHint: string;
  failed: string;
};

/**
 * **A diver's medical alert for the crew, read on purpose** (glossary
 * *Medical alert for the crew*, issue #2960). At rest it shows nothing of
 * what the alert says. A reader allowed the words gets "Show the alert",
 * whose action writes the read to the diver's trail and only then sends them
 * back (`showSeatMedicalAlertAction` on the manifest,
 * `showMedicalAlertOnRecordAction` on the signed record). Anyone else reads
 * `unreadable`: that one exists and who can read it. Nothing behind the tap is
 * in the page's render, so hiding the button is not the gate; the action is.
 */
export function MedicalAlertReveal({
  show,
  unreadable,
  copy,
}: {
  /** The bound action, for a reader allowed the words here. */
  show?: () => Promise<MedicalAlertResult>;
  /** Said instead of a button to a reader who may not read it. */
  unreadable: string;
  copy: MedicalAlertRevealCopy;
}) {
  const [result, reveal] = useActionState<MedicalAlertResult | null>(
    async () => (show ? show() : { ok: false }),
    null,
  );
  if (result?.ok) {
    // The diver's own words, line breaks kept: "Bee-sting allergy.\nEpiPen in
    // the blue dry bag."
    return <p className="text-base whitespace-pre-wrap [overflow-wrap:anywhere]">{result.text}</p>;
  }
  if (!show) return <p className="text-sm text-muted">{unreadable}</p>;
  return (
    <form action={reveal} className="flex flex-col items-start gap-1 print:hidden">
      <SubmitButton
        pendingLabel={copy.showing}
        className={buttonClass({ variant: "secondary", size: "sm", busy: true })}
      >
        {copy.show}
      </SubmitButton>
      <p className="text-xs text-muted">{copy.showHint}</p>
      {result && !result.ok ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {copy.failed}
        </p>
      ) : null}
    </form>
  );
}
