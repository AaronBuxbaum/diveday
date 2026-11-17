import Link from "next/link";
import type { ReactNode } from "react";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { buttonClass } from "@/components/ui/button";
import type { STAFF_RE_ENTRY_KEYS } from "@/features/dive-intent";
import {
  type AdvisoryReason,
  type FixGuest,
  type FixItem,
  type FixListMode,
  type FixReason,
  type FixRemedy,
  fixListOf,
} from "@/features/trip-fix-list";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { staffParticipantTypeLabel } from "@/i18n/staff-participant-labels";
import { formatMoneyCents } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { firstNameOf } from "@/lib/person-name";
import { diverPhotoDisplayPath } from "@/lib/person-photo";
import { rentalFitCompleteness } from "@/lib/rentals";
import type { FixListGuest, FixListNamePart, FixListRow, FixListSection } from "./GuestFixList";
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

/**
 * Which part of the trip's day the list is drawn for (ADR 20261117-trip-page-clock):
 * `filling` days ahead (one quiet Booked card), `ready` the day before (the
 * remote remedies), `checkin` at the desk, `after` once the boat has left.
 */
export type FixListPhase = "filling" | "ready" | "checkin" | "after" | "listed";

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
  sendWaiver: ReactNode | null;
  /** A link can reach this guest alone, so a group send may include them. */
  waiverSendable: boolean;
  /** What a payment fix would take, formatted in the shop's currency. */
  owed: string | null;
  cardsHref: string;
  /** The depth sentence this guest shares with much of the boat, if any. */
  sharedDepth: string | null;
};

/**
 * **One guest, read for the fix list**: the codes behind the reason lines the
 * row already says (readiness blockers, then each advisory line), so the list
 * and the opened guest can never disagree about what holds someone up.
 */
function seatOf(entry: RosterEntry, context: RosterRowContext): Seat {
  const { booking, person } = entry;
  const { rows, arrival, t, trip } = context;
  // Read against the boat's shared depth sentences: one much of the boat
  // shares is said once, on its own line, not on every row (principle 9).
  const seat = rosterSeat(entry, false, context);
  const { reasonLines } = rowReasonLines({ ...seat, ...rowNotices(seat) });
  const blocked = seat.readiness?.status === "blocked";
  // A held seat says only its own reasons (`heldSeatBlockers`); a blocked
  // reading with none said still blocks.
  const blockers = blocked
    ? seat.blockerTexts.length
      ? seat.blockerTexts.map(({ blocker }) => blocker.code)
      : (seat.readiness?.blockers.map((blocker) => blocker.code) ?? ["readiness_unavailable"])
    : [];
  const advisories: AdvisoryReason[] = reasonLines.flatMap((line) => {
    const reason = LINE_REASONS[line.key];
    return reason ? [reason] : [];
  });
  if (booking.reEntryAsk && seat.showsPersonDetail) advisories.push("re_entry_ask");
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
  // One tap sends the link only to a guest a link can reach; a party's or a
  // counter guest's release is signed through its queue, on the opened guest.
  const reachable = Boolean(person.email) || rows.textableBookings.has(booking.id);
  const control = seat.waiverControl;
  const waiverSendable = Boolean(
    control.action && reachable && !partyLead && !seat.identityUnconfirmed,
  );
  const sendWaiver = waiverSendable ? (
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
      className={buttonClass({ variant: "primary", size: "sm" })}
      wrapperClassName=""
      copy={waiverSendCopy(t)}
    />
  ) : null;
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
    owed,
    cardsHref: `/shop/${trip.shopSlug}/divers/${person.id}#cards`,
    sharedDepth: seat.depthShared && seat.depthText !== null ? seat.depthText : null,
  };
}

/**
 * **The guest list's sections and rows** for `GuestFixList`, by phase:
 *
 * - `checkin`: Can't board yet, To come with Check in, Worth a minute, then
 *   Here folded.
 * - `ready`: Can't board yet and Worth a minute with the remote remedies (send
 *   the waiver again, call), then "N guests are ready" with the crew line.
 * - `filling`: one quiet Booked card: everyone fine as one counted line, then
 *   whoever will need something later, without a button.
 * - `after`: Can't board yet, then everyone else folded; a check-in advisory
 *   no longer holds anyone out of the fold.
 * - `listed`: everyone who was booked, by name, with nothing to make ready: a
 *   cancelled trip, or a wrapped-up one with no roll call taken.
 *
 * Released guests fold under Not here and Turned away. A trip-level fix
 * (`tripFixes`) leads its group.
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
    const ask = seat?.entry.booking.reEntryAsk;
    if (reason === "re_entry_ask" && ask) return t(RE_ENTRY_PHRASE_KEYS[ask]);
    return t(reasonKey(reason));
  };

  const phraseOf = (item: FixItem, seat: Seat | undefined): string | null => {
    if (!item.reason) return seat ? kindPhrase(seat) : null;
    const reason = reasonText(item.reason, seat);
    return item.more > 0 ? t("trips.fixList.more", { reason, count: item.more }) : reason;
  };

  const callControl = (seat: Seat) => {
    const phone = seat.entry.person.phone;
    if (!phone) return null;
    return (
      <a href={`tel:${phone}`} className={buttonClass({ variant: "primary", size: "sm" })}>
        {t("trips.fixList.remedy.call", {
          name: firstNameOf(seat.entry.person.fullName, seat.entry.person.fullName),
        })}
      </a>
    );
  };

  const remedyControl = (
    remedy: FixRemedy,
    seat: Seat | undefined,
  ): { control?: ReactNode; openLabel?: string; panelHoldsControl?: boolean } => {
    if (remedy === "send_waiver" && seat?.sendWaiver)
      return { control: seat.sendWaiver, panelHoldsControl: true };
    if (remedy === "review_cards" && seat)
      return {
        control: (
          <Link href={seat.cardsHref} className={buttonClass({ variant: "primary", size: "sm" })}>
            {t(REMEDY_KEYS.review_cards)}
          </Link>
        ),
      };
    if (remedy === "take_payment" && seat?.owed)
      return { openLabel: t("trips.fixList.remedy.takeAmount", { amount: seat.owed }) };
    // The day before, what nobody can do from the desk is a call away.
    if (phase === "ready" && seat && (remedy === "open" || remedy === "fit_gear")) {
      const call = callControl(seat);
      if (call) return { control: call };
    }
    return { openLabel: t(REMEDY_KEYS[remedy === "send_waiver" ? "open" : remedy]) };
  };

  /** One send that reaches every guest a shared waiver row names, when a link reaches each. */
  const askAll = (item: FixItem): ReactNode | null => {
    const group = item.guestIds.map((id) => byId.get(id));
    if (
      item.remedy !== "send_waiver" ||
      group.length < 2 ||
      !group.every((seat) => seat?.waiverSendable)
    )
      return null;
    return (
      <WaiverSendControl
        surface="roster"
        tripId={trip.tripId}
        bookingIds={item.guestIds}
        label={t("trips.fixList.askAll", { count: item.guestIds.length })}
        pendingLabel={t("words.busy.sending")}
        className={buttonClass({ variant: "secondary", size: "sm" })}
        wrapperClassName=""
        copy={waiverSendCopy(t)}
      />
    );
  };

  const nameParts = (ids: string[]): FixListNamePart[] => {
    let next = 0;
    return listFormat.formatToParts(ids.map(nameOf)).map((part) => {
      if (part.type !== "element") return { text: part.value };
      const id = ids[next];
      next += 1;
      return { id, text: part.value };
    });
  };

  const fixRow = (item: FixItem, tone: FixListRow["tone"], key: string): FixListRow => {
    const seat = item.guestIds.length === 1 ? byId.get(item.guestIds[0] ?? "") : undefined;
    const {
      control = null,
      openLabel = null,
      panelHoldsControl = false,
    } = remedyControl(item.remedy, seat);
    const phrase = phraseOf(item, seat);
    return {
      key,
      guestIds: item.guestIds,
      names: item.guestIds.length > 1 ? nameParts(item.guestIds) : undefined,
      // A guest who arrived and then went blocked says so (domain review of layer B, F3).
      phrase:
        tone === "danger" && seat?.guest.checkedIn && phrase
          ? t("trips.fixList.here", { reason: phrase })
          : phrase,
      tone,
      control: seat ? control : askAll(item),
      openLabel: seat ? openLabel : null,
      panelHoldsControl,
    };
  };

  /** A plain row: the guest's name, what they come as, and the desk's tap. */
  const plainRow = (id: string, phrase?: string | null): FixListRow => {
    const seat = byId.get(id);
    return {
      key: id,
      guestIds: [id],
      phrase: phrase !== undefined ? phrase : seat ? kindPhrase(seat) : null,
      tone: "muted",
      control: arrival?.controls.get(id) ?? null,
      openLabel: null,
    };
  };

  const folded = (key: string, label: string, ids: string[], mark: "success" | "none") => ({
    key,
    label,
    tone: "default" as const,
    folded: { names: listFormat.format(ids.map(nameOf)), mark },
    rows: ids.map((id) => plainRow(id)),
  });

  const tripRows = (tone: TripFix["tone"]): FixListRow[] =>
    tripFixes
      .filter((fix) => fix.tone === tone)
      .map((fix) => ({
        key: `trip:${fix.key}`,
        guestIds: [],
        title: fix.text,
        phrase: null,
        tone,
        control: (
          <Link
            href={fix.action.href}
            className={buttonClass({
              variant: tone === "danger" ? "primary" : "secondary",
              size: "sm",
            })}
          >
            {fix.action.label}
          </Link>
        ),
        openLabel: null,
      }));

  const released = [
    folded("notHere", t("trips.fixList.groups.notHere"), list.notHere, "none"),
    folded("turnedAway", t("trips.fixList.groups.turnedAway"), list.turnedAway, "none"),
  ];

  const cantBoard: FixListSection = {
    key: "cantBoard",
    label: t("trips.fixList.groups.cantBoard"),
    tone: "danger",
    rows: [
      ...tripRows("danger"),
      ...list.blocking.map((item) => fixRow(item, "danger", item.guestIds.join())),
    ],
  };
  const worth: FixListSection = {
    key: "worth",
    label: t("trips.fixList.groups.worth"),
    tone: "default",
    rows: [
      ...tripRows("warning"),
      ...sharedDepthRows(seats, nameParts, t),
      ...list.worthAMinute.map((item) => fixRow(item, "warning", item.guestIds.join())),
    ],
  };

  const booked = seats.filter((seat) => !seat.guest.released).map((seat) => seat.guest.id);
  const sections: FixListSection[] =
    phase === "listed"
      ? [
          {
            key: "booked",
            label: t("trips.fixList.booked"),
            tone: "default",
            rows: booked.map((id) => plainRow(id)),
          },
          ...released,
        ]
      : phase === "filling"
        ? [
            {
              key: "booked",
              label: t("trips.fixList.booked"),
              tone: "default",
              summary: {
                label: t("trips.clock.sentence.guestCount", { count: list.fine.length }),
                phrase: t("trips.fixList.nothingYet"),
                toggle: t("trips.fixList.allGuests"),
                rows: list.fine.map((id) => plainRow(id)),
              },
              // Days ahead nothing is urgent: each reason is said quietly, and the
              // guest opens in place for whoever wants to act on it now.
              rows: [...list.blocking, ...list.worthAMinute].map((item) => ({
                ...fixRow(item, "warning", item.guestIds.join()),
                control: null,
                openLabel: null,
              })),
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
                        ...plainRow(
                          item.guestIds[0] ?? "",
                          phraseOf(item, byId.get(item.guestIds[0] ?? "")),
                        ),
                        tone: item.reason ? ("warning" as const) : ("muted" as const),
                      })),
                    },
                  ]
                : []),
              // Once the boat has left, a check-in advisory is no longer worth a
              // minute: its guest folds in with everyone else.
              ...(phase === "after" ? [] : [worth]),
              folded(
                "fine",
                t(mode === "checkin" ? "trips.fixList.groups.here" : "trips.fixList.groups.fine"),
                phase === "after"
                  ? [
                      ...new Set([
                        ...list.fine,
                        ...list.worthAMinute.flatMap((item) => item.guestIds),
                      ]),
                    ]
                  : list.fine,
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
    list.blocking.some((item) => item.guestIds.some((id) => byId.get(id)?.guest.checkedIn)) ||
    (mode === "checkin" && list.worthAMinute.length > 0);

  return { sections, guests, deskWorkOpen };
}

/** Each depth note much of the boat shares: one row naming everyone, in a few words. */
function sharedDepthRows(
  seats: readonly Seat[],
  nameParts: (ids: string[]) => FixListNamePart[],
  t: StaffTranslator,
): FixListRow[] {
  const bySentence = new Map<string, string[]>();
  for (const seat of seats) {
    if (!seat.sharedDepth || seat.guest.released) continue;
    bySentence.set(seat.sharedDepth, [...(bySentence.get(seat.sharedDepth) ?? []), seat.guest.id]);
  }
  // The whole sentence is on each opened guest; the row says what it is about.
  return [...bySentence].map(([sentence, ids]) => ({
    key: `depth:${sentence}`,
    guestIds: ids,
    names: nameParts(ids),
    phrase: t(reasonKey("depth")),
    tone: "warning",
    control: null,
    openLabel: null,
  }));
}
