"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { releaseHeldSendAction, undoHeldSendAction } from "@/app/actions/held-sends";
import { SendHold, type SendHoldCopy } from "@/components/SendHold";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, FormStatus, textareaClassFor } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { DEPARTURE_NOTE_MAX, departureNoteProblem, foldDepartureNote } from "@/lib/departure-notes";
import type { HoldDepartureNoteResult } from "../departure-note-actions";

export type DepartureNoteRefusalCopy = {
  empty: string;
  too_long: string;
  link: string;
  cancelled: string;
  past: string;
  limit: string;
  no_recipients: string;
  other: string;
};

export type DepartureNoteFormCopy = {
  label: string;
  /** A template: `{left}` characters left. */
  left: string;
  submit: string;
  /** A template: `{delivered}` of `{recipients}`. */
  sent: string;
  refusals: DepartureNoteRefusalCopy;
  sendHold: SendHoldCopy;
};

/** Carries a refused hold's reason from the action's result to `onHoldError`. */
class HoldRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function refusalText(copy: DepartureNoteFormCopy, reason: string): string {
  return Object.hasOwn(copy.refusals, reason)
    ? copy.refusals[reason as keyof DepartureNoteRefusalCopy]
    : copy.refusals.other;
}

/**
 * The box and the button behind "Note to everyone" (batch 4, J4): a held send
 * like every other message a staffer can take back, so the tap shows
 * "Sending…" with Undo for eight seconds before anything leaves. The rules
 * the server enforces are checked here too, as the staffer types, so a link
 * or a long note is caught before the tap rather than after it.
 */
export function DepartureNoteForm({
  hold,
  copy,
}: {
  hold: (formData: FormData) => Promise<HoldDepartureNoteResult>;
  copy: DepartureNoteFormCopy;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const problem = body.trim() === "" ? null : departureNoteProblem(body);
  const left = DEPARTURE_NOTE_MAX - foldDepartureNote(body).length;

  return (
    <SendHold
      hold={async (formData) => {
        setStatus(null);
        const result = await hold(formData);
        if (!result.ok) throw new HoldRefused(result.reason);
        return result.ticket;
      }}
      onHoldError={(error) =>
        setStatus({
          tone: "danger",
          text: refusalText(copy, error instanceof HoldRefused ? error.reason : "other"),
        })
      }
      undo={undoHeldSendAction}
      release={releaseHeldSendAction}
      onOutcome={(outcome) => {
        if (outcome.kind !== "departure_note") return;
        if (outcome.outcome.ok) {
          setBody("");
          setStatus({
            tone: "success",
            text: fill(copy.sent, {
              delivered: outcome.outcome.delivered,
              recipients: outcome.outcome.recipients,
            }),
          });
        } else {
          setStatus({ tone: "danger", text: refusalText(copy, outcome.outcome.reason) });
        }
        router.refresh();
      }}
      copy={copy.sendHold}
      className="space-y-3"
    >
      <Field
        label={copy.label}
        aside={<span className="text-xs text-muted tabular-nums">{fill(copy.left, { left })}</span>}
      >
        <textarea
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={DEPARTURE_NOTE_MAX * 2}
          required
          aria-invalid={problem ? true : undefined}
          className={textareaClassFor(2)}
          data-testid="departure-note-body"
        />
      </Field>
      <FieldActions>
        <button
          type="submit"
          disabled={problem !== null}
          className={buttonClass({ variant: "secondary" })}
        >
          {copy.submit}
        </button>
        {problem ? (
          <FormStatus tone="danger">{refusalText(copy, problem)}</FormStatus>
        ) : status ? (
          <FormStatus tone={status.tone}>{status.text}</FormStatus>
        ) : null}
      </FieldActions>
    </SendHold>
  );
}
