import Link from "next/link";
import { type WaiverSendCopy, waiverSendCopy } from "@/app/actions/waiver-send-types";
import {
  WaitlistInvite,
  type WaitlistInviteCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/WaitlistInvite";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { seasonalBriefingText, URGENCY_KEYS } from "@/i18n/today-labels";
import { nowDate } from "@/lib/clock";
import { getSeasonalBriefing, groupActions, type TodayAction } from "@/lib/today";
import { KindChip } from "./KindChip";
import { PaymentActionControl, type PaymentActionCopy } from "./PaymentActionControl";
import {
  ResendConfirmationControl,
  type ResendConfirmationCopy,
} from "./ResendConfirmationControl";
import { WaiverSendControl } from "./WaiverSendControl";

/** Binds shopSlug + tripId server-side; the client control supplies the entry. */
export type TodayInviteAction = (tripId: string, entryId: string) => Promise<"sent" | "fallback">;

function ActionRow({
  action,
  shopSlug,
  shopName,
  inviteAction,
  waiverCopy,
  resendCopy,
  inviteCopy,
  paymentCopy,
  t,
}: {
  action: TodayAction;
  shopSlug: string;
  shopName: string;
  inviteAction: TodayInviteAction;
  waiverCopy: WaiverSendCopy;
  resendCopy: ResendConfirmationCopy;
  inviteCopy: WaitlistInviteCopy;
  paymentCopy: PaymentActionCopy;
  t: StaffTranslator;
}) {
  return (
    <li className="card-scale-hint rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors duration-200 hover:border-primary/40 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <KindChip kind={action.kind} t={t} />
            <p className="font-semibold">{action.subject}</p>
            {action.context ? <p className="text-sm text-muted">{action.context}</p> : null}
          </div>
          <p className="mt-1.5 text-muted">{action.detail}</p>
        </div>
        {action.waiver ? (
          <WaiverSendControl
            shopSlug={shopSlug}
            surface="today"
            bookingIds={action.waiver.bookingIds}
            label={action.actionLabel}
            copy={waiverCopy}
          />
        ) : action.resend ? (
          <ResendConfirmationControl
            shopSlug={shopSlug}
            bookingId={action.resend.bookingId}
            label={action.actionLabel}
            copy={resendCopy}
          />
        ) : action.invite ? (
          <WaitlistInvite
            entryId={action.invite.entryId}
            personName={action.invite.personName}
            personEmail={action.invite.personEmail}
            invitedAt={action.invite.invitedAt}
            bookingPath={action.invite.bookingPath}
            shopName={shopName}
            tripTitle={action.invite.tripTitle}
            tripWhen={action.invite.tripWhen}
            invite={inviteAction.bind(null, action.invite.tripId)}
            copy={inviteCopy}
          />
        ) : action.payment?.orderId ? (
          <PaymentActionControl
            shopSlug={shopSlug}
            orderId={action.payment.orderId}
            hostedInvoiceUrl={action.payment.hostedInvoiceUrl ?? null}
            copy={paymentCopy}
          />
        ) : (
          <Link
            href={action.href}
            className={buttonClass({ variant: "secondary", className: "shrink-0" })}
          >
            {action.actionLabel}
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * The queue. Grouped by how soon the work has to land, chronological inside
 * each group, one row per person or per boat — never one row per blocker, or a
 * single diver with three problems would bury everyone else.
 */
export function TodayQueue({
  actions,
  shopSlug,
  shopName,
  timezone,
  inviteAction,
  locale,
}: {
  actions: readonly TodayAction[];
  shopSlug: string;
  shopName: string;
  /** The shop's IANA timezone — the seasonal briefing reads the shop's month, not the server's. */
  timezone: string;
  inviteAction: TodayInviteAction;
  locale: string;
}) {
  const groups = groupActions(actions);
  const t = staffTranslator(locale);
  const waiverCopy = waiverSendCopy(t);
  const resendCopy: ResendConfirmationCopy = {
    resending: t("shared.today.resendConfirmation.resending"),
    confirmationResent: t("shared.today.resendConfirmation.confirmationResent"),
    errors: {
      invalid: t("shared.today.resendConfirmation.errors.invalid"),
      noEmail: t("shared.today.resendConfirmation.errors.noEmail"),
      notConfigured: t("shared.today.resendConfirmation.errors.notConfigured"),
      failed: t("shared.today.resendConfirmation.errors.failed"),
    },
  };
  // Same keys `WaitlistSection.tsx` (the trips batch's own call site) uses —
  // `WaitlistInvite` is a Client Component, so this composes the full copy
  // object server-side rather than passing a translator across the boundary.
  const inviteCopy: WaitlistInviteCopy = {
    invitedRelative: t("trips.waitlist.invitedRelative"),
    inviteEmailed: t("trips.waitlist.inviteEmailed"),
    reSendInvite: t("trips.waitlist.reSendInvite"),
    emailAnInvite: t("trips.waitlist.emailAnInvite"),
    copied: t("trips.waitlist.copied"),
    copyInviteMessage: t("trips.waitlist.copyInviteMessage"),
    copyFailed: t("trips.waitlist.copyFailed"),
    justNow: t("trips.waitlist.justNow"),
    minutesAgo: t("trips.waitlist.minutesAgo"),
    hoursAgo: t("trips.waitlist.hoursAgo"),
    daysAgo: t("trips.waitlist.daysAgo"),
    emailSubject: t("trips.waitlist.emailSubject"),
    emailBody: t("trips.waitlist.emailBody"),
  };
  const paymentCopy: PaymentActionCopy = {
    copyLink: t("shared.today.paymentAction.copyLink"),
    linkCopied: t("shared.today.paymentAction.linkCopied"),
    copyFailed: t("shared.today.paymentAction.copyFailed"),
    resendInvoice: t("shared.today.paymentAction.resendInvoice"),
    resending: t("shared.today.paymentAction.resending"),
    invoiceResent: t("shared.today.paymentAction.invoiceResent"),
    errors: {
      notFound: t("shared.today.paymentAction.errors.notFound"),
      notOpen: t("shared.today.paymentAction.errors.notOpen"),
      notConfigured: t("shared.today.paymentAction.errors.notConfigured"),
      failed: t("shared.today.paymentAction.errors.failed"),
    },
  };

  if (groups.length === 0) {
    return (
      <section aria-labelledby="queue-heading">
        <EmptyState>
          <h2 id="queue-heading" className="font-medium">
            {t("shared.today.todayQueue.emptyHeading")}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {t("shared.today.todayQueue.emptyBody")}{" "}
            {seasonalBriefingText(t, getSeasonalBriefing(nowDate(), timezone), shopName)}
          </p>
          {/* The by-departure view's empty state offers exactly this link, and
              the two views are meant to rest alike (BlockerGroups). */}
          <Link
            href={`/shop/${shopSlug}/schedule/board`}
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
          >
            {t("shared.today.todayQueue.emptyAction")}
          </Link>
        </EmptyState>
      </section>
    );
  }

  // The morning's boats — "imminent" (next 3 hours) and "now" ("Before
  // today's boats") — are the two urgency bands a diver could still be
  // standing at the dock for. Once neither has any work left but a later
  // group still does, that's a real earned moment: the last blocker of the
  // morning just cleared, not the whole queue (the 🤙 empty state above
  // already covers that case).
  const todaysBoatsClear = !groups.some(
    (group) => group.urgency === "imminent" || group.urgency === "now",
  );

  return (
    <section aria-labelledby="queue-heading">
      <h2 id="queue-heading" className="text-lg font-semibold">
        {t("shared.today.todayQueue.needsYouHeading")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("shared.today.todayQueue.needsYouSubtitle")}</p>
      {todaysBoatsClear ? (
        <p
          role="status"
          className="rise-in mt-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-semibold"
        >
          {t("shared.today.todayQueue.boatsClear")}
        </p>
      ) : null}
      <div className="mt-5 flex flex-col gap-8">
        {groups.map((group, index) => {
          const header = (
            <div className="flex w-full items-baseline justify-between gap-3">
              <h3 className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                {t(URGENCY_KEYS[group.urgency])}
              </h3>
              <span className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted tabular-nums">
                {t("shared.today.todayQueue.itemsCount", { count: group.actions.length })}
              </span>
            </div>
          );
          const rows = (
            <ul className="mt-3 flex flex-col gap-3">
              {group.actions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  shopSlug={shopSlug}
                  shopName={shopName}
                  inviteAction={inviteAction}
                  waiverCopy={waiverCopy}
                  resendCopy={resendCopy}
                  inviteCopy={inviteCopy}
                  paymentCopy={paymentCopy}
                  t={t}
                />
              ))}
            </ul>
          );
          // Visual weight follows urgency; horizon folds. Work a boat could
          // still be waiting on ("imminent"/"now") always renders in full,
          // but "Next 3 days" and "This week" arrive folded to their heading
          // and count — the load is stated honestly without 30 same-weight
          // cards pulling attention off this morning's blockers (design
          // principles #3 and #8). The queue's *first* group stays open
          // whatever its horizon: an empty morning must lead with the next
          // real work, not two folded bands and a shrug. Native disclosure,
          // deliberately — no state to manage, keyboard and screen-reader
          // semantics for free, and a full-page render (or JS failure)
          // degrades to the folded summary still being one tap from its rows.
          const folded = index > 0 && (group.urgency === "soon" || group.urgency === "later");
          if (!folded) {
            return (
              <div key={group.urgency}>
                {header}
                {rows}
              </div>
            );
          }
          return (
            <details key={group.urgency} className="group/fold">
              <summary className="-mx-2 flex cursor-pointer list-none items-baseline gap-2 rounded-lg px-2 py-1 transition-colors duration-200 select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken">
                {/* Which way this goes, before you press it — decorative, the
                    native disclosure semantics carry the state. */}
                <span
                  aria-hidden="true"
                  className="inline-block text-xs text-muted transition-transform duration-200 group-open/fold:rotate-90"
                >
                  ▸
                </span>
                {header}
              </summary>
              {rows}
            </details>
          );
        })}
      </div>
    </section>
  );
}
