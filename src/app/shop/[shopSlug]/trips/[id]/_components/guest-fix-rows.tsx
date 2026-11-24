import Link from "next/link";
import type { ReactNode } from "react";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { helpRequestControl } from "@/app/shop/[shopSlug]/_components/today/help-request-row";
import { PaymentActionControl } from "@/app/shop/[shopSlug]/_components/today/PaymentActionControl";
import { paymentActionCopy } from "@/app/shop/[shopSlug]/_components/today/payment-action-copy";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { buttonClass } from "@/components/ui/button";
import type { TodayHelpRequest } from "@/features/messages/help-requests";
import type { STAFF_RE_ENTRY_KEYS } from "@/features/trips/dive-intent";
import {
  type AdvisoryReason,
  type FixGuest,
  type FixItem,
  type FixListMode,
  type FixReason,
  type FixRemedy,
  fixListOf,
  quietOnFilling,
} from "@/features/trips/trip-fix-list";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import { staffParticipantTypeLabel } from "@/i18n/staff-participant-labels";
import { helpRequestActionText } from "@/i18n/today-labels";
import { formatMoneyCents, formatWeekdayTime } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { firstNameOf } from "@/lib/person-name";
import { diverPhotoDisplayPath } from "@/lib/person-photo";
import type { ReadinessBlockerCode } from "@/lib/readiness";
import { rentalFitCompleteness } from "@/lib/rentals";
import { shopPath } from "@/lib/staff-notices";
import type { FixListGuest, FixListRow, FixListSection } from "./GuestFixList";
import { RosterRow, type RosterRowContext } from "./RosterRow";
import { rowNotices } from "./roster-row-notices";
import { rowReasonLines } from "./roster-row-reasons";
import { rosterSeat } from "./roster-seat";
import type { RosterEntry } from "./types";

/** A roster reason line's key, as the fix list names it. */
const LINE_REASONS: Readonly<Record<string, AdvisoryReason>> = {
  "earlier-refusal": "earlier_refusal",
  "earlier-referral": "earlier_referral",
  "more-holds": "more_holds",
  depth: "depth",
  drysuit: "drysuit",
  recency: "recency",
  waiver: "waiver_unsigned",
  payment: "payment_unpaid",
  contact: "contact_missing",
};

/** The short phrase each re-entry ask is said with on a row (domain review of layer B, F2). */
const RE_ENTRY_PHRASE_KEYS = {
  deck_word: "trips.fixList.reEntry.deckWord",
  easy_first_dive: "trips.fixList.reEntry.easyFirstDive",
  refresher_course: "trips.fixList.reEntry.refresherCourse",
} as const satisfies Record<keyof typeof STAFF_RE_ENTRY_KEYS, StaffMessageKey>;

/** What a guest asked a hand with, said on their row. */
const HELP_KIND_KEYS = {
  carry_gear: "trips.fixList.help.carryGear",
  first_timer: "trips.fixList.help.firstTimer",
  find_group: "trips.fixList.help.findGroup",
} as const satisfies Record<string, StaffMessageKey>;

/**
 * Which part of the trip's day the list is drawn for (ADR 20261117-trip-page-clock):
 * `filling` days ahead (one quiet Booked card), `ready` the day before (the
 * remote remedies), `checkin` at the desk, and `listed` once the boat has left,
 * on a cancelled trip, or on a later phase only previewed: everyone booked,
 * folded into one line, with nothing to fix.
 */
export type FixListPhase = "filling" | "ready" | "checkin" | "listed";

/** A row's button weight: the list's first fix is the one primary on it (finding 5). */
type ControlWeight = "primary" | "secondary";

/** A trip-level fix: what holds the whole boat up, and the door to it. */
export type TripFix = {
  key: string;
  text: string;
  tone: "danger" | "warning";
  action: { href: string; label: string };
};

const REMEDY_KEYS: Readonly<Record<Exclude<FixRemedy, "send_waiver">, StaffMessageKey>> = {
  take_payment: "trips.fixList.remedy.takePayment",
  review_cards: "trips.fixList.remedy.reviewCards",
  confirm_identity: "trips.fixList.remedy.confirmIdentity",
  review_medical: "trips.fixList.remedy.reviewMedical",
  course_forms: "trips.fixList.remedy.courseForms",
  add_contact: "trips.fixList.remedy.addContact",
  fit_gear: "trips.fixList.remedy.fitGear",
  arrange_help: "trips.fixList.remedy.arrangeHelp",
  open: "trips.fixList.remedy.open",
};

/** `waiver_not_sent` → `trips.fixList.reason.waiverNotSent`. */
export function reasonKey(reason: FixReason): StaffMessageKey {
  const camel = reason.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return `trips.fixList.reason.${camel}` as StaffMessageKey;
}

type Seat = {
  entry: RosterEntry;
  guest: FixGuest;
  /** Whom this guest travels with, named. */
  party: string | null;
  sendWaiver: ((variant: ControlWeight) => ReactNode) | null;
  /** A link can reach this guest alone, so a group send may include them. */
  waiverSendable: boolean;
  /** An email or a text can reach the guest; with neither, nothing was sent. */
  reachable: boolean;
  /**
   * Where an unreachable guest signs instead: their party's queue, or their
   * own one-seat counter queue (issue #3984). Null when a link reaches them
   * or the seat waits on who it is.
   */
  counterHref: string | null;
  /** What a payment fix would take, formatted in the shop's currency. */
  owed: string | null;
  /** The guest's open help request: the row says it and holds the crew choice. */
  helpRequest: TodayHelpRequest | null;
  /** The guest's open invoice, so a money row can copy the pay link or resend it. */
  order: { id: string; hostedInvoiceUrl: string | null } | null;
  /** When the guest's next pre-trip reminder goes out. */
  reminderAt: Date | null;
  cardsHref: string;
  /** The opened guest draws the desk's tap itself, beside the blockers it answers. */
  panelHoldsArrival: boolean;
};

/**
 * The one reminder time every listed guest with a reason shares, or null when
 * they differ or none is set: Filling says it once on the card's heading row,
 * not on every line.
 */
function sharedReminderOf(
  items: readonly FixItem[],
  byId: ReadonlyMap<string, { reminderAt: Date | null }>,
): Date | null {
  const times = new Set(
    items.flatMap((item) => {
      const at = item.reasons.length > 0 ? byId.get(item.guestId)?.reminderAt : null;
      return at ? [at.getTime()] : [];
    }),
  );
  const [only] = times;
  return times.size === 1 && only !== undefined ? new Date(only) : null;
}

/**
 * **One guest, read for the fix list**: the codes behind the reason lines the
 * row already says (readiness blockers, then each advisory line), so the list
 * and the opened guest can never disagree about what holds someone up.
 */
function seatOf(entry: RosterEntry, context: RosterRowContext): Seat {
  const { booking, person } = entry;
  const { rows, arrival, t, trip } = context;
  // Every reason the guest has, a depth note much of the boat shares
  // included: the list names each guest once, with all of theirs.
  const seat = rosterSeat(entry, false, { ...context, sharedAdvisoryTexts: new Set() });
  const { reasonLines } = rowReasonLines({ ...seat, ...rowNotices(seat) });
  const blocked = seat.readiness?.status === "blocked";
  // A held seat says only its own reasons (`heldSeatBlockers`); a blocked
  // reading with none said still blocks. A seat with no reading at all fails
  // closed, as the sentence's count does (`tripFrame`): it is never "fine".
  const blockers: ReadinessBlockerCode[] = blocked
    ? seat.blockerTexts.length
      ? seat.blockerTexts.map(({ blocker }) => blocker.code)
      : (seat.readiness?.blockers.map((blocker) => blocker.code) ?? ["readiness_unavailable"])
    : seat.readiness
      ? []
      : ["readiness_unavailable"];
  const advisories: AdvisoryReason[] = reasonLines.flatMap((line) => {
    const reason = LINE_REASONS[line.key];
    return reason ? [reason] : [];
  });
  if (booking.reEntryAsk && seat.showsPersonDetail) advisories.push("re_entry_ask");
  const helpRequest = rows.helpRequestByBooking.get(booking.id) ?? null;
  if (helpRequest) advisories.push("help_requested");
  const fit = rentalFitCompleteness(
    rows.rentalFitByBooking.get(booking.id) ?? null,
    trip.shopRentalItems,
    booking.participantType,
  );
  if (
    seat.showsPersonDetail &&
    booking.participantType !== "rider" &&
    (fit.state !== "complete" || Boolean(rows.rentalFitByBooking.get(booking.id)?.needsStaffFitAt))
  ) {
    advisories.push("fit_needed");
  }
  const lead = booking.partyLeadBookingId ?? booking.id;
  const companions = rows.roster.filter(
    (other) =>
      other.booking.id !== booking.id &&
      (other.booking.partyLeadBookingId ?? other.booking.id) === lead,
  );
  const partyLead =
    Boolean(booking.partyLeadBookingId) ||
    rows.roster.some((other) => other.booking.partyLeadBookingId === booking.id);
  // One tap sends the link only to a guest a link can reach (the seat's own
  // word, `rosterSeat`); a party's or a counter guest's release is signed
  // through its queue, on the opened guest.
  const { reachable } = seat;
  const control = seat.waiverControl;
  const waiverSendable = Boolean(
    control.action && reachable && !partyLead && !seat.identityUnconfirmed,
  );
  const sendWaiver = waiverSendable
    ? (variant: ControlWeight) => (
        <WaiverSendControl
          surface="roster"
          tripId={trip.tripId}
          bookingIds={[booking.id]}
          label={control.label}
          pendingLabel={
            control.action === "send" ? t("words.busy.sending") : t("trips.roster.resending")
          }
          confirmMessage={
            control.confirm
              ? t("trips.roster.confirmResendWaiver", { name: person.fullName })
              : undefined
          }
          className={buttonClass({ variant, size: "sm" })}
          wrapperClassName=""
          copy={waiverSendCopy(t)}
        />
      )
    : null;
  const { amountCents, currency } = seat.paymentMark;
  const owed =
    amountCents && amountCents > 0 ? formatMoneyCents(amountCents, currency, trip.locale) : null;
  return {
    entry,
    guest: {
      id: booking.id,
      blockers,
      advisories,
      checkedIn: Boolean(arrival) && entry.checkedIn,
      released:
        arrival && booking.status === "no_show"
          ? booking.turnedAwayAt
            ? "turned_away"
            : "not_here"
          : null,
    },
    party: companions.length
      ? cachedListFormat(trip.locale, { style: "long", type: "conjunction" }).format(
          companions.map((other) => other.person.fullName),
        )
      : null,
    sendWaiver,
    waiverSendable,
    reachable,
    counterHref:
      reachable || seat.identityUnconfirmed
        ? null
        : shopPath(
            trip.shopSlug,
            "trips",
            trip.tripId,
            "party",
            booking.partyLeadBookingId ?? booking.id,
            "waivers",
          ),
    owed,
    helpRequest,
    order: rows.openOrderByBooking.get(booking.id) ?? null,
    reminderAt: rows.nextReminderAtByBooking.get(booking.id) ?? null,
    cardsHref: `/shop/${trip.shopSlug}/divers/${person.id}#cards`,
    panelHoldsArrival: seat.blockerTexts.length > 0,
  };
}

/** A row before the list decides which one fix carries the primary weight. */
type DraftRow = Omit<FixListRow, "control" | "primary"> & {
  control: ((variant: ControlWeight) => ReactNode) | null;
  /** The desk's Check in: never the list's primary. */
  tap?: boolean;
};
type DraftSection = Omit<FixListSection, "rows" | "summary"> & {
  rows: DraftRow[];
  summary?: Omit<NonNullable<FixListSection["summary"]>, "rows"> & { rows: DraftRow[] };
};

/**
 * The two fixes a guest's row can make in place: the crew choice for a help
 * request, and the pay link (copy or resend) for a guest invoiced through Stripe.
 */
function seatRemedyControl(
  remedy: FixRemedy,
  seat: Seat,
  t: RosterRowContext["t"],
  shopSlug: string,
): { control: DraftRow["control"]; openLabel?: string } | null {
  const { helpRequest: request, order } = seat;
  if (remedy === "arrange_help" && request) {
    return {
      control: () =>
        helpRequestControl(
          {
            requestId: request.id,
            revision: request.revision,
            status: request.status,
            helperPersonId: request.helperPersonId,
            helperPersonName: request.helperPersonName,
            crew: request.crew,
            meetingInstructions: request.meetingInstructions,
          },
          helpRequestActionText(t, request.helperPersonName),
          t,
        ),
    };
  }
  if (remedy === "take_payment" && seat.owed && order) {
    return {
      control: () => (
        <PaymentActionControl
          shopSlug={shopSlug}
          orderId={order.id}
          hostedInvoiceUrl={order.hostedInvoiceUrl}
          copy={paymentActionCopy(t)}
        />
      ),
      openLabel: t("trips.fixList.remedy.takeAmount", { amount: seat.owed }),
    };
  }
  return null;
}

/**
 * **The guest list's sections and rows** for `GuestFixList`, by phase. Each
 * guest is on one row, carrying all of their reasons ("Check the depth · Fit
 * gear"), so every count is a count of people:
 *
 * - `checkin`: Can't board yet, To come (each with Check in and whatever is
 *   worth a minute about them), Worth a minute for guests already here, then
 *   Here folded.
 * - `ready`: Can't board yet and Worth a minute with the remote remedies (send
 *   the waiver again, call), then "N guests are ready" with the crew line.
 * - `filling`: one quiet Booked card: everyone fine as one counted line, then
 *   whoever will need something later, without a button.
 * - `listed`: everyone booked, folded into one line, with nothing to make
 *   ready: once the boat has left, on a cancelled trip, or on a later phase
 *   previewed before the boat sails.
 *
 * Released guests fold under Not here and Turned away. A trip-level fix
 * (`tripFixes`) leads its group. The first fix on the list carries the one
 * primary button; every other is secondary.
 */
export function guestFixRows(
  context: RosterRowContext,
  {
    phase,
    tripFixes = [],
    after,
  }: {
    phase: FixListPhase;
    tripFixes?: readonly TripFix[];
    /** Quiet lines under the ready guests ("Crew and plan are set"). */
    after?: ReactNode;
  },
): { sections: FixListSection[]; guests: FixListGuest[]; deskWorkOpen: boolean } {
  const { t, rows, arrival, trip } = context;
  const mode: FixListMode = phase === "checkin" && arrival ? "checkin" : "all";
  const seats = rows.roster.map((entry) => seatOf(entry, context));
  const byId = new Map(seats.map((seat) => [seat.guest.id, seat]));
  const list = fixListOf(
    seats.map((seat) => seat.guest),
    { mode },
  );
  const listFormat = cachedListFormat(trip.locale, { style: "long", type: "conjunction" });
  const nameOf = (id: string) => byId.get(id)?.entry.person.fullName ?? "";

  /** The phrase for a guest with nothing to fix: what they come as, and with whom. */
  const kindPhrase = (seat: Seat): string | null =>
    [
      seat.entry.booking.participantType === "diver"
        ? null
        : staffParticipantTypeLabel(t, seat.entry.booking.participantType),
      seat.party ? t("trips.fixList.with", { names: seat.party }) : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  /** One reason in the row's words: the amount when money is the reason, the ask when it is one. */
  const reasonText = (reason: FixReason, seat: Seat | undefined): string => {
    if (reason === "payment_due" && seat?.owed)
      return t("trips.fixList.reason.paymentDueAmount", { amount: seat.owed });
    if (reason === "help_requested" && seat?.helpRequest)
      return t(HELP_KIND_KEYS[seat.helpRequest.kind]);
    const ask = seat?.entry.booking.reEntryAsk;
    if (reason === "re_entry_ask" && ask) return t(RE_ENTRY_PHRASE_KEYS[ask]);
    // Opened for signing, but no email or text could carry it: say so, not "sent".
    if (reason === "waiver_pending" && seat && !seat.reachable)
      return t("trips.fixList.reason.waiverNothingSent");
    return t(reasonKey(reason));
  };

  /** Every reason the guest has, worst first, each said once. */
  const phraseOf = (item: FixItem, seat: Seat | undefined): string | null => {
    if (item.reasons.length === 0) return seat ? kindPhrase(seat) : null;
    return [...new Set(item.reasons.map((reason) => reasonText(reason, seat)))].join(" · ");
  };

  const callControl = (seat: Seat) => {
    const phone = seat.entry.person.phone;
    if (!phone) return null;
    return (variant: ControlWeight) => (
      <a href={`tel:${phone}`} className={buttonClass({ variant, size: "sm" })}>
        {t("trips.fixList.remedy.call", {
          name: firstNameOf(seat.entry.person.fullName, seat.entry.person.fullName),
        })}
      </a>
    );
  };

  const remedyControl = (
    remedy: FixRemedy,
    seat: Seat | undefined,
  ): {
    control?: DraftRow["control"];
    openLabel?: string;
    panelHoldsControl?: boolean;
  } => {
    if (remedy === "send_waiver" && seat?.sendWaiver)
      return { control: seat.sendWaiver, panelHoldsControl: true };
    // Nothing could be sent: the counter's QR code is the way to sign.
    if (remedy === "send_waiver" && seat?.counterHref) {
      const href = seat.counterHref;
      return {
        control: (variant) => (
          <Link href={href} className={buttonClass({ variant, size: "sm" })}>
            {t("trips.partyWaiverQueue.counter")}
          </Link>
        ),
        // The opened guest draws its own counter link beside the waiver line.
        panelHoldsControl: true,
      };
    }
    if (remedy === "review_cards" && seat)
      return {
        control: (variant) => (
          <Link href={seat.cardsHref} className={buttonClass({ variant, size: "sm" })}>
            {t(REMEDY_KEYS.review_cards)}
          </Link>
        ),
      };
    const remote = seat ? seatRemedyControl(remedy, seat, t, trip.shopSlug) : null;
    if (remote) return remote;
    if (remedy === "take_payment" && seat?.owed)
      return { openLabel: t("trips.fixList.remedy.takeAmount", { amount: seat.owed }) };
    // The day before, what nobody can do from the desk is a call away.
    if (phase === "ready" && seat && (remedy === "open" || remedy === "fit_gear")) {
      const call = callControl(seat);
      if (call) return { control: call };
    }
    return { openLabel: t(REMEDY_KEYS[remedy === "send_waiver" ? "open" : remedy]) };
  };

  const reminderLine = (at: Date) =>
    t("trips.fixList.reminderAt", { when: formatWeekdayTime(at, trip.locale, trip.shopTimezone) });
  const fixRow = (item: FixItem, tone: FixListRow["tone"], saysReminder = true): DraftRow => {
    const seat = byId.get(item.guestId);
    const {
      control = null,
      openLabel = null,
      panelHoldsControl = false,
    } = remedyControl(item.remedy, seat);
    const reminder =
      saysReminder &&
      seat?.reminderAt &&
      item.reasons.length > 0 &&
      (phase === "filling" || phase === "ready")
        ? reminderLine(seat.reminderAt)
        : null;
    const phrase = [phraseOf(item, seat), reminder].filter(Boolean).join(" · ") || null;
    return {
      key: item.guestId,
      guestIds: [item.guestId],
      // A guest who arrived and then went blocked says so (domain review of layer B, F3).
      phrase:
        tone === "danger" && seat?.guest.checkedIn && phrase
          ? t("trips.fixList.here", { reason: phrase })
          : phrase,
      tone,
      control,
      arrivalControl:
        mode === "checkin" && seat?.guest.checkedIn ? arrival?.controls.get(item.guestId) : null,
      panelHoldsArrival: seat?.panelHoldsArrival,
      openLabel,
      panelHoldsControl,
    };
  };

  /** A plain row: the guest's name, what they come as, and the desk's tap. */
  const plainRow = (id: string, phrase?: string | null): DraftRow => {
    const seat = byId.get(id);
    const tap = arrival?.controls.get(id) ?? null;
    return {
      key: id,
      guestIds: [id],
      phrase: phrase !== undefined ? phrase : seat ? kindPhrase(seat) : null,
      tone: "muted",
      control: tap ? () => tap : null,
      tap: true,
      openLabel: null,
      panelHoldsControl: seat?.panelHoldsArrival ?? false,
    };
  };

  const folded = (
    key: string,
    label: string,
    ids: string[],
    mark: "success" | "none",
  ): DraftSection => ({
    key,
    label,
    tone: "default",
    folded: { names: listFormat.format(ids.map(nameOf)), mark },
    rows: ids.map((id) => plainRow(id)),
  });

  const tripRows = (tone: TripFix["tone"]): DraftRow[] =>
    tripFixes
      .filter((fix) => fix.tone === tone)
      .map((fix) => ({
        key: `trip:${fix.key}`,
        guestIds: [],
        title: fix.text,
        phrase: null,
        tone,
        control: (variant) => (
          <Link href={fix.action.href} className={buttonClass({ variant, size: "sm" })}>
            {fix.action.label}
          </Link>
        ),
        openLabel: null,
      }));

  /** One send that reaches every guest in a group whose waiver is the worst thing left. */
  const askAll = (items: readonly FixItem[]): ReactNode | null => {
    const ids = items.filter((item) => item.remedy === "send_waiver").map((item) => item.guestId);
    if (ids.length < 2 || !ids.every((id) => byId.get(id)?.waiverSendable)) return null;
    return (
      <WaiverSendControl
        surface="roster"
        tripId={trip.tripId}
        bookingIds={ids}
        label={t("trips.fixList.askAll", { count: ids.length })}
        pendingLabel={t("words.busy.sending")}
        className={buttonClass({ variant: "secondary", size: "sm" })}
        wrapperClassName=""
        copy={waiverSendCopy(t)}
      />
    );
  };

  const released = [
    folded("notHere", t("trips.fixList.groups.notHere"), list.notHere, "none"),
    folded("turnedAway", t("trips.fixList.groups.turnedAway"), list.turnedAway, "none"),
  ];

  const cantBoard: DraftSection = {
    key: "cantBoard",
    label: t("trips.fixList.groups.cantBoard"),
    tone: "danger",
    action: askAll(list.blocking),
    rows: [...tripRows("danger"), ...list.blocking.map((item) => fixRow(item, "danger"))],
  };
  const worth: DraftSection = {
    key: "worth",
    label: t("trips.fixList.groups.worth"),
    tone: "default",
    action: askAll(list.worthAMinute),
    rows: [...tripRows("warning"), ...list.worthAMinute.map((item) => fixRow(item, "warning"))],
  };

  const booked = seats.filter((seat) => !seat.guest.released).map((seat) => seat.guest.id);
  // Filling's rows: quiet for the day's routine, warning for the rest (`quietOnFilling`).
  const sharedReminder = sharedReminderOf([...list.blocking, ...list.worthAMinute], byId);
  const quietRows = [
    ...list.blocking.map((item) => fixRow(item, "warning", !sharedReminder)),
    ...list.worthAMinute.map((item) =>
      fixRow(item, quietOnFilling(item.reasons) ? "muted" : "warning", !sharedReminder),
    ),
  ].map((row) => ({ ...row, control: null, openLabel: null }));
  const drafts: DraftSection[] =
    phase === "listed"
      ? [folded("booked", t("trips.fixList.booked"), booked, "none"), ...released]
      : phase === "filling"
        ? [
            {
              key: "booked",
              label: t("trips.fixList.booked"),
              tone: "default",
              note: sharedReminder ? reminderLine(sharedReminder) : undefined,
              summary: {
                label: t("trips.clock.sentence.guestCount", { count: list.fine.length }),
                phrase: t("trips.fixList.nothingYet"),
                toggle: t("trips.fixList.allGuests"),
                rows: list.fine.map((id) => plainRow(id)),
              },
              // Days ahead a guest's reason is said quietly, opened in place;
              // the trip's own fixes (a hull booked twice) keep their door.
              rows: [...tripRows("danger"), ...tripRows("warning"), ...quietRows],
            },
            ...released,
          ]
        : phase === "ready"
          ? [
              cantBoard,
              worth,
              {
                key: "fine",
                label: t("trips.fixList.groups.fine"),
                tone: "default",
                headless: true,
                summary: {
                  label: t("trips.fixList.ready", { count: list.fine.length }),
                  phrase: t("trips.fixList.readyPhrase"),
                  toggle: t("trips.fixList.allGuests"),
                  rows: list.fine.map((id) => plainRow(id)),
                },
                after,
                rows: [],
              },
              ...released,
            ]
          : [
              cantBoard,
              ...(mode === "checkin"
                ? [
                    {
                      key: "toCome",
                      label: t("trips.fixList.groups.toCome"),
                      tone: "default" as const,
                      rows: list.toCome.map((item) => ({
                        ...plainRow(item.guestId, phraseOf(item, byId.get(item.guestId))),
                        tone: item.reasons.length > 0 ? ("warning" as const) : ("muted" as const),
                      })),
                    },
                  ]
                : []),
              worth,
              folded(
                "fine",
                t(mode === "checkin" ? "trips.fixList.groups.here" : "trips.fixList.groups.fine"),
                list.fine,
                "success",
              ),
              ...released,
            ];

  const guests: FixListGuest[] = seats.map(({ entry }) => {
    const seat = rosterSeat(entry, false, context);
    return {
      id: entry.booking.id,
      name: entry.person.fullName,
      photoPath: seat.identityUnconfirmed ? null : diverPhotoDisplayPath(entry.person),
      panel: (
        <RosterRow
          entry={entry}
          settled={false}
          context={{ ...context, sharedAdvisoryTexts: new Set() }}
          folio
        />
      ),
    };
  });

  // The desk is finished only when nobody who has arrived still owes it
  // something; the bar's cleared line waits on this.
  const deskWorkOpen =
    list.blocking.some((item) => byId.get(item.guestId)?.guest.checkedIn) ||
    (mode === "checkin" && list.worthAMinute.length > 0);

  return { sections: weighted(drafts), guests, deskWorkOpen };
}

/**
 * The one primary on the list (design review of the final screens, finding 5):
 * the first row, in reading order, that is a fix, never the desk's Check in.
 * Every other fix is secondary, so nothing competes with it or with Roll call.
 */
function weighted(drafts: readonly DraftSection[]): FixListSection[] {
  let primaryTaken = false;
  const resolve = (row: DraftRow, folded: boolean): FixListRow => {
    const fix = !row.tap && (row.control !== null || row.openLabel !== null);
    const primary = fix && !folded && !primaryTaken;
    if (primary) primaryTaken = true;
    const { tap: _tap, ...rest } = row;
    return {
      ...rest,
      control: row.control ? row.control(primary ? "primary" : "secondary") : null,
      primary,
    };
  };
  return drafts.map((section) => ({
    ...section,
    summary: section.summary
      ? { ...section.summary, rows: section.summary.rows.map((row) => resolve(row, true)) }
      : undefined,
    rows: section.rows.map((row) => resolve(row, Boolean(section.folded))),
  }));
}
