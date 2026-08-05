import { seatExistingDiverAction } from "@/app/actions/seat-diver";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, groupByLocalDay } from "@/lib/calendar-date";
import { formatTime } from "@/lib/format";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile, Shop, UpcomingTrip } from "./shared";

/**
 * "Book them on an upcoming trip", from the diver's own record.
 *
 * Books by identity (`personId`), not by re-submitting a name and email — the
 * person is already open on screen, and re-entering them risked a second
 * person row for the same human. That is also why the form no longer demands
 * an email: a diver on file with no address is exactly the counter walk-in
 * `createBooking` already supports (src/db/bookings.ts), and refusing to book
 * them here was a dead end with no way out but editing the record first.
 * Through the shared `seatExistingDiverAction`, this door now owes the same
 * consequences as every other — including the waiver-on-join it used to skip
 * entirely, which sent divers booked from here to the dock unsigned.
 */
export function BookActivity({
  diver,
  shop,
  locale,
  status,
  upcoming,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shop: Shop;
  locale: string;
  /**
   * This section's own outcome: the seat that landed, or the gate that refused
   * it. A cert refusal in particular is the one a staffer most needs beside the
   * picker they just used, since the next move is choosing a different trip.
   */
  status?: DiverNotice;
  upcoming: UpcomingTrip[];
  shopSlug: string;
  personId: string;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="book-activity-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="book-activity-heading" className="text-lg font-semibold">
            {t("divers.bookActivity.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("divers.bookActivity.description")}</p>
        </div>
      </div>
      <form
        action={seatExistingDiverAction.bind(null, "diver-record", shopSlug)}
        className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-end"
      >
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
               * while giving them nothing to scan *by* — several boats on one
               * day looked identical until you read to the end of each line.
               * The day is now the group heading, so each row only has to say
               * what the outing is and what time it leaves.
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
            className={buttonClass({ size: "lg" })}
          >
            {t("divers.bookActivity.bookActivityButton")}
          </SubmitButton>
          <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} />
        </div>
      </form>
      {/* Not a refusal — a heads-up. The seat is real either way; the waiver
          link just has nowhere to be emailed, so somebody has to hand it over. */}
      {diver.person.email ? null : (
        <p className="mt-3 text-sm text-muted">{t("divers.bookActivity.noEmailNote")}</p>
      )}
      {upcoming.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("divers.bookActivity.noOpenActivities")}</p>
      ) : null}
    </section>
  );
}
