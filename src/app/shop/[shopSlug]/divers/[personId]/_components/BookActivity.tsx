import { seatExistingDiverAction } from "@/app/actions/seat-diver";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, groupByLocalDay } from "@/lib/calendar-date";
import { formatTime } from "@/lib/format";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile, Shop, UpcomingTrip } from "./shared";

/**
 * **"Book a departure" — the record's one primary act**, and the picker it
 * discloses in place (ADR 20260827-people-not-lists, decision 1).
 *
 * It used to be a section of its own two thirds of the way down a ~6,400px
 * scroll, under a heading, above a second list of the same bookings. The form
 * itself is unchanged: it books by identity (`personId`), not by re-submitting
 * a name and email — the person is already open on screen, and re-entering
 * them risked a second person row for the same human. Through the shared
 * `seatExistingDiverAction`, this door owes the same consequences as every
 * other, including the waiver-on-join it used to skip entirely.
 *
 * The disclosure's `<summary>` is the page's **only** primary-weight control;
 * the submit inside it is secondary, because once the picker is open the
 * choice — not the button — is the work.
 */
export function BookActivity({
  diver,
  shop,
  locale,
  t,
  status,
  upcoming,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shop: Shop;
  locale: string;
  t: StaffTranslator;
  /**
   * This form's own outcome: the seat that landed, or the gate that refused
   * it. A cert refusal in particular is the one a staffer most needs beside
   * the picker they just used, since the next move is choosing a different
   * trip. A notice also holds the disclosure open — an answer inside a shut
   * one is invisible.
   */
  status?: DiverNotice;
  upcoming: UpcomingTrip[];
  shopSlug: string;
  personId: string;
}) {
  return (
    <details open={Boolean(status)} className="group open:w-full">
      <summary
        id="book-departure"
        className={buttonClass({
          className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {t("divers.bookActivity.bookDeparture")}
        <DisclosureCaret direction="down" className="group-open:rotate-180" />
      </summary>
      <form
        action={seatExistingDiverAction.bind(null, "diver-record", shopSlug)}
        className={sectionCardClass({ className: "mt-3 w-full" })}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="personId" value={personId} />
          <FieldGrid columns={1} className="flex-1">
            <Field label={t("divers.bookActivity.courseOrDiveLabel")}>
              <select name="tripId" required defaultValue="" className={controlClass}>
                <option value="" disabled>
                  {t("divers.bookActivity.chooseActivity")}
                </option>
                {/*
                 * Grouped by departure day, not one flat list. Staff seating a
                 * diver are working from a date the person just said out loud
                 * ("Saturday"), and a flat list repeated that date on every row
                 * while giving them nothing to scan *by*.
                 */}
                {groupByLocalDay(upcoming, shop.timezone, (trip) => trip.startsAt).map((group) => (
                  <optgroup key={group.day} label={formatCalendarDate(group.day, locale)}>
                    {group.items.map((trip) => (
                      <option key={trip.id} value={trip.id}>
                        {formatTime(trip.startsAt, locale, shop.timezone)} ·{" "}
                        {trip.course ? `${trip.course.title} — ` : ""}
                        {trip.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <SubmitButton
              pendingLabel={t("divers.bookActivity.booking")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("divers.bookActivity.bookActivityButton")}
            </SubmitButton>
            <DiverFormStatus status={status} />
          </div>
        </div>
        {/* Not a refusal — a heads-up. The seat is real either way; the waiver
            link just has nowhere to be emailed, so somebody has to hand it over. */}
        {diver.person.email ? null : (
          <p className="mt-3 text-sm text-muted">{t("divers.bookActivity.noEmailNote")}</p>
        )}
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("divers.bookActivity.noOpenActivities")}</p>
        ) : null}
      </form>
    </details>
  );
}
