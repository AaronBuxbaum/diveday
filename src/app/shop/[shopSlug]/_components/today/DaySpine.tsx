import Link from "next/link";
import { type WaiverSendCopy, waiverSendCopy } from "@/app/actions/waiver-send-types";
import {
  WaitlistInvite,
  type WaitlistInviteCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/WaitlistInvite";
import { EarnedMomentLine } from "@/components/EarnedMoment";
import { EmptyState } from "@/components/EmptyState";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { ACTION_KIND_KEYS, seasonalBriefingText } from "@/i18n/today-labels";
import { formatShortDate } from "@/lib/format";
import {
  ACTION_KIND_META,
  type DaySpine as DaySpineData,
  type DayStation as DayStationData,
  getSeasonalBriefing,
  spineJobCount,
  type TodayAction,
  todaysBoatsAreClear,
} from "@/lib/today";
import { DayStation } from "./DayStation";
import { PaymentActionControl, type PaymentActionCopy } from "./PaymentActionControl";
import {
  ResendConfirmationControl,
  type ResendConfirmationCopy,
} from "./ResendConfirmationControl";
import { WaiverSendControl } from "./WaiverSendControl";

/**
 * **The shop home is the day's spine** — ADR
 * 20260827-clearwater-surface-language, decision 4.
 *
 * One composition replaced the urgency/by-departure view pair: today's
 * departures as stations in clock order, each carrying its own work as ledger
 * rows, and everything bound to no boat pooled under one "At the desk" group.
 * Tomorrow and the rest of the week collapse to single count-carrying rows.
 *
 * Three things this file is deliberately *not*:
 *
 * - **A second detector.** Every row here came out of `getTodayWork` and was
 *   ranked by `src/lib/today.ts`; `assembleDaySpine` only decides which
 *   station it files under. There is no query, no blocker rule and no urgency
 *   arithmetic on this page.
 * - **A mode.** There is no view control and no phase switch — the ADR rejected
 *   one outright, because the clock already knows which part of the day it is.
 * - **A place a departure's facts get repeated.** The station header owns the
 *   boat; a row under it leads with the person or the chore (principle 9).
 *
 * The morning all-clear line is the one coral element this surface may render,
 * it renders at most once, and it renders nothing when untrue — the coral
 * budget's "The home, morning" row, restated in spine terms by
 * `todaysBoatsAreClear`.
 */

/** Binds shopSlug + tripId server-side; the client control supplies the entry. */
export type SpineInviteAction = (tripId: string, entryId: string) => Promise<"sent" | "fallback">;

type RowControls = {
  shopSlug: string;
  shopName: string;
  inviteAction: SpineInviteAction;
  waiverCopy: WaiverSendCopy;
  resendCopy: ResendConfirmationCopy;
  inviteCopy: WaitlistInviteCopy;
  paymentCopy: PaymentActionCopy;
  t: StaffTranslator;
};

/**
 * One job, as a ledger row: its kind as a word in the row's own type, the one
 * sentence saying what is wrong, and the one fix beside it.
 *
 * A row whose fix *performs* something — a waiver send, a wait-list invite, an
 * invoice resend — keeps a real control, because the tap has a consequence. A
 * row whose fix merely navigates becomes the link itself, with the destination
 * named for a screen reader on the stretched overlay and a quiet chevron for
 * everyone else (principle 10, "actions ride on their objects").
 */
/**
 * **The key a performing row keeps across its own fix landing.**
 *
 * `TodayAction.id` is `blocker:<booking>:<code>`, and the code is exactly what
 * a fix changes — a waiver goes from `waiver_missing` to `waiver_pending` the
 * moment it is sent. Keyed on the id, the row that was just tapped is a
 * *different* row to React, so its control unmounts and takes `useActionState`
 * with it: on a shop with no email configured that discards the private
 * fallback link the tap just produced, which is the one thing the staffer
 * needed. The row's own words still update — that part was never in doubt —
 * but the payload disappeared between the tap and the render.
 *
 * So a row that *performs* is keyed on what it performs against, which does
 * not change when the fix lands. A row that merely navigates holds no state
 * and keeps the id.
 */
function rowKey(action: TodayAction): string {
  if (action.waiver) return `waiver:${action.waiver.bookingIds.join(",")}`;
  if (action.resend) return `resend:${action.resend.bookingId}`;
  if (action.invite) return `invite:${action.invite.entryId}`;
  if (action.payment?.orderId) return `payment:${action.payment.orderId}`;
  return action.id;
}

function StationRow({ action, controls }: { action: TodayAction; controls: RowControls }) {
  const { t } = controls;
  const performs = Boolean(
    action.waiver || action.resend || action.invite || action.payment?.orderId,
  );
  const body = (
    <div className="min-w-0 py-2">
      {action.aboutDeparture ? null : <p className="text-sm font-medium">{action.subject}</p>}
      <p className="text-sm text-muted">{action.detail}</p>
    </div>
  );
  const control = action.waiver ? (
    <WaiverSendControl
      shopSlug={controls.shopSlug}
      surface="today"
      bookingIds={action.waiver.bookingIds}
      label={action.actionLabel}
      copy={controls.waiverCopy}
    />
  ) : action.resend ? (
    <ResendConfirmationControl
      shopSlug={controls.shopSlug}
      bookingId={action.resend.bookingId}
      label={action.actionLabel}
      copy={controls.resendCopy}
    />
  ) : action.invite ? (
    <WaitlistInvite
      entryId={action.invite.entryId}
      personName={action.invite.personName}
      personEmail={action.invite.personEmail}
      invitedAt={action.invite.invitedAt}
      bookingPath={action.invite.bookingPath}
      shopName={controls.shopName}
      tripTitle={action.invite.tripTitle}
      tripWhen={action.invite.tripWhen}
      invite={controls.inviteAction.bind(null, action.invite.tripId)}
      copy={controls.inviteCopy}
    />
  ) : action.payment?.orderId ? (
    <PaymentActionControl
      shopSlug={controls.shopSlug}
      orderId={action.payment.orderId}
      hostedInvoiceUrl={action.payment.hostedInvoiceUrl ?? null}
      copy={controls.paymentCopy}
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary"
    >
      {action.actionLabel}
      <DiveDayIcon name="chevron-right" className="size-4" />
    </span>
  );

  // One object, not two props. `LedgerRow`'s door is a union — a row carries
  // both `href` and a `linkLabel` or neither, so a link can never reach a
  // reader without an accessible name. Two independent ternaries cannot prove
  // that correlation to the compiler, and a row that performs its own fix
  // inline is deliberately not a door: the tap is the control beside it.
  const door = performs || !action.href ? {} : { href: action.href, linkLabel: action.actionLabel };

  return (
    <LedgerRow
      // Stacked below `sm`: the kind and the fix share the first line and the
      // sentence takes the width beneath them, which is the phone artboard's
      // reading and the only one where a full sentence has room to be read.
      stacked
      kind={{
        word: t(ACTION_KIND_KEYS[action.kind]),
        tone: ACTION_KIND_META[action.kind].tone,
      }}
      trailing={control}
      {...door}
    >
      {body}
    </LedgerRow>
  );
}

function StationRows({ rows, controls }: { rows: readonly TodayAction[]; controls: RowControls }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-4">
      {rows.map((action) => (
        <StationRow key={rowKey(action)} action={action} controls={controls} />
      ))}
    </ul>
  );
}

function Stations({
  stations,
  crewedTripIds,
  shopSlug,
  locale,
  timeZone,
  currency,
  controls,
}: {
  stations: readonly DayStationData[];
  crewedTripIds: ReadonlySet<string>;
  shopSlug: string;
  locale: string;
  timeZone: string;
  currency: string;
  controls: RowControls;
}) {
  return (
    <ol>
      {stations.map((station) => (
        <DayStation
          key={station.tripId}
          station={station}
          shopSlug={shopSlug}
          locale={locale}
          timeZone={timeZone}
          currency={currency}
          crewed={crewedTripIds.has(station.tripId)}
          t={controls.t}
        >
          <StationRows rows={station.rows} controls={controls} />
        </DayStation>
      ))}
    </ol>
  );
}

export function DaySpine({
  spine,
  shopSlug,
  shopName,
  locale,
  timeZone,
  currency,
  crewedTripIds,
  withheldCount = 0,
  inviteAction,
  showPaymentsRow = false,
  sessions,
  now,
}: {
  spine: DaySpineData;
  shopSlug: string;
  shopName: string;
  locale: string;
  timeZone: string;
  currency: string;
  /** Trips the signed-in staffer crews — badged, never re-ordered. */
  crewedTripIds?: readonly string[];
  /** How many rows the reader's role lens withheld (issue #715). */
  withheldCount?: number;
  inviteAction: SpineInviteAction;
  /**
   * The desk group's one presence-derived row: the shop has departures, cannot
   * accept payments, and has never taken an order
   * (ADR 20260827-first-light, decision 6). Gone forever at connection.
   */
  showPaymentsRow?: boolean;
  /** The instructor lens's own labeled group, above the first station. */
  sessions?: React.ReactNode;
  now: Date;
}) {
  const t = staffTranslator(locale);
  const controls: RowControls = {
    shopSlug,
    shopName,
    inviteAction,
    t,
    waiverCopy: waiverSendCopy(t),
    resendCopy: {
      resending: t("shared.today.resendConfirmation.resending"),
      confirmationResent: t("shared.today.resendConfirmation.confirmationResent"),
      errors: {
        invalid: t("shared.today.resendConfirmation.errors.invalid"),
        noEmail: t("shared.today.resendConfirmation.errors.noEmail"),
        notConfigured: t("shared.today.resendConfirmation.errors.notConfigured"),
        failed: t("shared.today.resendConfirmation.errors.failed"),
      },
    },
    // Same keys `WaitlistSection.tsx` uses — `WaitlistInvite` is a Client
    // Component, so the full copy object is composed here rather than passing
    // a translator across the boundary.
    inviteCopy: {
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
    },
    paymentCopy: {
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
    },
  };
  const crewed = new Set(crewedTripIds ?? []);
  const jobs = spineJobCount(spine);
  const tomorrowDate = spine.tomorrow.stations[0]?.startsAt ?? null;

  return (
    <div className="flex flex-col gap-10">
      {withheldCount > 0 ? (
        <p className="-mt-4 text-xs text-muted">
          {t("shared.today.todayQueue.withheldDeskWork", { count: withheldCount })}
        </p>
      ) : null}

      {/* The one coral element this surface may render, and only while it is
          true (principles.md §3; the ADR's coral table, "The home, morning"). */}
      {todaysBoatsAreClear(spine) ? (
        <EarnedMomentLine className="-mt-4">
          {t("shared.today.todayQueue.boatsClear")}
        </EarnedMomentLine>
      ) : null}

      {sessions}

      {spine.stations.length > 0 ? (
        <Stations
          stations={spine.stations}
          crewedTripIds={crewed}
          shopSlug={shopSlug}
          locale={locale}
          timeZone={timeZone}
          currency={currency}
          controls={controls}
        />
      ) : null}

      {/* The whole week is in order — the queue's own good-news moment, and the
          only thing that stands where the work would be. It never renders for
          a shop still in first-run: that shop has no roster to make a claim
          about (issue #711), and its setup ledger is the page. */}
      {jobs === 0 ? (
        <EmptyState
          titleId="queue-heading"
          title={t("shared.today.todayQueue.emptyHeading")}
          body={
            <>
              {t("shared.today.todayQueue.emptyBody")}{" "}
              {seasonalBriefingText(t, getSeasonalBriefing(now, timeZone), shopName)}
            </>
          }
          action={
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("shared.today.todayQueue.emptyAction")}
            </Link>
          }
        />
      ) : null}

      {spine.desk.length > 0 || showPaymentsRow ? (
        <LedgerGroup as="h2" label={t("shopHome.spine.deskLabel")}>
          <ul className="mt-3">
            {spine.desk.map((action) => (
              <StationRow key={rowKey(action)} action={action} controls={controls} />
            ))}
            {showPaymentsRow ? (
              <LedgerRow
                href={`/shop/${shopSlug}/settings#stripe`}
                linkLabel={t("shopHome.spine.deskPaymentsAction")}
                trailing={
                  <span
                    aria-hidden="true"
                    className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary"
                  >
                    {t("shopHome.spine.deskPaymentsAction")}
                    <DiveDayIcon name="chevron-right" className="size-4" />
                  </span>
                }
              >
                <p className="py-2 text-sm text-muted">{t("shopHome.spine.deskPaymentsRow")}</p>
              </LedgerRow>
            ) : null}
          </ul>
        </LedgerGroup>
      ) : null}

      {/* The two horizons, collapsed. Tomorrow expands in place through the
          app's one disclosure spelling (`LedgerGroup`'s `folded`); the week is
          a plain row pointing at the board, because a week is a board
          question. Neither links to a queue view — there is no longer one. */}
      {spine.tomorrow.stations.length > 0 || spine.week.jobs > 0 ? (
        <div className="flex flex-col gap-6">
          {spine.tomorrow.stations.length > 0 ? (
            <LedgerGroup
              as="h2"
              folded
              label={t("shopHome.spine.tomorrow", {
                date: tomorrowDate ? formatShortDate(tomorrowDate, locale, timeZone) : "",
              })}
              meta={`${t("shopHome.spine.departures", {
                count: spine.tomorrow.stations.length,
              })} · ${t("shopHome.spine.jobs", { count: spine.tomorrow.jobs })}`}
            >
              <div className="mt-4">
                <Stations
                  stations={spine.tomorrow.stations}
                  crewedTripIds={crewed}
                  shopSlug={shopSlug}
                  locale={locale}
                  timeZone={timeZone}
                  currency={currency}
                  controls={controls}
                />
              </div>
            </LedgerGroup>
          ) : null}
          {spine.week.jobs > 0 ? (
            <ul>
              <LedgerRow
                size="lg"
                href={`/shop/${shopSlug}/schedule/board`}
                linkLabel={t("shopHome.spine.openBoard")}
                trailing={
                  <span className="flex items-center gap-2 text-sm text-muted tabular-nums">
                    {t("shopHome.spine.jobs", { count: spine.week.jobs })}
                    <DiveDayIcon name="chevron-right" className="size-4" aria-hidden="true" />
                  </span>
                }
              >
                <p className="text-base">{t("shopHome.spine.week")}</p>
              </LedgerRow>
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
