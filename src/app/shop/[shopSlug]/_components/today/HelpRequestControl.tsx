"use client";

import { createContext, useActionState, useContext, useState } from "react";
import { type HelpRequestActionResult, helpRequestAction } from "@/app/shop/[shopSlug]/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";

export type HelpRequestCopy = {
  complete: string;
  confirm: string;
  cancel: string;
  selector: string;
  speakFirst: string;
  saving: string;
  assigned: string;
  completed: string;
  undone: string;
  reopened: string;
  stale: string;
  invalidHelper: string;
  failed: string;
  undoRefused: string;
  undo: string;
  undoPending: string;
  dismiss: string;
};

type HelpRequestContextValue = {
  result: HelpRequestActionResult | null;
  run: (formData: FormData) => void;
  copy: HelpRequestCopy;
};

const HelpRequestContext = createContext<HelpRequestContextValue | null>(null);

/** Keep outcomes above the active list so completion can leave it and still offer Undo. */
export function HelpRequestProvider({
  children,
  copy,
}: {
  children: React.ReactNode;
  copy: HelpRequestCopy;
}) {
  const [result, run] = useActionState(helpRequestAction, null);
  const completed = result?.ok && result.effect === "completed" ? result : null;
  // A handled request has no row on Today, so a refused undo is said here,
  // where its toast was. Without it the desk would think the request was back.
  const refusedUndo =
    result && !result.ok && result.intent === "undo"
      ? result.reason === "stale"
        ? copy.undoRefused
        : copy.failed
      : null;
  return (
    <HelpRequestContext.Provider value={{ result, run, copy }}>
      {refusedUndo ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {refusedUndo}
        </p>
      ) : null}
      {completed ? (
        <UndoToast
          message={copy.completed}
          action={run}
          fields={{
            requestId: completed.requestId,
            helperPersonId: completed.helperPersonId,
            intent: "undo",
            expectedRevision: String(completed.revision),
          }}
          pendingLabel={copy.undoPending}
          undoLabel={copy.undo}
          dismissLabel={copy.dismiss}
        />
      ) : null}
      {children}
    </HelpRequestContext.Provider>
  );
}

function useHelpRequest() {
  const value = useContext(HelpRequestContext);
  if (!value) throw new Error("Help request control rendered outside its provider");
  return value;
}

export function HelpRequestControl({
  requestId,
  revision,
  status,
  helperPersonId,
  helperPersonName,
  label,
  crew,
  meetingLine,
}: {
  requestId: string;
  revision: number;
  status: "requested" | "acknowledged";
  helperPersonId: string | null;
  helperPersonName: string | null;
  /** The row's own action label (`helpRequestActionText`): Arrange help, or Change helper. */
  label: string;
  crew: readonly { personId: string; fullName: string }[];
  /** Where the departure meets, already a whole bundle sentence. */
  meetingLine: string | null;
}) {
  const { result, run, copy } = useHelpRequest();
  const [open, setOpen] = useState(false);
  const assigned = Boolean(helperPersonId && helperPersonName);
  // The picker starts on the saved helper only while they are still on the
  // crew list. A helper who left would otherwise fall through to whoever is
  // listed first, and Confirm would promise the diver the wrong person.
  const preselected =
    assigned && crew.some((member) => member.personId === helperPersonId)
      ? (helperPersonId ?? "")
      : "";
  const ownResult = result?.requestId === requestId ? result : null;
  const success = ownResult?.ok
    ? ownResult.effect === "assigned"
      ? copy.assigned
      : ownResult.effect === "undone"
        ? copy.undone
        : ownResult.effect === "reopened"
          ? copy.reopened
          : null
    : null;
  // A refused undo is the provider's to say (`HelpRequestProvider`).
  const error =
    ownResult && !ownResult.ok && ownResult.intent !== "undo"
      ? ownResult.reason === "helper"
        ? copy.invalidHelper
        : ownResult.reason === "stale"
          ? copy.stale
          : copy.failed
      : null;

  return (
    <div className="flex flex-col items-start gap-2">
      {status === "acknowledged" && assigned ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
          >
            {open ? copy.cancel : label}
          </button>
          <form action={run}>
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="expectedRevision" value={revision} />
            <input type="hidden" name="helperPersonId" value={helperPersonId ?? ""} />
            <input type="hidden" name="intent" value="complete" />
            <SubmitButton
              pendingLabel={copy.saving}
              className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
            >
              {copy.complete}
            </SubmitButton>
          </form>
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
        >
          {open ? copy.cancel : label}
        </button>
      )}
      {open ? (
        <form
          action={run}
          className="w-full min-w-56 space-y-2 rounded-control border border-border-subtle bg-surface-sunken p-3 sm:w-64"
        >
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="expectedRevision" value={revision} />
          <input type="hidden" name="expectedStatus" value={status} />
          <input type="hidden" name="intent" value="assign" />
          <label className="block text-sm font-medium">
            <span className="mb-1 block">{copy.selector}</span>
            <select
              name="helperPersonId"
              required
              defaultValue={preselected}
              className={controlClass}
            >
              <option value="" disabled>
                {copy.selector}
              </option>
              {crew.map((member) => (
                <option key={member.personId} value={member.personId}>
                  {member.fullName}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted">{copy.speakFirst}</p>
          {meetingLine ? <p className="text-sm text-muted">{meetingLine}</p> : null}
          <div className="flex flex-wrap gap-2">
            <SubmitButton
              pendingLabel={copy.saving}
              disabled={crew.length === 0}
              className={buttonClass({ variant: "primary", size: "sm" })}
            >
              {copy.confirm}
            </SubmitButton>
          </div>
        </form>
      ) : null}
      {success ? (
        <p role="status" className="text-sm font-medium text-success-strong">
          {success}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type HandledHelpRow = {
  requestId: string;
  revision: number;
  helperPersonId: string;
  /** The whole sentence about the request, already in words. */
  line: string;
  reopenLabel: string;
  reopenAriaLabel: string;
};

/**
 * Handled requests stay reachable after the undo toast is gone. Each Reopen runs the same
 * `undo` transition the toast does, with the same guards: a stale revision or a changed helper
 * comes back as the provider's own refusal line.
 */
export function HandledHelpRequests({
  summary,
  rows,
}: {
  summary: string;
  rows: readonly HandledHelpRow[];
}) {
  const { run, copy } = useHelpRequest();
  if (rows.length === 0) return null;
  return (
    <details className="rounded-control border border-border-subtle bg-surface-sunken px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">{summary}</summary>
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.requestId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted">{row.line}</span>
            <form action={run}>
              <input type="hidden" name="requestId" value={row.requestId} />
              <input type="hidden" name="expectedRevision" value={row.revision} />
              <input type="hidden" name="helperPersonId" value={row.helperPersonId} />
              <input type="hidden" name="intent" value="undo" />
              <SubmitButton
                pendingLabel={copy.saving}
                ariaLabel={row.reopenAriaLabel}
                className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
              >
                {row.reopenLabel}
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}
