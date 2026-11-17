import Link from "next/link";
import type { ReactNode } from "react";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { buttonClass } from "@/components/ui/button";
import {
  type AdvisoryReason,
  type FixGuest,
  type FixItem,
  type FixListMode,
  type FixReason,
  type FixRemedy,
  fixListOf,
} from "@/features/trip-fix-list";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import { staffParticipantTypeLabel } from "@/i18n/staff-participant-labels";
import { cachedListFormat } from "@/lib/intl-cache";
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
  cardsHref: string;
};

/**
 * **One guest, read for the fix list**: the codes behind the reason lines the
 * row already says (readiness blockers, then each advisory line), so the list
 * and the opened guest can never disagree about what holds someone up.
 */
function seatOf(entry: RosterEntry, context: RosterRowContext): Seat {
  const { booking, person } = entry;
  const { rows, arrival, t, trip } = context;
  const seat = rosterSeat(entry, false, { ...context, sharedAdvisoryTexts: new Set() });
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
  const sendWaiver =
    control.action && reachable && !partyLead && !seat.identityUnconfirmed ? (
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
        className={buttonClass({ variant: control.variant, size: "sm" })}
        wrapperClassName=""
        copy={waiverSendCopy(t)}
      />
    ) : null;
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
    cardsHref: `/shop/${trip.shopSlug}/divers/${person.id}#cards`,
  };
}

/**
 * **The guest list's sections and rows** for `GuestFixList`, in `mode`:
 * `checkin` while the desk is open (Can't board yet, To come with Check in,
 * Worth a minute, then Here folded), `all` otherwise (Can't board yet, Worth a
 * minute, then everyone else folded). Released guests fold under Not here and
 * Turned away.
 */
export function guestFixRows(
  context: RosterRowContext,
  { mode }: { mode: FixListMode },
): { sections: FixListSection[]; guests: FixListGuest[]; deskWorkOpen: boolean } {
  const { t, rows, arrival, trip } = context;
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

  const phraseOf = (item: FixItem, seat: Seat | undefined): string | null => {
    if (!item.reason) return seat ? kindPhrase(seat) : null;
    const reason = t(reasonKey(item.reason));
    return item.more > 0 ? t("trips.fixList.more", { reason, count: item.more }) : reason;
  };

  const remedyControl = (remedy: FixRemedy, seat: Seat | undefined) => {
    if (remedy === "send_waiver" && seat?.sendWaiver) return { control: seat.sendWaiver };
    if (remedy === "review_cards" && seat)
      return {
        control: (
          <Link href={seat.cardsHref} className={buttonClass({ variant: "primary", size: "sm" })}>
            {t(REMEDY_KEYS.review_cards)}
          </Link>
        ),
      };
    return { openLabel: t(REMEDY_KEYS[remedy === "send_waiver" ? "open" : remedy]) };
  };

  const fixRow = (item: FixItem, tone: FixListRow["tone"], key: string): FixListRow => {
    const seat = item.guestIds.length === 1 ? byId.get(item.guestIds[0] ?? "") : undefined;
    const { control = null, openLabel = null } = remedyControl(item.remedy, seat) as {
      control?: ReactNode;
      openLabel?: string;
    };
    return {
      key,
      guestIds: item.guestIds,
      names: item.guestIds.length > 1 ? nameParts(item.guestIds) : undefined,
      phrase: phraseOf(item, seat),
      tone,
      control: seat ? control : null,
      openLabel: seat ? openLabel : null,
    };
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

  const sections: FixListSection[] = [
    {
      key: "cantBoard",
      label: t("trips.fixList.groups.cantBoard"),
      tone: "danger",
      rows: list.blocking.map((item) => fixRow(item, "danger", item.guestIds.join())),
    },
    {
      key: "toCome",
      label: t("trips.fixList.groups.toCome"),
      tone: "default",
      rows: list.toCome.map((item) => ({
        ...plainRow(item.guestIds[0] ?? "", phraseOf(item, byId.get(item.guestIds[0] ?? ""))),
        tone: item.reason ? ("warning" as const) : ("muted" as const),
      })),
    },
    {
      key: "worth",
      label: t("trips.fixList.groups.worth"),
      tone: "default",
      rows: list.worthAMinute.map((item) => fixRow(item, "warning", item.guestIds.join())),
    },
    folded(
      "fine",
      t(mode === "checkin" ? "trips.fixList.groups.here" : "trips.fixList.groups.fine"),
      list.fine,
      "success",
    ),
    folded("notHere", t("trips.fixList.groups.notHere"), list.notHere, "none"),
    folded("turnedAway", t("trips.fixList.groups.turnedAway"), list.turnedAway, "none"),
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
