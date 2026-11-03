"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Copyable } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { ShopNotice } from "@/components/ui/outcome";
import { useStaffTranslations } from "@/i18n/use-staff-translations";
import { calendarFeedAction } from "./actions";
import { type FeedIssueState, type FeedScopeView, IDLE_FEED_ISSUE_STATE } from "./feed-panel-types";

function ActionButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant: "primary" | "secondary" | "link" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass(
        variant === "link" ? { variant, flush: true } : { variant, size: "sm" },
      )}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * One subscribable scope: its current state, the buttons that change it, and —
 * only in the response that minted it — the link itself.
 *
 * Words come from `useStaffTranslations("calendar")`; the page mounts a
 * `StaffIntlProvider` carrying it and the shared `words` bundle. A literal here would be both
 * untranslatable and a `pnpm check:copy` failure.
 */
export function CalendarFeedPanel({
  view,
  subscribed,
  createVariant = "primary",
}: {
  view: FeedScopeView;
  subscribed: boolean;
  /**
   * Two panels share this screen (visual review 2026-10-24, A37). Until the
   * person holds a stored feed, both creates are one secondary weight: two
   * equal choices, neither the page's one primary nor one a stray link. Once
   * a feed exists, the personal feed's create is the button and the
   * shop-wide one a text link.
   */
  createVariant?: "primary" | "secondary" | "link";
}) {
  const t = useStaffTranslations("calendar");
  const w = useStaffTranslations("words");
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
    <section className="border-b border-border py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{view.name}</h2>
          <p className="mt-1 text-sm text-muted">{view.detail}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={formAction}>
            <input type="hidden" name="intent" value="issue" />
            <input type="hidden" name="scope" value={view.scope} />
            <input type="hidden" name="rotating" value={live ? "true" : "false"} />
            {live ? (
              <InlineConfirm
                triggerLabel={t("actions.rotate")}
                triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
                message={t("actions.confirmRotate")}
                confirmLabel={t("actions.confirmRotateButton")}
                cancelLabel={w("dismiss.neverMind")}
                pendingLabel={t("actions.rotating")}
              />
            ) : (
              <ActionButton
                label={t("actions.create")}
                pendingLabel={t("actions.creating")}
                variant={createVariant}
              />
            )}
          </form>
          {live ? (
            <form action={formAction}>
              <input type="hidden" name="intent" value="revoke" />
              <input type="hidden" name="scope" value={view.scope} />
              <InlineConfirm
                triggerLabel={t("actions.turnOff")}
                triggerClassName={buttonClass({ variant: "ghost", size: "sm" })}
                message={t("actions.confirmTurnOff")}
                confirmLabel={t("actions.confirmTurnOffButton")}
                cancelLabel={w("dismiss.neverMind")}
                pendingLabel={t("actions.turningOff")}
              />
            </form>
          ) : null}
        </div>
      </div>
      {/* Suppressed while the freshly-minted link is on screen: `view` was
          rendered before the action ran, so it would read "not subscribed yet"
          directly above the subscription it just created. */}
      {live && !issued ? (
        <div className="mt-3 text-sm text-muted">
          <p>{view.subscribedLabel}</p>
          <p className="mt-1">{view.lastReadLabel ?? t("status.neverRead")}</p>
        </div>
      ) : null}

      {denied ? (
        <ShopNotice tone="danger" role="alert" className="mt-4">
          {t("notice.denied")}
        </ShopNotice>
      ) : null}

      {issued ? (
        <div className="mt-4 rounded-inset border border-primary/25 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold text-foreground">{t("newLink.heading")}</h3>
          <p className="mt-1 text-sm text-foreground">{t("newLink.shownOnce")}</p>
          <div className="mt-3 grid gap-2">
            <Copyable
              label={t("newLink.webcalLabel")}
              hint={t("newLink.webcalHint")}
              value={issued.webcalUrl}
              copyLabel={t("actions.copy")}
              copiedLabel={w("did.copied")}
              failedLabel={t("actions.copyFailed")}
            />
            <Copyable
              label={t("newLink.httpsLabel")}
              hint={t("newLink.httpsHint")}
              value={issued.httpsUrl}
              copyLabel={t("actions.copy")}
              copiedLabel={w("did.copied")}
              failedLabel={t("actions.copyFailed")}
            />
          </div>
          <p className="mt-3 text-xs text-muted">{t("warning.shared")}</p>
          {issued.rotated ? <p className="mt-1 text-xs text-muted">{t("warning.rotate")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
