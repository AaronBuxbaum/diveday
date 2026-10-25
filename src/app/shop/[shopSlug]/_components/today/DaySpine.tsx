import Link from "next/link";
import { Suspense } from "react";
import { type WaiverSendCopy, waiverSendCopy } from "@/app/actions/waiver-send-types";
import {
  AgencyCheckHost,
  AgencyListedOffersSlot,
} from "@/app/shop/[shopSlug]/_components/agency-check/AgencyCheckHost";
import { AgencyCheckRow } from "@/app/shop/[shopSlug]/_components/agency-check/AgencyCheckRow";
import { agencyCheckCopies } from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-copy";
import { CrewLines, type CrewReading } from "@/app/shop/[shopSlug]/_components/today/CrewLines";
import {
  addAgencyListedCardsAction,
  agencyCheckAction,
} from "@/app/shop/[shopSlug]/divers/[personId]/agency-check-actions";
import {
  OfferSeat,
  type OfferSeatCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/OfferSeat";
import {
  offeredAgoText,
  offerSeatCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/offer-seat-copy";
import { EarnedMomentLine } from "@/components/EarnedMoment";
import { EmptyState } from "@/components/EmptyState";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { LedgerGroup, LedgerRow, type LedgerRowKindTone } from "@/components/ui/ledger";
import { StatusMark } from "@/components/ui/StatusMark";
import type { FirstBooking } from "@/db/first-booking";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { ACTION_KIND_KEYS } from "@/i18n/today-labels";
import { nowDate } from "@/lib/clock";
import type { DayTakings as DayTakingsReading, EveningClose } from "@/lib/closeout";
import { FORM_DRAFT_LABEL_KEYS, type FormDraftKind } from "@/lib/form-drafts";
import { formatMoneyScanned, formatMonthDay, formatShortDate, formatTime } from "@/lib/format";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import type { StaffDestinationId } from "@/lib/staff-destinations";
import {
  type ACTION_KIND_META,
  type DaySpine as DaySpineData,
  type DayStation as DayStationData,
  type FactOfScale,
  type NeedsYouReading,
  readNeedsYou,
  rowTone,
  sortStationRows,
  spineJobCount,
  type TodayAction,
  weekCrewAway,
} from "@/lib/today";
import { ClosingStation } from "./ClosingStation";
import { crewAwayRowControl } from "./CrewAwayWorkingControl";
import { DayStation } from "./DayStation";
import { HelpRequestSection, helpRequestControl } from "./help-request-row";
import { NeedsYouGroups } from "./NeedsYouGroups";
import { PaymentActionControl, type PaymentActionCopy } from "./PaymentActionControl";
import { RentalFitKeepControl } from "./RentalFitKeepControl";
import {
  ResendConfirmationControl,
  type ResendConfirmationCopy,
} from "./ResendConfirmationControl";
import { rowKey } from "./row-key";
import { spineClearUnlessWindy, spineEntries, spineMoment } from "./spine-reading";
import { EveningReadings } from "./TomorrowFromTonight";
import { WaiverSendControl } from "./WaiverSendControl";
import { WeekHorizon } from "./WeekHorizon";

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
 * place in clock order, and the day's takings appear beneath the spine once
 * every departure of the shop day has settled. There is nothing to press to
 * end the day: it is over when the boats are home.
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
 * booking ever, then the morning all-clear (drawn in success, not coral, since
 * UX review 2026-10-10 item 3, but still resolved here so two good-news lines
 * never stack). More than one can be true at once —
 * a day whose boats are all clear *and* all home; a first booking on Saturday
 * while today's empty boat comes home — and the ADR's coral table allows a
 * surface exactly one, so the later moment wins and, between two moments of the
 * same morning, the once-in-a-shop's-life one outranks the daily one. Whichever
 * loses renders nothing at all: a suppressed moment is not a moment drawn
 * quietly.
 */

/** One of the reader's fresh form drafts, with the door back to it. */
export type SpineDraft = { form: FormDraftKind; href: string };

type RowControls = {
  shopSlug: string;
  shopName: string;
  waiverCopy: WaiverSendCopy;
  resendCopy: ResendConfirmationCopy;
  offerCopy: OfferSeatCopy;
  paymentCopy: PaymentActionCopy;
  /** The signed-in staffer: the "working it" tap is never offered about them (#2678). */
  readerPersonId?: string;
  t: StaffTranslator;
};

/**
 * The copy and context every row's control needs, composed once per render on the server:
 * the controls are Client Components, so a translator never crosses the boundary.
 */
function rowControls(
  base: Pick<RowControls, "shopSlug" | "shopName" | "readerPersonId" | "t">,
): RowControls {
  const { t } = base;
  return {
    ...base,
    waiverCopy: waiverSendCopy(t),
    resendCopy: {
      resending: t("today.resendConfirmation.resending"),
      confirmationResent: t("today.resendConfirmation.confirmationResent"),
      confirmationsResent: t("today.resendConfirmation.confirmationsResent"),
      errors: {
        invalid: t("today.resendConfirmation.errors.invalid"),
        noEmail: t("today.resendConfirmation.errors.noEmail"),
        notConfigured: t("today.resendConfirmation.errors.notConfigured"),
        failed: t("today.resendConfirmation.errors.failed"),
      },
    },
    offerCopy: offerSeatCopy(t),
    paymentCopy: paymentActionCopy(t),
  };
}

/**
 * A horizon's panel: the tideline, the panel radius, no bed (a sunken panel
 * sits *in* the sand rather than on it), and the same inset padding on the
 * summary row and the week row so the two doors align. From `sm` up only —
 * on a phone the two horizons keep the row grammar they always had, one under
 * the other, because a panel's own padding was what pushed "Tomorrow · Wed,
 * Jul 22" onto two lines at 390px.
 *
 * **A hover shows on the panel's edge** (pixel-craft class 7, K-261). The rows
 * inside hover to `bg-surface-sunken`, which on this sunken panel is #ececf1
 * on #ececf1: hovering either door painted nothing at all. So the panel's
 * edge steps to `border-strong` while its door — Tomorrow's summary, the
 * week's row, each the panel's direct child — is under the pointer. An inset
 * ring, not a border: it is drawn at rest too, clear, so neither the hover nor
 * its arrival moves a pixel. The rows keep their fills for the phone, where no
 * panel is painted under them.
 *
 * **Only where a pointer can hover.** Every `hover:` utility carries
 * Tailwind's `@media (hover: hover)` gate; a `:hover` written inside `has-[]`
 * does not, so on a touch tablet a tap that opened Tomorrow left the whole
 * panel ringed until the next tap somewhere else. The step names the gate.
 */
const HORIZON_PANEL_CLASS =
  "sm:rounded-panel sm:bg-surface-sunken sm:px-5 sm:py-1 sm:inset-ring sm:inset-ring-transparent sm:[@media(hover:hover)]:has-[>summary:hover,>li:hover]:inset-ring-border-strong";

/** The status family's shape for a row that is wrong, and the ink it takes. */
const ROW_GLYPH = { danger: "danger", warning: "warning" } as const;
const ROW_GLYPH_INK = {
  danger: "text-danger",
  warning: "text-warning-strong",
  neutral: "text-muted",
} as const;

/** Every job kind whose tone is quiet: the rows that lead with their category. */
type QuietKind = {
  [K in keyof typeof ACTION_KIND_META]: (typeof ACTION_KIND_META)[K]["tone"] extends "neutral"
    ? K
    : never;
}[keyof typeof ACTION_KIND_META];

/** The small drawings a quiet row may lead with: a staff destination's, or the boat. */
type RowIconName = StaffDestinationId | "boat";

/**
 * **A quiet row leads with what it is about, not with an empty circle** (UX
 * review 2026-10-10, item 6). The hollow ring read as a checkbox: the desk
 * tapped it expecting to tick the job off, and nothing happened. A danger or
 * warning row keeps its status shape (the triangle the Waiver row wears); a
 * quiet one wears the drawing of the place its fix lives, from the same
 * family the sidebar draws, so nothing on the row looks pressable that is
 * not. A full record over the quiet kinds, so a new one is a type error until
 * it has a picture.
 */
const QUIET_ROW_ICON: Record<QuietKind, RowIconName> = {
  dive_prep: "gear",
  help_request: "inbox",
  payment: "orders",
  email_delivery: "inbox",
  seat_wanted: "divers",
  emergency_contact: "divers",
  crew_below_target: "staffing",
  reviews_pending: "reviews",
  unanswered_messages: "inbox",
  gear_due_back: "gear",
  gear_service_due: "workOrders",
  boat_papers_due: "boat",
  work_order_uncollected: "workOrders",
  units_unconfirmed: "settings",
  lost_items_waiting: "lostFound",
  rental_fit_confirm: "gear",
};

/**
 * **Good news wears the good-news tone** (UX review 2026-10-10, item 3). The
 * morning all-clear wore the coral wash, which read as the amber of a warning
 * on a phone in the sun; amber is rationed for things that need a hand, and a
 * crew taught that amber can mean "all clear" stops reading amber.
 */
function BoatsClearLine({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-tint px-3 py-2 text-sm font-semibold text-success-strong"
    >
      <StatusMark variant="success" size="sm" />
      {children}
    </p>
  );
}

/** The quiet icon for a kind, or none for a kind that is not quiet. */
function quietIcon(kind: TodayAction["kind"]): RowIconName | undefined {
  return (QUIET_ROW_ICON as Partial<Record<TodayAction["kind"], RowIconName>>)[kind];
}

/** A row's leading mark: the status shape when something is wrong, the category drawing when not. */
function RowGlyph({ tone, icon }: { tone: LedgerRowKindTone; icon?: RowIconName }) {
  if (tone === "neutral") {
    return (
      <DiveDayIcon
        name={icon ?? "today"}
        className={`size-5 shrink-0 ${ROW_GLYPH_INK.neutral}`}
        strokeWidth={1.6}
      />
    );
  }
  return <StatusMark variant={ROW_GLYPH[tone]} size="md" className={ROW_GLYPH_INK[tone]} />;
}

/**
 * **A spine row's anatomy, owned once**: the glyph, one word of kind, the one
 * sentence at reading size, the one fix. `StationRow` draws a job this way, and
 * so does a desk row that is not a job — a form draft to pick back up, the
 * payments setup row — so every sentence in a list starts on one column in one
 * size. Drawn by hand, the payments row had no glyph and no kind and a 14px
 * grey sentence, a draft's row a kind and no glyph: at 1280 the payments
 * sentence started at the glyph column (x 153) under a Setup row whose
 * sentence starts at 289, and read as that row's continuation (pixel-craft
 * K-317).
 */
function SpineRow({
  tone,
  icon,
  kind,
  trailing,
  closed = true,
  door,
  children,
}: {
  tone: LedgerRowKindTone;
  /** A quiet row's category drawing; ignored on a row that is wrong. */
  icon?: RowIconName;
  /** One word of kind, in the row's own type. */
  kind: string;
  /** The row's fix when it performs one — a real control beside the words. */
  trailing?: React.ReactNode;
  /** `false` inside a station's panel, whose own edge closes the list. */
  closed?: boolean;
  /**
   * Where the row's own tap goes, and its name for a screen reader. One object,
   * not two props: `LedgerRow`'s door is a union, so a link never reaches a
   * reader without an accessible name. Absent on a row that performs its fix.
   */
  door?: { href: string; linkLabel: string };
  /** The sentence's words. */
  children: React.ReactNode;
}) {
  // Both halves or neither, as one value: the union `LedgerRow` takes.
  const doorProps: { href: string; linkLabel: string } | { href?: never; linkLabel?: never } =
    door ?? {};
  return (
    <LedgerRow
      // Stacked below `sm`: the kind and the fix share the first line and the
      // sentence takes the width beneath them, which is the phone artboard's
      // reading and the only one where a full sentence has room to be read.
      stacked
      // The row's glyph — the first of the anatomy's four parts (glyph, one
      // word of kind, one sentence, one fix), drawn from the shipped status
      // family and never from the illustration hand: a status glyph is a
      // status, and the ADR keeps drawings out of that job. The kind word
      // beside it carries the meaning; the glyph is what a scan reads first.
      leading={<RowGlyph tone={tone} icon={icon} />}
      kind={{ word: kind, tone }}
      trailing={trailing}
      closed={closed}
      {...doorProps}
    >
      {/* One line per row (ADR 20260904-reef-all-the-way-down, slice 16a):
          the sentence at reading size — a subject over a detail at 14px was
          the rail's grammar, and a panel reads as one sentence. */}
      <p className="min-w-0 text-base leading-snug">{children}</p>
    </LedgerRow>
  );
}

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
function StationRow({
  action,
  controls,
  closed = true,
  grouped = false,
}: {
  action: TodayAction;
  controls: RowControls;
  /** `false` inside a station's panel, whose own edge closes the list. */
  closed?: boolean;
  /** Under its boat's own heading (`NeedsYouGroups`): the row does not say the boat again. */
  grouped?: boolean;
}) {
  const { t } = controls;
  const performs = Boolean(
    action.waiver ||
      action.resend ||
      action.offer ||
      action.payment?.orderId ||
      action.helpRequest ||
      action.rentalFit,
  );
  // The person, then the sentence, in one line (`SpineRow`); each half its own element.
  const tone = rowTone(action);
  // A row whose subject already is the whole fact carries no detail at all
  // (the desk's two counting rows), so neither the separator nor the second
  // span renders — a dangling " · " is the shape of a sentence that was
  // deleted rather than one that never existed.
  // In the one "Needs you" list a row names its boat itself, on a quiet line
  // under its words. A row about the departure has no person to lead with, so
  // its sentence starts the line and the boat sits under it like every other.
  const sentence = (
    <>
      {action.aboutDeparture ? null : (
        <>
          <span className="font-medium">{action.subject}</span>
          {action.detail ? (
            <span aria-hidden="true" className="text-muted">
              {" · "}
            </span>
          ) : null}
        </>
      )}
      {action.detail ? (
        <span className={tone === "neutral" ? "text-muted" : undefined}>{action.detail}</span>
      ) : null}
      {action.departure && !grouped ? (
        <span className="block text-sm text-muted">{action.departure.label}</span>
      ) : null}
    </>
  );
  const control = action.waiver ? (
    <WaiverSendControl
      surface="today"
      bookingIds={action.waiver.bookingIds}
      label={action.actionLabel}
      copy={controls.waiverCopy}
    />
  ) : action.resend ? (
    <ResendConfirmationControl
      shopSlug={controls.shopSlug}
      bookingIds={action.resend.bookingIds}
      label={action.actionLabel}
      copy={controls.resendCopy}
    />
  ) : action.offer ? (
    <OfferSeat
      formId={`offer-seat-${action.offer.tripId}`}
      tripId={action.offer.tripId}
      interests={[
        {
          interestId: action.offer.interestId,
          name: action.offer.personName,
          email: action.offer.personEmail,
        },
      ]}
      chooseByTick={false}
      label={t("trips.whoWantsIn.offerSeatToName", { name: action.offer.personName })}
      offeredLabel={
        action.offer.offeredAt
          ? t("trips.whoWantsIn.offeredAgo", {
              time: offeredAgoText(t, action.offer.offeredAt, nowDate()),
            })
          : undefined
      }
      bookingPath={action.offer.bookingPath}
      shopName={controls.shopName}
      tripTitle={action.offer.tripTitle}
      tripWhen={action.offer.tripWhen}
      copy={controls.offerCopy}
    />
  ) : action.payment?.orderId ? (
    <PaymentActionControl
      shopSlug={controls.shopSlug}
      orderId={action.payment.orderId}
      hostedInvoiceUrl={action.payment.hostedInvoiceUrl ?? null}
      copy={controls.paymentCopy}
    />
  ) : action.helpRequest ? (
    helpRequestControl(action.helpRequest, action.actionLabel, t)
  ) : action.agencyCheck && action.agencyCheck.cards.length > 0 ? (
    // **"Check with SSI" beside a card still waiting for its check** (H-105):
    // drawn only with the browser extension, and then the same check the
    // diver's record runs. Without it this draws nothing and the row's own
    // door to the record is the way to the card, as it always was.
    <AgencyCheckRow
      personId={action.agencyCheck.personId}
      cards={action.agencyCheck.cards}
      align="end"
    />
  ) : action.kind === "crew_away" ? (
    // **"Working it anyway"** (issue #2678), never about the reader.
    crewAwayRowControl(action, controls.t, controls.readerPersonId)
  ) : action.rentalFit ? (
    // **The one row whose fix is the tap itself** (issue #1174, D14): the size
    // is already known, so pointing at the diver's record to retype it would
    // be the surface asking a question it can answer.
    <RentalFitKeepControl
      reservationId={action.rentalFit.reservationId}
      label={t("today.gear.fitConfirmKeep")}
      pendingLabel={t("today.gear.fitConfirmSaving")}
    />
  ) : // **Nothing at all: the row's own tap is its only door** (ADR
  // 20260911-clear-the-deck, the floor's first row). This branch used to
  // render the destination as a word — "Open crew", "Open prep list", "Open
  // guests" — beside a chevron `LedgerRow` was already drawing, which put
  // nine verbs on one screen for nine taps the row itself already answers.
  // The word survives only where it *is* the fix: a waiver send, a wait-list
  // invite, an invoice resend, a help-request hand-off. The name of the
  // destination is still spoken — it is the stretched overlay's `linkLabel`
  // below — so nothing was traded away from a reader who cannot see the
  // chevron.
  null;

  // A row that performs its own fix inline is deliberately not a door: the
  // tap is the control beside it.
  const door =
    performs || !action.href ? undefined : { href: action.href, linkLabel: action.actionLabel };

  return (
    <SpineRow
      tone={tone}
      icon={quietIcon(action.kind)}
      kind={t(ACTION_KIND_KEYS[action.kind])}
      trailing={control}
      closed={closed}
      door={door}
    >
      {sentence}
    </SpineRow>
  );
}

function StationRows({ rows, controls }: { rows: readonly TodayAction[]; controls: RowControls }) {
  if (rows.length === 0) return null;
  return (
    // The panel's own edge closes the list: a closing rule its padding above
    // the panel's border was two parallel lines with nothing between them.
    <ul className="mt-4">
      {rows.map((action) => (
        <StationRow key={rowKey(action)} action={action} controls={controls} closed={false} />
      ))}
    </ul>
  );
}

/** One queue row, keyed for `NeedsYouGroups`. */
function stationRowFor(controls: RowControls) {
  return (action: TodayAction, grouped: boolean) => (
    <StationRow key={rowKey(action)} action={action} controls={controls} grouped={grouped} />
  );
}

/** What the reader started and did not finish: a draft is theirs alone, so the row is too. */
function DraftRows({ drafts, t }: { drafts: readonly SpineDraft[]; t: StaffTranslator }) {
  return drafts.map((draft) => (
    <SpineRow
      key={`draft:${draft.form}`}
      tone="neutral"
      icon="activity"
      kind={t("today.unfinished.label")}
      door={{ href: draft.href, linkLabel: t("today.unfinished.resume") }}
    >
      <span className="text-muted">{t(FORM_DRAFT_LABEL_KEYS[draft.form])}</span>
    </SpineRow>
  ));
}

/**
 * **The high-wind rows, streamed** (code review 2026-10-11, item 1). The
 * forecast is the one read on this page that is not the database, so the queue
 * answers without it (`getTodayWork`'s `highWind`) and these rows arrive under
 * their own `<Suspense>` once the provider does — after the rows they rank
 * beside, which is why they render below them rather than pushing painted rows
 * down. They are not in any count on the page: the list's total, the summary
 * under the date and the empty state all read the queue as it answered.
 */
async function HighWindRows({
  rows,
  tripIds,
  controls,
  className,
  closed,
}: {
  rows: Promise<readonly TodayAction[]>;
  /** The departures this list stands for; a row about any other boat files elsewhere. */
  tripIds: ReadonlySet<string>;
  controls: RowControls;
  className?: string;
  /** `false` inside a station's panel, as `StationRows` passes it. */
  closed?: boolean;
}) {
  const wind = (await rows).filter(
    (action) => action.departure != null && tripIds.has(action.departure.tripId),
  );
  if (wind.length === 0) return null;
  return (
    <ul className={className}>
      {wind.map((action) => (
        <StationRow key={rowKey(action)} action={action} controls={controls} closed={closed} />
      ))}
    </ul>
  );
}

/** The wind rows' place while the forecast is out: a late warning is never mistaken for none. */
function ForecastPending({ t, className }: { t: StaffTranslator; className?: string }) {
  return (
    <p className={`text-sm text-muted ${className ?? ""}`}>
      {t("today.todayQueue.checkingForecast")}
    </p>
  );
}

async function WindGate({
  wind,
  show,
  children,
}: {
  wind: Promise<readonly TodayAction[]>;
  show: (rows: readonly TodayAction[]) => boolean;
  children: React.ReactNode;
}) {
  return show(await wind) ? children : null;
}

/**
 * **A claim a wind row would contradict waits for the wind** (code review
 * 2026-10-11, item 1, dive-domain review). "Today's boats are all clear" and
 * "nothing is waiting on you" are statements about every row, and the
 * high-wind rows stream in after the queue: painted first, either line could
 * stand above a 25 kt warning a second later. So each renders only once the
 * forecast has answered and `show` agrees; nothing else on the page waits.
 * Without a forecast promise it decides at once, from no wind.
 */
function UnlessWindy({
  wind,
  show,
  children,
}: {
  wind?: Promise<readonly TodayAction[]>;
  show: (rows: readonly TodayAction[]) => boolean;
  children: React.ReactNode;
}) {
  if (!wind) return show([]) ? children : null;
  return (
    <Suspense fallback={null}>
      <WindGate wind={wind} show={show}>
        {children}
      </WindGate>
    </Suspense>
  );
}

/**
 * The whole week is in order — the queue's own good-news moment, and the only
 * thing that stands where the work would be.
 */
function QueueEmpty({ t, shopSlug }: { t: StaffTranslator; shopSlug: string }) {
  return (
    <EmptyState
      titleId="queue-heading"
      title={t("today.todayQueue.emptyHeading")}
      body={t("today.todayQueue.emptyBody")}
      action={
        <Link
          href={`/shop/${shopSlug}/schedule/board`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("today.todayQueue.emptyAction")}
        </Link>
      }
    />
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
    <>
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
          />
        ))}
      </ol>
      <StationRows
        rows={sortStationRows(stations.flatMap((station) => station.rows))}
        controls={controls}
      />
    </>
  );
}

/**
 * One place in the day's column of times: a departure still ahead (or in
 * progress), or one whose evening has begun. Discriminated rather than
 * inferred from a null, because the two halves come from two readers and the
 * compiler is the only thing that can promise they never render twice.
 */
/** The words for the Today queue's payment control (copy link, resend invoice). */
function paymentActionCopy(t: StaffTranslator): PaymentActionCopy {
  return {
    copyLink: t("today.paymentAction.copyLink"),
    linkCopied: t("today.paymentAction.linkCopied"),
    copyFailed: t("today.paymentAction.copyFailed"),
    resendInvoice: t("today.paymentAction.resendInvoice"),
    resending: t("today.paymentAction.resending"),
    invoiceResent: t("today.paymentAction.invoiceResent"),
    errors: {
      notFound: t("today.paymentAction.errors.notFound"),
      notOpen: t("today.paymentAction.errors.notOpen"),
      notConfigured: t("today.paymentAction.errors.notConfigured"),
      failed: t("today.paymentAction.errors.failed"),
      rateLimited: t("shared.limits.sendLimit", { thing: "invoices" }),
    },
  };
}

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
  /**
   * **What today made**, or null — the evening's one money reading (issue
   * #1930). Null means either of the two things the page resolves and a spine
   * must never ask about: the reader fails `canPersonViewShopReports`, or the
   * day took nothing at all. The third absence — a day still sailing — is the
   * `closing` condition this component already holds.
   */
  takings: DayTakingsReading | null;
  /**
   * No earlier day of this shop holds a sailed departure, so tonight is the
   * first boat that ever came home. The once-ever wording the coral table
   * sanctions — condition-derived, self-expiring, never stored.
   */
  firstEver: boolean;
};

/** The desk's "take card payments" row, for a shop with no Stripe account yet. */
function DeskPaymentsRow({ shopSlug, t }: { shopSlug: string; t: StaffTranslator }) {
  return (
    <SpineRow
      tone="neutral"
      icon="orders"
      kind={t("shopHome.spine.deskPaymentsKind")}
      door={{
        href: `/shop/${shopSlug}/settings#stripe`,
        linkLabel: t("shopHome.spine.deskPaymentsAction"),
      }}
    >
      <span className="text-muted">{t("shopHome.spine.deskPaymentsRow")}</span>
    </SpineRow>
  );
}

/** Everything `DaySpine` draws, assembled once by its caller and handed over as one object. */
export type DaySpineContext = {
  spine: DaySpineData;
  shopSlug: string;
  mailShopName: string; // what a mail that leaves says: always `shop.name` (H-131)
  locale: string;
  timeZone: string;
  currency: string;
  /**
   * Trips the signed-in staffer crews — badged, never re-ordered, and the rows
   * about them lead the Needs you list while every other row folds.
   */
  crewedTripIds?: readonly string[];
  /**
   * The signed-in staffer, so a row about them (their own credential coming
   * due) stays open under the crew lens instead of folding with the desk's.
   */
  readerPersonId?: string;
  /**
   * The reader's own unfinished forms (ADR 20260906-before-you-ask, decision
   * 3): one row per fresh draft under the desk group, and none otherwise.
   */
  drafts?: readonly SpineDraft[];
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
  /** The reader's own crew lines: this week's tips, this month's boats (`CrewLines`). */
  crew?: CrewReading;
  /** The instructor lens's own labeled group, above the first station. */
  sessions?: React.ReactNode;
  /** The day's closing state. Omitted, the spine renders its morning reading alone. */
  evening?: EveningReading;
  /**
   * The high-wind rows, still arriving (`getTodayWork`'s `highWind`): today's
   * under the Needs you list, tomorrow's inside its disclosure. Omitted, none.
   */
  highWind?: Promise<readonly TodayAction[]>;
  /** The page's `readNeedsYou`, which the date's sentence counted (UX review 2026-10-10, item 2). */
  needsYou?: NeedsYouReading;
  /** The day sentence's blocked figure, for the all-clear line when `needsYou` is omitted. */
  blocked?: number;
  now: Date;
};

/**
 * **The list says how long it is** (UX audit 2026-10-07, item 1): the summary
 * under the date counts what is due before the next boat and the badge counts
 * blocked divers, so the list carries its own total rather than leaving the
 * reader to reconcile three numbers.
 *
 * **And says how much of it is the next boat's** (#2413) when that is not all
 * of it, so the sentence's smaller number over this one reads as a part of it
 * rather than a contradiction.
 */
function needsYouMeta(
  t: StaffTranslator,
  reading: NeedsYouReading,
  locale: string,
  timeZone: string,
): string {
  const { count, next, dueBeforeNext } = reading;
  if (next == null || dueBeforeNext === count) {
    return t("shopHome.spine.needsYouCount", { count });
  }
  return t("shopHome.spine.needsYouCountBeforeNext", {
    count,
    before: dueBeforeNext,
    time: formatTime(next.startsAt, locale, timeZone),
  });
}

export function DaySpine({ context }: { context: DaySpineContext }) {
  const {
    spine,
    shopSlug,
    locale,
    timeZone,
    currency,
    crewedTripIds,
    readerPersonId,
    drafts = [],
    showPaymentsRow = false,
    firstRun,
    firstBooking,
    factOfScale,
    crew = { tipsCents: 0, month: null },
    sessions,
    evening,
    highWind,
    needsYou: needsYouRead,
    blocked = 0,
    now,
  } = context;
  const t = staffTranslator(locale);
  const controls = rowControls({
    shopSlug,
    shopName: context.mailShopName,
    readerPersonId,
    t,
  });
  const crewed = new Set(crewedTripIds ?? []);
  const jobs = spineJobCount(spine);
  const tomorrowDate = spine.tomorrow.stations[0]?.startsAt ?? null;

  const { liveTripIds, entries } = spineEntries(spine, evening?.close);

  const moment = spineMoment(evening?.close, firstBooking, factOfScale);
  const { allHomeLine, firstBookingMark, factOfScaleLine } = moment;
  const needsYouReading =
    needsYouRead ??
    readNeedsYou(spine, {
      crewedTripIds: crewedTripIds ?? [],
      readerPersonId,
      drafts: drafts.length,
      paymentsRow: showPaymentsRow,
      blocked,
      now,
    });
  const clearUnlessWindy = spineClearUnlessWindy(
    moment,
    { boatsClear: needsYouReading.boatsClear, jobs, blocked },
    spine,
  );
  const windOnToday = (wind: readonly TodayAction[]) =>
    wind.some((row) => row.departure != null && liveTripIds.has(row.departure.tripId));
  const closing = evening?.close.closing === true;
  // **One "Needs you" list**, read once (`readNeedsYou`) with the header's sentence.
  const { lead, folded: deskFold } = needsYouReading;
  const paymentsRows = showPaymentsRow ? 1 : 0;
  const paymentsRow = showPaymentsRow ? <DeskPaymentsRow shopSlug={shopSlug} t={t} /> : null;

  const spineBody = (
    <div className="flex flex-col gap-10">
      {/* **The spine's leading group, on the one morning it exists.** Day zero
          is a state of this column of work, not a wizard beside it (ADR
          20260827-first-light, decision 6) — so the setup ledger renders here,
          above everything, and the spine underneath it is honestly empty. */}
      {firstRun}

      {/* The coral table's two home rows, one at a time (see the docblock).
          Each renders only while its condition holds and vanishes when it
          passes — nothing here is stored, and nothing replays a celebration
          the day has moved past.

          **Only the all-home line is pulled up** (`-mt-4`, pixel-craft K-319):
          it tucks under the header's "Next up" sentence, which the page prints
          only once no station is left on the spine — an evening's shape. The
          all-clear needs today's stations, and the season's fact comes with
          them, so nothing is above either but the sky band: pulled, they sat
          16px under its edge with 40px to the first station. Unpulled, they
          sit the header's 32px under the band like every first block. */}
      {allHomeLine && evening ? (
        <EarnedMomentLine tone="ink" className="-mt-4 tabular-nums">
          {/* **Souls, not seats** (issue #1346). The one sentence in the
              product about who came home used to leave the crew out of both
              numbers — and they are the people most reliably still in the
              water at the end of a day. */}
          {t(evening.firstEver ? "shopHome.spine.firstBoatHome" : "shopHome.spine.allHome", {
            divers: evening.close.divers,
            crew: evening.close.crew,
            back: evening.close.back,
          })}
        </EarnedMomentLine>
      ) : clearUnlessWindy ? (
        <UnlessWindy wind={highWind} show={(wind) => jobs + wind.length > 0 && !windOnToday(wind)}>
          <BoatsClearLine>{t("today.todayQueue.boatsClear")}</BoatsClearLine>
        </UnlessWindy>
      ) : null}

      {/* **One fact of scale, on the day it is true** (ADR
          20260904-reef-all-the-way-down, Budget rule 3). A count of divers or
          boats and nothing else: never money, never a comparison, never a
          streak or a rank. `animate={false}` for the same reason the first
          booking is still: the fact holds all day, and a celebration replayed
          on every visit stops meaning anything. */}
      {factOfScaleLine && factOfScale ? (
        <EarnedMomentLine tone="ink" animate={false}>
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

      <CrewLines crew={crew} currency={currency} locale={locale} t={t} />

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
          <EarnedMomentLine tone="ink" animate={false} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
            {t("shopHome.spine.firstBooking")}
          </EarnedMomentLine>
          <ul className="mt-3">
            <LedgerRow
              size="lg"
              href={`/shop/${shopSlug}/trips/${firstBooking.tripId}`}
              linkLabel={firstBooking.tripTitle}
            >
              <div className="min-w-0">
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

      {entries.length > 0 ? (
        <LedgerGroup as="h2" label={t("shopHome.spine.departuresLabel")}>
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
                  t={t}
                />
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
        </LedgerGroup>
      ) : null}

      {lead.length + (deskFold?.length ?? 0) > 0 || showPaymentsRow || drafts.length > 0 ? (
        <LedgerGroup
          as="h2"
          label={t("shopHome.spine.needsYouLabel")}
          meta={needsYouMeta(t, needsYouReading, locale, timeZone)}
        >
          <NeedsYouGroups
            rows={lead}
            row={stationRowFor(controls)}
            shopSlug={shopSlug}
            t={t}
            desk={
              drafts.length > 0 || (!deskFold && paymentsRow) ? (
                <>
                  <DraftRows drafts={drafts} t={t} />
                  {deskFold ? null : paymentsRow}
                </>
              ) : undefined
            }
          />
          {/* **The desk's rows, folded, for a reader who crews a boat** (UX
              audit 2026-10-07, item 7). A captain's "what now" is the boats
              they are on; the front desk's twenty jobs are one line they can
              open, never gone. */}
          {deskFold ? (
            <LedgerGroup
              as="h3"
              folded
              className="mt-4"
              label={t("shopHome.spine.deskFoldLabel", { count: deskFold.length + paymentsRows })}
            >
              <NeedsYouGroups
                rows={deskFold}
                row={stationRowFor(controls)}
                shopSlug={shopSlug}
                t={t}
                desk={paymentsRow ?? undefined}
              />
            </LedgerGroup>
          ) : null}
        </LedgerGroup>
      ) : null}
      {/* The other cards an agency check's page listed (layer 3), under the
          list: the row they came from leaves it once its card is certified. */}
      <AgencyListedOffersSlot shopSlug={shopSlug} />

      {highWind ? (
        <Suspense fallback={<ForecastPending t={t} />}>
          <HighWindRows rows={highWind} tripIds={liveTripIds} controls={controls} />
        </Suspense>
      ) : null}

      {/* The whole week is in order — the queue's own good-news moment, and the
          only thing that stands where the work would be. It never renders for
          a shop still in first-run: that shop has no roster to make a claim
          about (issue #711), and its setup ledger leads the page. */}
      {jobs === 0 && !closing && !firstRun ? (
        <UnlessWindy wind={highWind} show={(wind) => wind.length === 0}>
          <QueueEmpty t={t} shopSlug={shopSlug} />
        </UnlessWindy>
      ) : null}

      {/* **What today made** (issue #1930), and what tomorrow needs from
          tonight (fifth-loop ideas, item 2). Neither while a boat is out. */}
      <EveningReadings
        evening={evening}
        currency={currency}
        locale={locale}
        timeZone={timeZone}
        shopSlug={shopSlug}
        t={t}
      />

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
              // On a phone the pair is ruled like any ledger list: Tomorrow's
              // own top rule, the week row's top rule between them, and its
              // `last:border-b` under the pair — or, with no week row, a
              // closing rule of Tomorrow's own. Taking Tomorrow's top rule
              // away left the pair open above (pixel-craft K-230).
              className={`${HORIZON_PANEL_CLASS} open:sm:col-span-2 sm:[&>summary]:border-0 sm:[&>summary]:rounded-panel ${
                spine.week.jobs > 0 ? "" : "max-sm:[&>summary]:border-b"
              }`}
              label={t("shopHome.spine.tomorrow", {
                date: tomorrowDate ? formatShortDate(tomorrowDate, locale, timeZone) : "",
              })}
              meta={`${t("shopHome.spine.departures", {
                count: spine.tomorrow.stations.length,
              })} · ${t("shopHome.spine.needsYouCount", { count: spine.tomorrow.jobs })}`}
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
                {highWind ? (
                  <Suspense fallback={<ForecastPending t={t} className="mt-4" />}>
                    <HighWindRows
                      rows={highWind}
                      tripIds={new Set(spine.tomorrow.stations.map((station) => station.tripId))}
                      controls={controls}
                      className="mt-4"
                      closed={false}
                    />
                  </Suspense>
                ) : null}
              </div>
            </LedgerGroup>
          ) : null}
          {spine.week.jobs > 0 ? (
            <WeekHorizon
              panelClass={HORIZON_PANEL_CLASS}
              jobs={spine.week.jobs}
              crewAway={weekCrewAway(spine.week.rows)}
              t={t}
            >
              <StationRows rows={spine.week.rows} controls={controls} />
            </WeekHorizon>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  return (
    <TodayAgencyCheck shopSlug={shopSlug} t={t}>
      <HelpRequestSection t={t} handled={spine.handledHelp} locale={locale} timeZone={timeZone}>
        {spineBody}
      </HelpRequestSection>
    </TodayAgencyCheck>
  );
}

/**
 * A "certification pending" row's "Check with SSI" (H-105) is the diver
 * record's own action, bound to the shop. Its outcome and Undo live above the
 * rows: a row whose card the check certifies leaves the list on the refresh
 * that follows. The other cards a match's page lists (layer 3) are offered
 * under the Needs you list (`AgencyListedOffersSlot`), each naming the diver
 * with a link to their record.
 */
function TodayAgencyCheck({
  shopSlug,
  t,
  children,
}: {
  shopSlug: string;
  t: StaffTranslator;
  children: React.ReactNode;
}) {
  return (
    <AgencyCheckHost
      action={agencyCheckAction.bind(null, shopSlug)}
      addListedAction={addAgencyListedCardsAction.bind(null, shopSlug)}
      offersAt="slot"
      copies={agencyCheckCopies(t)}
    >
      {children}
    </AgencyCheckHost>
  );
}
