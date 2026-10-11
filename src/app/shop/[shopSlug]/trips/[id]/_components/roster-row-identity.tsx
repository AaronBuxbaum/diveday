import { IdentityCheck } from "@/components/IdentityCheck";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { identityCheckWords } from "@/i18n/identity-check-labels";
import { rentalItemLabel } from "@/i18n/rental-labels";
import { maxPlausibleBirthDate } from "@/lib/age";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { displayStoredPhoneWhole } from "@/lib/forgiving-fields";
import { formatShortDate, formatTimeTz } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { isDiver } from "@/lib/participant-types";
import { type RentableItemKind, toRentableKinds } from "@/lib/rentals";
import type { RowHeader } from "./roster-row-header";
import type { RowNotices } from "./roster-row-notices";
import type { RowReasonLines } from "./roster-row-reasons";
import type { RosterSeat } from "./roster-seat";

/** A held seat's identity: who to contact, and the two answers that settle it. */
export function rowIdentity(seat: RosterSeat & RowHeader & RowNotices & RowReasonLines) {
  const {
    booking,
    person,
    t,
    arrival,
    shopTimezone,
    locale,
    splitAsksDateOfBirth,
    sameNameHeldSeats,
    heldSeatLastDiveDay,
    packageDivesByBooking,
    confirmIdentityAction,
    splitIdentityAction,
    identityUnconfirmed,
  } = seat;
  const identityContact = identityUnconfirmed ? (
    <div
      className={`flex flex-wrap items-center gap-x-3 text-sm ${arrival ? "mt-2" : "-mt-1 pb-2"}`}
      data-testid="identity-contact"
    >
      {person.email || person.phone ? (
        <>
          <span className="text-muted">
            {t("shared.identityCheck.contactOnFile", { name: person.fullName })}
          </span>
          {person.email ? (
            <a
              href={mailtoHref(person.email)}
              className={buttonClass({
                variant: "link",
                size: "sm",
                flush: true,
                className: "[overflow-wrap:anywhere]",
              })}
            >
              {person.email}
            </a>
          ) : null}
          {person.phone ? (
            <a
              href={telHref(person.phone)}
              className={buttonClass({ variant: "link", size: "sm", flush: true })}
            >
              {displayStoredPhoneWhole(person.phone)}
            </a>
          ) : null}
        </>
      ) : (
        <span className="text-muted">
          {t("shared.identityCheck.noContactOnFile", { name: person.fullName })}
        </span>
      )}
      {/* `sendDueReminders` sends a held seat no week-out or night-before
          reminder until this is confirmed (issue #2124), so the desk can ring
          ahead rather than learn it from an unprepared diver on the day. */}
      <span className="basis-full text-muted">{t("shared.identityCheck.remindersHeld")}</span>
    </div>
  ) : null;
  /**
   * **A held seat's two answers stand in the open, under its reason line**
   * (Aaron, 2026-10-05). The seat attached itself to an existing diver on
   * something short of proof — a reused email under a different name
   * (H-13), or a name tapped off the counter's prompt (issue #1556) — and
   * the reason line names both people. "Same person" is a blocking confirm,
   * not an undo banner: it hands the matched diver's cards and waiver to
   * this seat (docs/design/principles.md §7). "Different person" splits the
   * seat into its own record. Like the medical hold, it is a decision about
   * who may board, so it does not wait behind the row's mark.
   */
  /**
   * **Unspent package dives, said before anyone takes the fare** (issue
   * #1697, H-79: the fare stands). A seat booked while the diver held a
   * covering dive spent it at booking; this line is for the seats that did
   * not, chiefly one held on an unconfirmed identity, where coverage waits for
   * "Same person" (`settleConfirmedPackageCoverage`) and cash taken first
   * would stand beside a package still holding every dive. A held seat names
   * no count: the dives are the matched person's, and the row says only that
   * confirming comes first. A snorkeler's or rider's seat spends no dives.
   */
  const packageDives = isDiver(booking.participantType)
    ? (packageDivesByBooking?.get(booking.id) ?? 0)
    : 0;
  const packageNote =
    packageDives === 0
      ? null
      : identityUnconfirmed
        ? t("trips.roster.packageDivesUnusedHeld", { name: person.fullName })
        : t("trips.roster.packageDivesUnused", { count: packageDives });
  const sameNameSeats = sameNameHeldSeats?.get(booking.id) ?? [];
  /**
   * **The one fact the attestation turns on** (issue #1789, H-79): the
   * matched diver's last dive day at this shop, beside the question. It is the
   * same line the name-match prompt shows staff who seat a diver, and nothing
   * else from the matched record joins it here. Only a staff-seated hold saw
   * it before: an online hold (a public booking that reused an email under
   * another name, H-13) met no prompt, so the roster is the first place any
   * staffer reads it.
   *
   * "No dive days here yet" is said every time, unlike the name-match
   * prompt's sibling rule (`noDiveDayNeedsSaying`), which goes quiet when
   * every candidate lacks a day. That rule compares a list; this is one
   * deliberate question about one person, and for a walk-in who has never
   * been here the blank is itself the answer.
   */
  const heldSeatLastDive = identityUnconfirmed ? heldSeatLastDiveDay?.get(booking.id) : undefined;
  const heldSeatEvidence =
    heldSeatLastDive === undefined
      ? undefined
      : heldSeatLastDive
        ? t("divers.page.confirmMatchesLastDive", {
            date: formatShortDate(heldSeatLastDive, locale, shopTimezone),
          })
        : t("divers.page.confirmMatchesNoDiveDay");
  const paidGear = identityUnconfirmed
    ? toRentableKinds(booking.paidRentalKinds ?? []).filter(
        (kind): kind is RentableItemKind => kind !== "nitrox",
      )
    : [];
  const identityCheck = identityUnconfirmed ? (
    <IdentityCheck
      bookingId={booking.id}
      bookedAs={booking.identityBookedAs}
      words={identityCheckWords(t, person.fullName)}
      splitAction={splitIdentityAction}
      asksDateOfBirth={splitAsksDateOfBirth || sameNameSeats.some((seat) => seat.asksDateOfBirth)}
      maxDateOfBirth={maxPlausibleBirthDate()}
      sameNameSeats={
        sameNameSeats.length > 0 && booking.identityBookedAs
          ? {
              label: t("shared.identityCheck.sameNameSeats", {
                count: sameNameSeats.length,
                bookedAs: booking.identityBookedAs,
                departures: cachedListFormat(locale, { type: "conjunction" }).format(
                  sameNameSeats.map((seat) =>
                    t("shared.identityCheck.sameNameDeparture", {
                      date: formatShortDate(seat.startsAt, locale, shopTimezone),
                      // The time too, so a same-day morning and afternoon
                      // run can be told apart (dive-domain re-review).
                      time: formatTimeTz(seat.startsAt, locale, shopTimezone),
                      trip: seat.tripTitle,
                    }),
                  ),
                ),
              }),
              bookingIds: sameNameSeats.map((seat) => seat.bookingId),
            }
          : undefined
      }
      className="pb-3"
      confirm={
        <form action={confirmIdentityAction}>
          <input type="hidden" name="bookingId" value={booking.id} />
          {/* What this seat paid for at checkout waited on the booking while
              it was held; "Same person" may carry it to the standing fit,
              ticked, and the staffer may decline (dive-domain review). */}
          {paidGear.length > 0 ? (
            <ChoiceRow type="checkbox" name="applyPaidGear" defaultChecked className="pb-2">
              {t("trips.roster.applyPaidGear", {
                pieces: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
                  paidGear.map((kind) => rentalItemLabel(t, kind)),
                ),
              })}
            </ChoiceRow>
          ) : null}
          <InlineConfirm
            triggerLabel={t("shared.identityCheck.same")}
            ariaLabel={t("shared.identityCheck.sameAria", { name: person.fullName })}
            message={t("trips.roster.confirmIdentityMessage", { name: person.fullName })}
            evidence={heldSeatEvidence}
            confirmLabel={t("trips.roster.identityConfirmButton")}
            cancelLabel={t("trips.roster.neverMind")}
            pendingLabel={t("trips.roster.confirming")}
            triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
          />
        </form>
      }
    />
  ) : null;
  return { identityContact, packageNote, identityCheck };
}

export type RowIdentity = ReturnType<typeof rowIdentity>;
