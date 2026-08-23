import Link from "next/link";
import { type WaiverSendCopy, waiverSendCopy } from "@/app/actions/waiver-send-types";
import {
  WaitlistInvite,
  type WaitlistInviteCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/WaitlistInvite";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { seasonalBriefingText, URGENCY_KEYS } from "@/i18n/today-labels";
import { nowDate } from "@/lib/clock";
import { getSeasonalBriefing, groupActions, type TodayAction } from "@/lib/today";
import { KindChip } from "./KindChip";
import { PaymentActionControl, type PaymentActionCopy } from "./PaymentActionControl";
import { RelativeDepartureTime } from "./RelativeDepartureTime";
import {
  ResendConfirmationControl,
  type ResendConfirmationCopy,
} from "./ResendConfirmationControl";
import { UrgencyBand } from "./UrgencyBand";
import { WaiverSendControl } from "./WaiverSendControl";

const RELATIVE_DEPARTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Binds shopSlug + tripId server-side; the client control supplies the entry. */
export type TodayInviteAction = (tripId: string, entryId: string) => Promise<"sent" | "fallback">;

function ActionRow({
  action,
  grouped = false,
  shopSlug,
  shopName,
  inviteAction,
  waiverCopy,
  resendCopy,
  inviteCopy,
  paymentCopy,
  t,
  locale,
  timezone,
  nowMs,
}: {
  action: TodayAction;
  /** Inside a departure group the header already says the boat — the row must not repeat it. */
  grouped?: boolean;
  shopSlug: string;
  shopName: string;
  inviteAction: TodayInviteAction;
  waiverCopy: WaiverSendCopy;
  resendCopy: ResendConfirmationCopy;
  inviteCopy: WaitlistInviteCopy;
  paymentCopy: PaymentActionCopy;
  t: StaffTranslator;
  locale: string;
  timezone: string;
  nowMs?: number;
}) {
  const dueAt = action.dueAt;
  const showRelativeDepartureTime = Boolean(
    dueAt && Math.abs(dueAt.getTime() - (nowMs ?? Date.now())) <= RELATIVE_DEPARTURE_WINDOW_MS,
  );
  // What the row itself has to say: the person it is about (unless the row is
  // about the boat, which the group header already names) and what is wrong.
  const lead = grouped ? (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KindChip kind={action.kind} t={t} />
        {action.aboutDeparture ? null : <p className="font-semibold">{action.subject}</p>}
        {showRelativeDepartureTime && dueAt ? (
          <p className="text-sm text-muted">
            <RelativeDepartureTime at={dueAt} locale={locale} timeZone={timezone} nowMs={nowMs} />
          </p>
        ) : null}
      </div>
      <p className="mt-1 text-muted">{action.detail}</p>
    </div>
  ) : (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KindChip kind={action.kind} t={t} />
        <p className="font-semibold">{action.subject}</p>
        {action.context ? <p className="text-sm text-muted">{action.context}</p> : null}
        {showRelativeDepartureTime && dueAt ? (
          <p className="text-sm text-muted">
            <RelativeDepartureTime at={dueAt} locale={locale} timeZone={timezone} nowMs={nowMs} />
          </p>
        ) : null}
      </div>
      <p className="mt-1.5 text-muted">{action.detail}</p>
    </div>
  );
  // Rows split by what their control *is*. A row whose control performs a
  // send (waiver, invite, invoice) keeps a real button — the tap has a
  // consequence and deserves an explicit target. A row whose control merely
  // navigates dissolves into the row itself: the whole row is the link
  // (design/principles.md #10, "actions ride on their objects"), with the
  // destination named by a quiet chevron affordance instead of a bordered
  // button. Ten bordered "Open …" buttons down a queue made every row read
  // as a form; a tappable row reads as a list.
  const rowIsLink = !action.waiver && !action.resend && !action.invite && !action.payment?.orderId;
  const rowClass = grouped
    ? `group/row relative px-4 py-3.5 transition-colors sm:px-5${
        rowIsLink ? " hover:bg-surface-sunken/60 has-[a:focus-visible]:bg-surface-sunken/60" : ""
      }`
    : `group/row relative transition-colors${
        // Pressable chrome only on a card that is actually pressable — a
        // Send-waiver card that scaled and tinted on hover while only its
        // button did anything was a false affordance.
        rowIsLink
          ? " card-scale-hint hover:border-primary/40 has-[a:focus-visible]:border-primary/40"
          : ""
      }`;
  const content = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
      {lead}
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
        <>
          {/* The stretched link, same construction as the public schedule's
                agenda rows: an invisible overlay makes the whole row the tap
                target (a far better dock-test target than a 44px button), the
                aria-label keeps the destination's name for screen readers and
                the role-based tests, and the visible affordance below is
                presentational. `has-[a:focus-visible]` on the row carries the
                focus tint; the overlay's own outline draws around the row. */}
          <Link
            href={action.href}
            aria-label={action.actionLabel}
            className={`absolute inset-0 z-0 ${grouped ? "" : "rounded-2xl"}`}
          />
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary sm:pt-0.5"
          >
            {action.actionLabel}
            <span className="inline-block transition-transform group-hover/row:translate-x-0.5">
              ›
            </span>
          </span>
        </>
      )}
    </div>
  );
  return grouped ? (
    <li className={rowClass}>{content}</li>
  ) : (
    <SectionCard as="li" className={rowClass}>
      {content}
    </SectionCard>
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
  nowMs,
  viewSwitch,
  firstRun = false,
}: {
  actions: readonly TodayAction[];
  shopSlug: string;
  shopName: string;
  /** The shop's IANA timezone — the seasonal briefing reads the shop's month, not the server's. */
  timezone: string;
  inviteAction: TodayInviteAction;
  locale: string;
  nowMs?: number;
  /**
   * The urgency/by-departure switch, rendered on the queue's own heading row —
   * the control rides the thing it governs rather than floating above it.
   */
  viewSwitch?: React.ReactNode;
  /**
   * The shop has never had a departure — the same signal that decides whether
   * the setup checklist renders, never a second one derived here.
   */
  firstRun?: boolean;
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
    invitedRelative: t.raw("trips.waitlist.invitedRelative"),
    inviteEmailed: t("trips.waitlist.inviteEmailed"),
    reSendInvite: t("trips.waitlist.reSendInvite"),
    emailAnInvite: t.raw("trips.waitlist.emailAnInvite"),
    copied: t("trips.waitlist.copied"),
    copyInviteMessage: t("trips.waitlist.copyInviteMessage"),
    copyFailed: t("trips.waitlist.copyFailed"),
    justNow: t("trips.waitlist.justNow"),
    minutesAgo: t.raw("trips.waitlist.minutesAgo"),
    hoursAgo: t.raw("trips.waitlist.hoursAgo"),
    daysAgo: t.raw("trips.waitlist.daysAgo"),
    emailSubject: t.raw("trips.waitlist.emailSubject"),
    emailBody: t.raw("trips.waitlist.emailBody"),
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
    // **First-run renders nothing.** The empty state below is a claim about a
    // roster — "every diver booked in the next week has their waiver,
    // certifications, and payment in order" — and a shop on its first screen has
    // no divers, no trips and no dive sites. It sat directly beneath a checklist
    // whose third step is "Schedule your first trip", so the page told a shop it
    // had cleared work it had never had, contradicted the panel above it, and
    // wished it a good surface interval on a boat that does not exist (#711).
    //
    // Nothing, rather than a truer sentence: three stacked panels on a first
    // screen is already a lot and only the checklist has an action, so a third
    // panel saying "nothing booked yet" would restate what the checklist is
    // there to fix (the copy-restraint skill's first deletion). The earned
    // moment below is kept exactly as it is, for the shop that earned it.
    if (firstRun) return null;
    return (
      <section aria-labelledby="queue-heading">
        <EmptyState
          titleId="queue-heading"
          title={t("shared.today.todayQueue.emptyHeading")}
          body={
            <>
              {t("shared.today.todayQueue.emptyBody")}{" "}
              {seasonalBriefingText(t, getSeasonalBriefing(nowDate(), timezone), shopName)}
            </>
          }
          action={
            // The by-departure view's empty state offers exactly this link, and
            // the two views are meant to rest alike (BlockerGroups).
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("shared.today.todayQueue.emptyAction")}
            </Link>
          }
        />
      </section>
    );
  }

  // The morning's boats — "imminent" (next 3 hours) and "now" (within 24
  // hours) — are the two urgency bands a diver could still be
  // standing at the dock for. Once neither has any work left but a later
  // group still does, that's a real earned moment: the last blocker of the
  // morning just cleared, not the whole queue (the 🤙 empty state above
  // already covers that case).
  const todaysBoatsClear = !groups.some(
    (group) => group.urgency === "imminent" || group.urgency === "now",
  );

  return (
    <section aria-labelledby="queue-heading">
      {/* The heading and the view switch share one row: the switch governs
          exactly this block, so it sits on it (ADR 20260803-not-ready-is-a-
          view put it "on the queue block"; this is that, one line tighter).
          No standing subtitle — the rows themselves are the explanation, and
          a sentence that renders every day teaches nothing after day one. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="queue-heading" className="text-lg font-semibold">
          {t("shared.today.todayQueue.needsYouHeading")}
        </h2>
        {viewSwitch}
      </div>
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
          // In urgency mode, every row competes across every trip. The row
          // carries its own boat/time context, so a critical issue on a later
          // boat can appear above routine prep on the next boat.
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
                  locale={locale}
                  timezone={timezone}
                  nowMs={nowMs}
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
          // real work, not two folded bands and a shrug.
          return (
            <UrgencyBand
              key={group.urgency}
              label={t(URGENCY_KEYS[group.urgency])}
              count={t("shared.today.todayQueue.itemsCount", { count: group.actions.length })}
              folded={index > 0 && (group.urgency === "soon" || group.urgency === "later")}
            >
              {rows}
            </UrgencyBand>
          );
        })}
      </div>
    </section>
  );
}
