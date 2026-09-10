"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Copyable } from "@/components/Copyable";
import { ShopNotice } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { displayLinkAction } from "./actions";
import {
  type DisplayLinkCopy,
  type DisplayLinkState,
  type DisplayLinkView,
  IDLE_DISPLAY_LINK_STATE,
} from "./display-panel-types";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ variant: "primary", size: "sm" })}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * The lobby-display settings: a form that mints a link for one screen, the
 * link itself shown once in the response that minted it, and the list of
 * screens with a revoke on each.
 *
 * Every word arrives as a prop (see `src/i18n/staff-messages.ts`). One
 * `useActionState` drives the create form and every revoke, so the panel
 * always knows which act ran last.
 */
export function DisplayLinksPanel({
  copy,
  screens,
  maxLabelLength,
}: {
  copy: DisplayLinkCopy;
  screens: DisplayLinkView[];
  maxLabelLength: number;
}) {
  const [state, formAction] = useActionState<DisplayLinkState, FormData>(
    displayLinkAction,
    IDLE_DISPLAY_LINK_STATE,
  );
  const namesId = useId();
  /**
   * **Which surface the form is currently describing.** The names checkbox
   * belongs to a board link and to nothing else: no kiosk read has ever looked
   * at `showNames`, and the Screens list below already renders no names label
   * for a check-in link. Ticking it on a check-in link told a manager they had
   * made a choice they had not made (issue #1611).
   *
   * Null until the radio is answered, so the form still opens with no default:
   * the two grant different things, and a shop mounting a TV should have to say
   * which before it gets one. The radios are controlled from here, so a manager
   * minting a second link keeps the answer they gave rather than an answer
   * nobody chose.
   */
  const [purpose, setPurpose] = useState<"board" | "check_in" | null>(null);
  const issued = state.status === "issued" ? state : null;
  const invalidLabel = state.status === "invalid_label";
  // Split, because the panel has two forms. A refused revoke printed under the
  // create form is a message about something the staffer never submitted.
  const deniedIssue = state.status === "denied" && state.intent === "issue";
  const deniedRevoke = state.status === "denied" && state.intent === "revoke";
  // The server list was rendered before a revoke ran; the revoked row is gone
  // on the next render, and hidden here in the meantime.
  const live = screens.filter((screen) => !(state.status === "revoked" && state.id === screen.id));

  return (
    <div className="space-y-10">
      <SectionCard padding="lg" title={copy.createHeading}>
        <FieldGrid as="form" action={formAction} columns={1}>
          <input type="hidden" name="intent" value="issue" />
          <Field label={copy.labelField} error={invalidLabel ? copy.invalidLabel : null}>
            <input
              type="text"
              name="label"
              required
              maxLength={maxLabelLength}
              placeholder={copy.labelPlaceholder}
              className={controlClass}
            />
          </Field>
          {/* **Which surface this link opens** — a screen the lobby reads, or a
              tablet a diver taps. It is a choice with no default in the markup
              because the two grant different things: the kiosk *writes*, and a
              shop mounting a TV should have to say so before it gets one. The
              action reads it as a closed set, so an unrecognised value can
              never fall through to the more capable surface.

              `Field`'s required marker by hand, because a fieldset is not a
              `Field` — the same shape `MedicalClearanceControl` uses. */}
          <fieldset>
            <legend className="text-sm font-medium">
              {copy.purposeLegend}
              <span aria-hidden="true" className="text-danger">
                {" "}
                *
              </span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm hover:bg-surface">
                <input
                  type="radio"
                  name="purpose"
                  value="board"
                  required
                  checked={purpose === "board"}
                  onChange={() => setPurpose("board")}
                />
                {copy.purposeBoard}
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm hover:bg-surface">
                <input
                  type="radio"
                  name="purpose"
                  value="check_in"
                  required
                  checked={purpose === "check_in"}
                  onChange={() => setPurpose("check_in")}
                />
                {copy.purposeCheckIn}
              </label>
            </div>
            <p className="mt-2 text-sm text-muted">{copy.purposeCheckInDescription}</p>
          </fieldset>
          {purpose === "board" ? (
            <div className="flex items-start gap-3">
              <input
                id={namesId}
                type="checkbox"
                name="showNames"
                value="true"
                className="mt-1 size-5"
                aria-describedby={`${namesId}-description`}
              />
              <div>
                <label htmlFor={namesId} className="font-medium">
                  {copy.showNames}
                </label>
                <p id={`${namesId}-description`} className="text-sm text-muted">
                  {copy.showNamesDescription}
                </p>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton label={copy.submit} pendingLabel={copy.submitting} />
            <FormStatus>{deniedIssue ? copy.denied : null}</FormStatus>
          </div>
        </FieldGrid>

        {issued ? (
          <div className="mt-6 rounded-inset border border-primary/25 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold text-foreground">{copy.newLinkHeading}</h3>
            <p className="mt-1 text-sm text-foreground">{copy.shownOnce}</p>
            <div className="mt-3">
              <Copyable
                label={issued.label}
                value={issued.url}
                copyLabel={copy.copy}
                copiedLabel={copy.copied}
                failedLabel={copy.copyFailed}
              />
            </div>
            <p className="mt-3 text-xs text-muted">
              {issued.purpose === "check_in" ? copy.sharedCheckIn : copy.shared}
            </p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard padding="lg" title={copy.listHeading}>
        {state.status === "revoked" ? (
          <ShopNotice tone="success" role="status" className="mb-4">
            {copy.revoked}
          </ShopNotice>
        ) : null}
        {/* Beside the thing it is about, and `role="alert"` so it is announced —
            the idiom `CalendarFeedPanel` uses for a client-action refusal. */}
        {deniedRevoke ? (
          <ShopNotice tone="danger" role="alert" className="mb-4">
            {copy.denied}
          </ShopNotice>
        ) : null}
        {live.length === 0 ? (
          <p className="text-sm text-muted">{copy.listEmpty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {live.map((screen) => (
              <li
                key={screen.id}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{screen.label}</p>
                  <p className="text-sm text-muted">
                    {[
                      screen.purposeLabel,
                      screen.createdLabel,
                      screen.lastShownLabel ?? copy.neverShown,
                      screen.showNamesLabel,
                    ]
                      .filter((part): part is string => Boolean(part))
                      .join(" · ")}
                  </p>
                </div>
                <form action={formAction}>
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="id" value={screen.id} />
                  <InlineConfirm
                    triggerLabel={copy.revoke}
                    ariaLabel={screen.revokeLabel}
                    triggerClassName={buttonClass({ variant: "ghost", size: "sm" })}
                    message={copy.confirmRevoke}
                    confirmLabel={copy.confirmRevokeButton}
                    cancelLabel={copy.cancel}
                    pendingLabel={copy.revoking}
                  />
                </form>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
