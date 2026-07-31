"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Copyable } from "@/components/Copyable";
import { ShopNotice } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { calendarFeedAction } from "./actions";
import {
  type CalendarFeedCopy,
  type FeedIssueState,
  type FeedScopeView,
  IDLE_FEED_ISSUE_STATE,
} from "./feed-panel-types";

function ActionButton({
  label,
  pendingLabel,
  variant,
  confirmMessage,
}: {
  label: string;
  pendingLabel: string;
  variant: "primary" | "secondary" | "ghost";
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ variant, size: "sm" })}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * One subscribable scope: its current state, the buttons that change it, and —
 * only in the response that minted it — the link itself.
 *
 * Every word arrives as a prop. Staff copy is translated on the server and
 * never shipped to the client as a message bundle (see
 * `src/i18n/staff-messages.ts`), so a literal here would be both untranslatable
 * and a `pnpm check:copy` failure.
 */
export function CalendarFeedPanel({
  view,
  copy,
  subscribed,
}: {
  view: FeedScopeView;
  copy: CalendarFeedCopy;
  subscribed: boolean;
}) {
  // One state for both buttons. Two `useActionState` hooks could not say which
  // of them ran last, so a revoke followed by a create rendered the revoked
  // state over a live subscription.
  const [state, formAction] = useActionState<FeedIssueState, FormData>(
    calendarFeedAction,
    IDLE_FEED_ISSUE_STATE,
  );

  const mine = state.status === "issued" || state.status === "revoked";
  const scoped = mine && state.scope === view.scope;
  const issued = scoped && state.status === "issued" ? state : null;
  const denied = state.status === "denied";
  // The latest action for *this* scope wins over the server-rendered status,
  // which was computed before it ran.
  const live = scoped ? state.status === "issued" : subscribed;

  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{view.name}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">{view.detail}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <form action={formAction}>
            <input type="hidden" name="intent" value="issue" />
            <input type="hidden" name="scope" value={view.scope} />
            <input type="hidden" name="rotating" value={live ? "true" : "false"} />
            <ActionButton
              label={live ? copy.rotate : copy.create}
              pendingLabel={live ? copy.rotating : copy.creating}
              variant={live ? "secondary" : "primary"}
              confirmMessage={live ? copy.confirmRotate : undefined}
            />
          </form>
          {live ? (
            <form action={formAction}>
              <input type="hidden" name="intent" value="revoke" />
              <input type="hidden" name="scope" value={view.scope} />
              <ActionButton
                label={copy.turnOff}
                pendingLabel={copy.turningOff}
                variant="ghost"
                confirmMessage={copy.confirmTurnOff}
              />
            </form>
          ) : null}
        </div>
      </div>

      {/* Suppressed while the freshly-minted link is on screen: `view` was
          rendered before the action ran, so it would read "not subscribed yet"
          directly above the subscription it just created. */}
      {issued ? null : (
        <>
          <p className="mt-4 text-sm text-muted">
            {live ? (view.subscribedLabel ?? copy.statusNone) : copy.statusNone}
          </p>
          {live ? (
            <p className="mt-1 text-sm text-muted">{view.lastReadLabel ?? copy.neverRead}</p>
          ) : null}
        </>
      )}

      {denied ? (
        <ShopNotice tone="danger" role="alert" className="mt-4">
          {copy.denied}
        </ShopNotice>
      ) : null}

      {issued ? (
        <div className="mt-5 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold text-foreground">{copy.newLinkHeading}</h3>
          <p className="mt-1 text-sm text-foreground">{copy.shownOnce}</p>
          <div className="mt-3 grid gap-2">
            <Copyable
              label={copy.webcalLabel}
              hint={copy.webcalHint}
              value={issued.webcalUrl}
              copyLabel={copy.copy}
              copiedLabel={copy.copied}
              failedLabel={copy.copyFailed}
            />
            <Copyable
              label={copy.httpsLabel}
              hint={copy.httpsHint}
              value={issued.httpsUrl}
              copyLabel={copy.copy}
              copiedLabel={copy.copied}
              failedLabel={copy.copyFailed}
            />
          </div>
          <p className="mt-3 text-xs text-muted">{copy.sharedWarning}</p>
          {issued.rotated ? <p className="mt-1 text-xs text-muted">{copy.rotateWarning}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
