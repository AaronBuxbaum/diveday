import Link from "next/link";
import { type WaiverSendCopy, waiverSendCopy } from "@/app/actions/waiver-send-types";
import {
  WaitlistInvite,
  type WaitlistInviteCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/WaitlistInvite";
import { buttonClass } from "@/components/ui/button";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { ACTION_KIND_KEYS, seasonalBriefingText, URGENCY_KEYS } from "@/i18n/today-labels";
import { nowDate } from "@/lib/clock";
import { ACTION_KIND_META, getSeasonalBriefing, groupActions, type TodayAction } from "@/lib/today";
import {
  ResendConfirmationControl,
  type ResendConfirmationCopy,
} from "./ResendConfirmationControl";
import { WaiverSendControl } from "./WaiverSendControl";

/** Binds shopSlug + tripId server-side; the client control supplies the entry. */
export type TodayInviteAction = (tripId: string, entryId: string) => Promise<"sent" | "fallback">;

const CHIP_TONES = {
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  neutral: "border-border bg-surface-sunken text-muted",
} as const;

function KindChip({ kind, t }: { kind: TodayAction["kind"]; t: StaffTranslator }) {
  const { tone } = ACTION_KIND_META[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase ${CHIP_TONES[tone]}`}
    >
      {t(ACTION_KIND_KEYS[kind])}
    </span>
  );
}

function ActionRow({
  action,
  shopSlug,
  shopName,
  inviteAction,
  waiverCopy,
  resendCopy,
  inviteCopy,
  t,
}: {
  action: TodayAction;
  shopSlug: string;
  shopName: string;
  inviteAction: TodayInviteAction;
  waiverCopy: WaiverSendCopy;
  resendCopy: ResendConfirmationCopy;
  inviteCopy: WaitlistInviteCopy;
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
  inviteAction,
  locale,
}: {
  actions: readonly TodayAction[];
  shopSlug: string;
  shopName: string;
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
    justNow: t("trips.waitlist.justNow"),
    minutesAgo: t("trips.waitlist.minutesAgo"),
    hoursAgo: t("trips.waitlist.hoursAgo"),
    daysAgo: t("trips.waitlist.daysAgo"),
    emailSubject: t("trips.waitlist.emailSubject"),
    emailBody: t("trips.waitlist.emailBody"),
  };

  if (groups.length === 0) {
    return (
      <section
        aria-labelledby="queue-heading"
        className="rounded-3xl border border-accent/30 bg-accent/5 p-8 text-center sm:p-10"
      >
        <div
          className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/15 text-2xl"
          aria-hidden="true"
        >
          🤙
        </div>
        <h2 id="queue-heading" className="mt-4 text-lg font-semibold">
          {t("shared.today.todayQueue.emptyHeading")}
        </h2>
        <p className="mx-auto mt-1 max-w-md text-muted">
          {t("shared.today.todayQueue.emptyBody")}{" "}
          {seasonalBriefingText(t, getSeasonalBriefing(nowDate()), shopName)}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="queue-heading">
      <h2 id="queue-heading" className="text-lg font-semibold">
        {t("shared.today.todayQueue.needsYouHeading")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("shared.today.todayQueue.needsYouSubtitle")}</p>
      <div className="mt-5 flex flex-col gap-8">
        {groups.map((group) => (
          <div key={group.urgency}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                {t(URGENCY_KEYS[group.urgency])}
              </h3>
              <span className="text-xs font-semibold text-muted tabular-nums">
                {group.actions.length}
              </span>
            </div>
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
                  t={t}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
