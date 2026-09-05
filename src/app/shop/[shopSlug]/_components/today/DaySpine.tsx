import Link from "next/link";
import { type WaiverSendCopy, waiverSendCopy } from "@/app/actions/waiver-send-types";
import {
  WaitlistInvite,
  type WaitlistInviteCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/WaitlistInvite";
import { EarnedMomentLine } from "@/components/EarnedMoment";
import { EmptyState } from "@/components/EmptyState";
import { SiteMark } from "@/components/illustration/SiteMark";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel, LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import { StatusMark } from "@/components/ui/StatusMark";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { DayCloseoutRecord } from "@/db/closeout";
import type { FirstBooking } from "@/db/first-booking";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { ACTION_KIND_KEYS, seasonalBriefingText } from "@/i18n/today-labels";
import { DEPARTURE_BUFFER_MS, type EveningClose } from "@/lib/closeout";
import { formatMoneyScanned, formatMonthDay, formatShortDate, formatTime } from "@/lib/format";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import {
  ACTION_KIND_META,
  type DaySpine as DaySpineData,
  type DayStation as DayStationData,
  type FactOfScale,
  getSeasonalBriefing,
  spineJobCount,
  type TodayAction,
  todaysBoatsAreClear,
} from "@/lib/today";
import { ClosingBlock } from "./ClosingBlock";
import { ClosingStation } from "./ClosingStation";
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
 * **The evening is a state, not a mode** (slice 6d, H-62). There is still no
 * phase control and no second view: the stations settle one at a time as their
 * head counts close, a settled one renders {@link ClosingStation} in its own
 * place in clock order, and the {@link ClosingBlock} appears beneath the spine
 * once every departure of the shop day has settled. `/close-out` is a 308 to
 * this page; nothing about `day_closeouts` or the close act changed underneath.
 *
 * **Day zero is a state of this spine, never a wizard** (ADR
 * 20260827-first-light, decision 6; slice 10d). A shop that has never had a
 * departure gets `FirstRunChecklist`'s setup ledger as the spine's
 * *leading group* — passed in as `firstRun`, because the page owns the five
 * persisted reads behind it — and the spine below it is simply empty. The one
 * thing that changes for its sake is the queue's own "nothing is waiting on
 * you" state, which stands down: that is a claim about a roster this shop does
 * not have yet (issue #711). It never co-renders with the quiet-day
 * composition either, and that rule is `spineIsQuiet`'s to keep, not this
 * file's.
 *
 * **One coral element, ever.** This surface has four candidates and they are
 * resolved here, in one place, in one order: the recorded close (a panel, the
 * moment kept), then the evening's all-boats-home line, then the shop's first
 * booking ever, then the morning all-clear. More than one can be true at once —
 * a day whose boats are all clear *and* all home; a first booking on Saturday
 * while today's empty boat comes home — and the ADR's coral table allows a
 * surface exactly one, so the later moment wins and, between two moments of the
 * same morning, the once-in-a-shop's-life one outranks the daily one. Whichever
 * loses renders nothing at all: a suppressed moment is not a moment drawn
 * quietly.
 */

/** Binds shopSlug + tripId server-side; the client control supplies the entry. */
export type SpineInviteAction = (tripId: string, entryId: string) => Promise<"sent" | "fallback">;
export type SpineHelpRequestAction = (
  requestId: string,
  status: "acknowledged" | "handled",
) => Promise<void>;

type RowControls = {
  shopSlug: string;
  shopName: string;
  inviteAction: SpineInviteAction;
  waiverCopy: WaiverSendCopy;
  resendCopy: ResendConfirmationCopy;
  inviteCopy: WaitlistInviteCopy;
  paymentCopy: PaymentActionCopy;
  helpRequestAction?: SpineHelpRequestAction;
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
  if (action.helpRequest) return `help-request:${action.helpRequest.requestId}`;
  return action.id;
}

/**
 * A horizon's panel: the tideline, the panel radius, no bed (a sunken panel
 * sits *in* the sand rather than on it), and the same inset padding on the
 * summary row and the week row so the two doors align. From `sm` up only —
 * on a phone the two horizons keep the row grammar they always had, one under
 * the other, because a panel's own padding was what pushed "Tomorrow · Wed,
 * Jul 22" onto two lines at 390px.
 */
const HORIZON_PANEL_CLASS = "sm:rounded-panel sm:bg-surface-sunken sm:px-5 sm:py-1";

/** The status family's shape for each kind tone, and the ink it takes. */
const ROW_GLYPH = { danger: "danger", warning: "warning", neutral: "pending" } as const;
const ROW_GLYPH_INK = {
  danger: "text-danger",
  warning: "text-warning-strong",
  neutral: "text-muted",
} as const;

function StationRow({ action, controls }: { action: TodayAction; controls: RowControls }) {
  const { t } = controls;
  const performs = Boolean(
    action.waiver ||
      action.resend ||
      action.invite ||
      action.payment?.orderId ||
      action.helpRequest,
  );
  // One line per row (ADR 20260904-reef-all-the-way-down, slice 16a): the
  // person, then the sentence, at reading size — a subject over a detail at
  // 14px was the rail's grammar, and a panel reads as one sentence with a name
  // in it. Each half keeps its own element so a reader (and a test) can find
  // either by its own words.
  const tone = ACTION_KIND_META[action.kind].tone;
  const body = (
    <p className="min-w-0 py-2 text-base leading-snug">
      {action.aboutDeparture ? null : (
        <>
          <span className="font-medium">{action.subject}</span>
          <span aria-hidden="true" className="text-muted">
            {" · "}
          </span>
        </>
      )}
      <span className={tone === "neutral" ? "text-muted" : undefined}>{action.detail}</span>
    </p>
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
  ) : action.helpRequest && controls.helpRequestAction ? (
    <form
      action={controls.helpRequestAction.bind(
        null,
        action.helpRequest.requestId,
        action.helpRequest.status === "requested" ? "acknowledged" : "handled",
      )}
      className="flex sm:inline-flex"
    >
      <SubmitButton
        pendingLabel={t("shared.today.helpRequest.saving")}
        className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
      >
        {action.actionLabel}
      </SubmitButton>
    </form>
  ) : (
    // The word only: this row is a door, and `LedgerRow` draws the door's
    // chevron itself — a second one here read as "Open crew › ›".
    <span aria-hidden="true" className="shrink-0 text-sm font-medium text-primary">
      {action.actionLabel}
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
      className="-mx-2 px-2"
      // The row's glyph — the first of the anatomy's four parts (glyph, one
      // word of kind, one sentence, one fix), drawn from the shipped status
      // family and never from the illustration hand: a status glyph is a
      // status, and the ADR keeps drawings out of that job. The kind word
      // beside it carries the meaning; the glyph is what a scan reads first.
      leading={<StatusMark variant={ROW_GLYPH[tone]} size="md" className={ROW_GLYPH_INK[tone]} />}
      kind={{
        word: t(ACTION_KIND_KEYS[action.kind]),
        tone,
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
    <ol className="flex flex-col gap-5">
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

/**
 * One place in the day's column of times: a departure still ahead (or in
 * progress), or one whose evening has begun. Discriminated rather than
 * inferred from a null, because the two halves come from two readers and the
 * compiler is the only thing that can promise they never render twice.
 */
type SpineEntry =
  | { kind: "live"; at: number; station: DayStationData }
  | { kind: "closing"; at: number; close: EveningClose["stations"][number] };

/**
 * Everything the evening reading needs, read once by the page and handed down
 * whole. Absent on a morning that has nothing settled — and absent is the
 * honest default, because a spine with no closing state is exactly the spine
 * this component rendered before 6d.
 */
export type EveningReading = {
  /** The day's departures with their closing state (`src/lib/closeout.ts`). */
  close: EveningClose;
  /** Per trip, who made the last roll-call mark and when. Absent for a trip with none. */
  headCountCloses: ReadonlyMap<string, { closedAt: Date; closedBy: string }>;
  /**
   * Per trip, that departure's recap editor — composed by the page, because
   * the editor binds seven server actions and this component binds none.
   */
  recapEditors: ReadonlyMap<string, React.ReactNode>;
  /**
   * `canPersonExportIncidentRecord`; the log door is absent for everyone else.
   * Read once by the page and worn by **every** departure station, live or
   * settled — the amendment to ADR 20260804-incident-export-owner-gate is
   * explicit that the document is offered on a boat that has not come home.
   */
  canOpenLog: boolean;
  /** Today's still-open rows, already stripped of the ones the shop dismissed. */
  leftovers: readonly TodayAction[];
  latest: DayCloseoutRecord | null;
  closeCount: number;
  /**
   * No earlier day of this shop holds a sailed departure, so tonight is the
   * first boat that ever came home. The once-ever wording the coral table
   * sanctions — condition-derived, self-expiring, never stored.
   */
  firstEver: boolean;
};

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
  helpRequestAction,
  showPaymentsRow = false,
  firstRun,
  firstBooking,
  factOfScale,
  sessions,
  evening,
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
  helpRequestAction?: SpineHelpRequestAction;
  /**
   * The desk group's one presence-derived row: the shop has departures, cannot
   * accept payments, and has never taken an order
   * (ADR 20260827-first-light, decision 6). Gone forever at connection.
   */
  showPaymentsRow?: boolean;
  /**
   * The setup ledger, for a shop that has never had a departure — the spine's
   * leading group (ADR 20260827-first-light, decision 6). Composed by the page,
   * which owns the five persisted reads behind it.
   */
  firstRun?: React.ReactNode;
  /**
   * The shop's first booking ever, while it is still the only one
   * (`shopFirstBooking`). Present means the moment is live; the coral
   * resolution above decides whether it renders.
   */
  firstBooking?: FirstBooking | null;
  /**
   * The season's one fact of scale, on the day it is true (`factOfScaleFor`;
   * ADR 20260904-reef-all-the-way-down, decision 2, Budget rule 3). Present
   * means the fact holds today; the coral resolution above decides whether it
   * renders, and on most days it is null.
   */
  factOfScale?: FactOfScale | null;
  /** The instructor lens's own labeled group, above the first station. */
  sessions?: React.ReactNode;
  /** The day's closing state. Omitted, the spine renders its morning reading alone. */
  evening?: EveningReading;
  now: Date;
}) {
  const t = staffTranslator(locale);
  const controls: RowControls = {
    shopSlug,
    shopName,
    inviteAction,
    helpRequestAction,
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

  // **The two halves of one row of stations.** The spine's own stations come
  // from a forward-looking reader, which drops a departure an hour after it
  // leaves; the closing state is read backwards over the whole shop day. So a
  // departure appears in exactly one of them, and merging by `startsAt` is
  // what makes the day read as one column of times settling from the top
  // rather than a board quietly emptying.
  const liveTripIds = new Set(spine.stations.map((station) => station.tripId));
  const liveEntries: SpineEntry[] = spine.stations.map((station) => ({
    kind: "live",
    at: station.startsAt.getTime(),
    station,
  }));
  const closingEntries: SpineEntry[] = (evening?.close.stations ?? [])
    .filter((close) => !liveTripIds.has(close.tripId))
    .map((close) => ({ kind: "closing", at: close.startsAt.getTime(), close }));
  const entries = [...liveEntries, ...closingEntries].sort((a, b) => a.at - b.at);

  // The one coral element, resolved once (see this file's docblock). A
  // recorded close is a panel inside the closing block, so every line stands
  // down for it; the evening's own moment outranks the morning's; and between
  // the morning's two, the shop's first booking ever outranks a day whose
  // boats happen to be clear, because one of them happens once and the other
  // happens on a good Tuesday.
  const closedPanel = evening?.latest != null;
  const allHomeLine = !closedPanel && evening?.close.allHome === true;
  const firstBookingMark = !closedPanel && !allHomeLine && firstBooking != null;
  // The season's fact outranks the *daily* all-clear and nothing above it
  // (Budget rule 3). It is not a compliment, so it does not wait for a day
  // with no blockers on it — the Home board draws it over a morning with a
  // boarding blocker, which is the day a shop most deserves to be told it is
  // on its four hundredth diver.
  const factOfScaleLine = !closedPanel && !allHomeLine && !firstBookingMark && factOfScale != null;
  const boatsClearLine =
    !closedPanel &&
    !allHomeLine &&
    !firstBookingMark &&
    !factOfScaleLine &&
    todaysBoatsAreClear(spine);
  const closing = evening?.close.closing === true;
  // The next boat out, carrying the standing one-hour late-arrival buffer:
  // its site mark is the one on the spine that wears the coral detail.
  const nextTripId =
    entries
      .flatMap((entry) => (entry.kind === "live" ? [entry.station] : []))
      .find((station) => station.startsAt.getTime() + DEPARTURE_BUFFER_MS > now.getTime())
      ?.tripId ?? null;
  const nextStation = entries
    .flatMap((entry) => (entry.kind === "live" ? [entry.station] : []))
    .find((station) => station.tripId === nextTripId);
  const firstThing = nextStation?.rows.find(
    (row): row is TodayAction & { href: string } =>
      ACTION_KIND_META[row.kind].tone === "danger" &&
      typeof row.href === "string" &&
      !row.waiver &&
      !row.resend &&
      !row.invite &&
      !row.payment?.orderId &&
      !row.helpRequest,
  );
  const closingLeftoverIds = new Set(
    closing && evening ? evening.leftovers.map((leftover) => leftover.id) : [],
  );
  const deskActions = spine.desk.filter((action) => !closingLeftoverIds.has(action.id));

  return (
    <div className="flex flex-col gap-10">
      {withheldCount > 0 ? (
        <p className="-mt-4 text-xs text-muted">
          {t("shared.today.todayQueue.withheldDeskWork", { count: withheldCount })}
        </p>
      ) : null}

      {/* **The spine's leading group, on the one morning it exists.** Day zero
          is a state of this column of work, not a wizard beside it (ADR
          20260827-first-light, decision 6) — so the setup ledger renders here,
          above everything, and the spine underneath it is honestly empty. */}
      {firstRun}

      {/* The coral table's two home rows, one at a time (see the docblock).
          Each renders only while its condition holds and vanishes when it
          passes — nothing here is stored, and nothing replays a celebration
          the day has moved past. */}
      {allHomeLine && evening ? (
        <EarnedMomentLine className="-mt-4 tabular-nums">
          {t(evening.firstEver ? "shopHome.spine.firstBoatHome" : "shopHome.spine.allHome", {
            out: evening.close.out,
            back: evening.close.back,
          })}
        </EarnedMomentLine>
      ) : boatsClearLine ? (
        // The morning's all-clear carries the green turtle — the one drawing
        // an earned moment on a staff surface may hold (ADR
        // 20260901-diveday-reimagined, decision 1: "one earned moment on a
        // staff surface, once a day"). Drawn in the line, without its own coral
        // detail: the panel it sits in is the surface's coral.
        <EarnedMomentLine className="-mt-4 flex items-center gap-3">
          <SiteMark mark="turtle" size="sm" ground="surface" coral={false} />
          <span>{t("shared.today.todayQueue.boatsClear")}</span>
        </EarnedMomentLine>
      ) : null}

      {/* **One fact of scale, on the day it is true** (ADR
          20260904-reef-all-the-way-down, Budget rule 3). A count of divers or
          boats and nothing else: never money, never a comparison, never a
          streak or a rank. `animate={false}` for the same reason the first
          booking is still: the fact holds all day, and a celebration replayed
          on every visit stops meaning anything. */}
      {factOfScaleLine && factOfScale ? (
        <EarnedMomentLine animate={false} className="-mt-4">
          <span className="font-medium">
            {factOfScale.kind === "first_boat"
              ? t("shopHome.spine.factOfScale.firstBoat")
              : // Always a multiple of a hundred, so the ordinal is always
                // "th" — there is no 401st diver of the season to render.
                t("shopHome.spine.factOfScale.divers", {
                  name: factOfScale.diverName,
                  time: formatTime(factOfScale.departureAt, locale, timeZone),
                  count: factOfScale.count,
                })}
          </span>{" "}
          <span className="text-muted">
            {t("shopHome.spine.factOfScale.since", {
              date: formatMonthDay(
                factOfScale.seasonStart.month,
                factOfScale.seasonStart.day,
                locale,
              ),
            })}
          </span>
        </EarnedMomentLine>
      ) : null}

      {/* **The first booking ever, and then never again.** The word, the coral
          dot, and the seat itself — one row, because the moment *is* that
          diver. Nothing here is stored and nothing acknowledges it: the second
          booking, or the boat sailing, ends it (ADR 20260827-first-light,
          decision 6; the coral budget's once-ever row). */}
      {firstBookingMark && firstBooking ? (
        <div>
          {/* `animate={false}`: this moment is a *state* the owner arrives
              holding, and it can hold for days — the seat is booked, the boat
              is Saturday. Replaying the entrance on every visit until then is
              exactly how a celebration stops meaning anything (the rule
              `EarnedMomentLine` carries). The two lines above are today's and
              reset with the day; this one does not. */}
          <EarnedMomentLine animate={false} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
            {t("shopHome.spine.firstBooking")}
          </EarnedMomentLine>
          <ul className="mt-3">
            <LedgerRow
              size="lg"
              className="-mx-2 px-2"
              href={`/shop/${shopSlug}/trips/${firstBooking.tripId}`}
              linkLabel={firstBooking.tripTitle}
            >
              <div className="min-w-0 py-2">
                <p className="text-base font-medium break-words">
                  {firstBooking.diverName}{" "}
                  <span className="font-normal text-muted">· {firstBooking.tripTitle}</span>
                </p>
                <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted tabular-nums">
                  <span>
                    {formatShortDate(firstBooking.startsAt, locale, timeZone)} ·{" "}
                    {formatTime(firstBooking.startsAt, locale, timeZone)}
                  </span>
                  <span>
                    {firstBooking.paymentStatus &&
                    isCapturedPaymentStatus(firstBooking.paymentStatus)
                      ? firstBooking.paymentAmountCents != null || firstBooking.priceCents != null
                        ? t("shopHome.spine.firstBookingPaid", {
                            amount: formatMoneyScanned(
                              firstBooking.paymentAmountCents ?? firstBooking.priceCents ?? 0,
                              firstBooking.paymentCurrency ?? firstBooking.currency,
                              locale,
                            ),
                          })
                        : t("shopHome.spine.firstBookingPaidNoAmount")
                      : firstBooking.paymentStatus === "waived"
                        ? t("shopHome.spine.firstBookingWaived")
                        : t("shopHome.spine.firstBookingPaymentDue")}
                  </span>
                  <span>
                    {firstBooking.waiverSigned
                      ? t("shopHome.spine.firstBookingWaiverSigned")
                      : t("shopHome.spine.firstBookingWaiverNeeded")}
                  </span>
                </p>
              </div>
            </LedgerRow>
          </ul>
        </div>
      ) : null}

      {sessions}

      {/* **The one obvious next action** (H-62, made literal — the board's
          "First thing" panel). The next boat out has its rows in severity
          order already; when the first of them is danger-toned and is a door,
          it is lifted above the spine as one panel: the glyph, the kind as
          its label, the person, the sentence, the fix as the page's one
          primary. It is a *repeat* of the row beneath, on purpose — the spine
          is the record and this is the answer to "what first?", and a reader
          who scrolls past it loses nothing. Rows that perform their fix
          inline (a waiver send) stay where their control is. */}
      {firstThing ? (
        <section
          aria-labelledby="first-thing-label"
          className="flex flex-col gap-4 rounded-panel border border-danger/30 bg-surface p-5 shadow-bed sm:flex-row sm:items-center sm:gap-5 sm:px-6"
        >
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-full bg-danger-tint text-danger"
          >
            <StatusMark variant="danger" size="lg" />
          </span>
          <div className="min-w-0 flex-1">
            <GroupLabel as="p" id="first-thing-label" tone="danger">
              {t("shopHome.spine.firstThing", { kind: t(ACTION_KIND_KEYS[firstThing.kind]) })}
            </GroupLabel>
            <p className={`mt-1 ${SECTION_TITLE_CLASS} tracking-tight`}>
              {firstThing.aboutDeparture ? firstThing.detail : firstThing.subject}
            </p>
            {firstThing.aboutDeparture ? null : <p className="text-muted">{firstThing.detail}</p>}
          </div>
          <Link href={firstThing.href} className={buttonClass({ className: "shrink-0" })}>
            {firstThing.actionLabel}
          </Link>
        </section>
      ) : null}

      {entries.length > 0 ? (
        // Panels, not a rail: each station is a `SectionCard` on the bed and
        // the column spaces them (ADR 20260904-reef-all-the-way-down, 16a).
        <ol className="flex flex-col gap-5">
          {entries.map((entry) =>
            entry.kind === "live" ? (
              <DayStation
                key={entry.station.tripId}
                station={entry.station}
                shopSlug={shopSlug}
                locale={locale}
                timeZone={timeZone}
                currency={currency}
                crewed={crewed.has(entry.station.tripId)}
                // Today's live departures carry the log door too, not only the
                // settled ones (ADR 20260804-incident-export-owner-gate's
                // amendment). `evening` is absent only when the page has no day
                // to close over, which is also when there is no station here.
                canOpenLog={evening?.canOpenLog ?? false}
                next={entry.station.tripId === nextTripId}
                t={t}
              >
                <StationRows rows={entry.station.rows} controls={controls} />
              </DayStation>
            ) : evening ? (
              <ClosingStation
                key={entry.close.tripId}
                close={entry.close}
                headCountClose={evening.headCountCloses.get(entry.close.tripId) ?? null}
                shopSlug={shopSlug}
                locale={locale}
                timeZone={timeZone}
                canOpenLog={evening.canOpenLog}
                t={t}
              >
                {evening.recapEditors.get(entry.close.tripId) ?? null}
              </ClosingStation>
            ) : null,
          )}
        </ol>
      ) : null}

      {/* The whole week is in order — the queue's own good-news moment, and the
          only thing that stands where the work would be. It never renders for
          a shop still in first-run: that shop has no roster to make a claim
          about (issue #711), and its setup ledger leads the page. */}
      {jobs === 0 && !closing && !firstRun ? (
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

      {deskActions.length > 0 || showPaymentsRow ? (
        <LedgerGroup as="h2" label={t("shopHome.spine.deskLabel")}>
          <ul className="mt-1.5">
            {/* A closing leftover owns the row once the day settles. Keep
                standing desk work here, but never paint one action twice. */}
            {deskActions.map((action) => (
              <StationRow key={rowKey(action)} action={action} controls={controls} />
            ))}
            {showPaymentsRow ? (
              <LedgerRow
                className="-mx-2 px-2"
                href={`/shop/${shopSlug}/settings#stripe`}
                linkLabel={t("shopHome.spine.deskPaymentsAction")}
                trailing={
                  <span
                    aria-hidden="true"
                    className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary"
                  >
                    {t("shopHome.spine.deskPaymentsAction")}
                  </span>
                }
              >
                <p className="py-2 text-sm text-muted">{t("shopHome.spine.deskPaymentsRow")}</p>
              </LedgerRow>
            ) : null}
          </ul>
        </LedgerGroup>
      ) : null}

      {/* **The closing block, and where it sits.** Beneath the day's own work
          — the stations and the desk — and *above* the horizons, because the
          spine's Tomorrow disclosure is the tomorrow band the evening ends on
          (the Evening artboard's last row). Rendering a second one inside the
          block would be the repetition this language exists to remove. It
          appears only when every departure of the shop day has settled. */}
      {closing && evening ? (
        <ClosingBlock
          leftovers={evening.leftovers}
          latest={evening.latest}
          closeCount={evening.closeCount}
          locale={locale}
          timeZone={timeZone}
          t={t}
        />
      ) : null}

      {/* The two horizons, collapsed. Tomorrow expands in place through the
          app's one disclosure spelling (`LedgerGroup`'s `folded`); the week is
          a plain row pointing at the board, because a week is a board
          question. Neither links to a queue view — there is no longer one. */}
      {/* Drawn as two tideline panels side by side from `sm` up (the board's
          "Later, collapsed" row): sunken, no bed, at the panel radius, so the
          two horizons read as one pair of doors rather than two more rows of
          today's work. Tomorrow still expands in place — a `<details>` on the
          `open:` variant takes both columns so its stations get the width —
          and the week still points at the board, because a week is a board
          question. */}
      {spine.tomorrow.stations.length > 0 || spine.week.jobs > 0 ? (
        <div className="grid sm:grid-cols-2 sm:gap-5">
          {spine.tomorrow.stations.length > 0 ? (
            <LedgerGroup
              as="h2"
              folded
              summaryVariant="row"
              className={`${HORIZON_PANEL_CLASS} open:sm:col-span-2 sm:[&>summary]:border-0 sm:[&>summary]:rounded-panel [&>summary]:hover:bg-surface-sunken ${
                spine.week.jobs > 0
                  ? "max-sm:[&>summary]:border-t-0"
                  : "max-sm:[&>summary]:border-b"
              }`}
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
            <ul className={HORIZON_PANEL_CLASS}>
              <LedgerRow
                size="lg"
                // The hairline goes transparent rather than to width zero:
                // `border-t`'s width beats a `border-0` on emit order, and a
                // colour beats a colour by name.
                className="-mx-2 px-2 hover:bg-surface-sunken sm:mx-0 sm:rounded-panel sm:border-transparent sm:px-0 sm:last:border-transparent"
                href={`/shop/${shopSlug}/schedule/board`}
                linkLabel={t("shopHome.spine.openBoard")}
                trailing={
                  <span className="flex items-center gap-2 text-sm text-muted tabular-nums">
                    {t("shopHome.spine.jobs", { count: spine.week.jobs })}
                  </span>
                }
              >
                <p className="text-base font-semibold tracking-tight">{t("shopHome.spine.week")}</p>
              </LedgerRow>
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
