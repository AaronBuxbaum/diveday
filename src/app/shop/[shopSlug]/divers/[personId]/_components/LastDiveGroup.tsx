import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DateField, Field } from "@/components/ui/form";
import { EARLIEST_LAST_DIVE, type LastKnownDive } from "@/db/last-dive";
import { STAFF_DIVE_RECENCY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import { saveLastDiveAction } from "../last-dive-actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

/** Whole calendar months from one day to another, never below zero. */
export function monthsSince(from: CalendarDate, to: CalendarDate): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

/**
 * The diver's own word on `/ready`, when it is newer than the date the record
 * shows: the band they picked for a trip after that day. It never moves the
 * date — a band is not a day — but a staffer reading "Mar 2024" beside a diver
 * who said "this season" last week should see both and ask.
 */
export function newerSaid(
  diver: Pick<DiverProfile, "bookings">,
  on: CalendarDate | null,
  timezoneDay: (date: Date) => CalendarDate,
) {
  const answered = diver.bookings
    // A seat matched to them on a guess may be somebody else's answer.
    .filter(
      (entry) =>
        entry.booking.lastDivedBand !== null &&
        entry.booking.status !== "cancelled" &&
        !entry.booking.identityUnconfirmedAt,
    )
    .map((entry) => ({ band: entry.booking.lastDivedBand, day: timezoneDay(entry.trip.startsAt) }))
    .sort((left, right) => (left.day < right.day ? 1 : -1))[0];
  if (!answered?.band) return null;
  if (on && answered.day <= on) return null;
  return { band: answered.band, day: answered.day };
}

/**
 * **When they last dived, and the place to say so** (Aaron, 2026-10-23; ADR
 * 20261023-last-known-dive). Shops ask this at the counter before anything
 * else, so it is its own row in the file with the date on its face, one tap
 * from a date box.
 *
 * The date is the later of what staff wrote and the diver's own last day
 * with the shop (`lastKnownDive`), so a trip with the shop moves it forward
 * on its own and nothing moves it back. It gates nothing: a long gap is a
 * refresher conversation for a divemaster, not a refusal.
 */
export function LastDiveGroup({
  diver,
  known,
  shopSlug,
  personId,
  today,
  timezoneDay,
  locale,
  t,
  removed,
  status,
}: {
  diver: DiverProfile;
  known: LastKnownDive;
  shopSlug: string;
  personId: string;
  /** The shop's today, the latest day the box accepts. */
  today: CalendarDate;
  /** A departure's start as the shop's own calendar day. */
  timezoneDay: (date: Date) => CalendarDate;
  locale: string;
  t: StaffTranslator;
  removed: boolean;
  status?: DiverNotice;
}) {
  const months = known.on ? monthsSince(known.on, today) : null;
  const summary = known.on
    ? `${formatCalendarDate(known.on, locale)} · ${
        months !== null && months >= 24
          ? t("divers.lastDive.yearsAgo", { count: Math.floor(months / 12) })
          : t("divers.lastDive.monthsAgo", { count: months ?? 0 })
      }`
    : t("divers.file.noneOnFile");
  const said = newerSaid(diver, known.on, timezoneDay);
  const source =
    known.source === "with_shop"
      ? t("divers.lastDive.fromShop")
      : known.source === "imported"
        ? t("divers.lastDive.fromImport")
        : null;

  return (
    <DiverFileGroupDisclosure
      id="last-dive"
      label={t("divers.lastDive.heading")}
      summary={summary}
      // Five years and more, the gap the `/ready` band already marks
      // (`diveRecencyIsNotable`): ink only, it gates nothing.
      summaryTone={months !== null && months >= 60 ? "warning" : "muted"}
      open={Boolean(status && !status.silent)}
    >
      <div className="space-y-4">
        {source || said ? (
          <div className="space-y-1 text-sm text-muted">
            {source ? <p>{source}</p> : null}
            {said ? (
              <p>
                {t("divers.lastDive.theySaid", {
                  date: formatCalendarDate(said.day, locale),
                  said: t("shared.diveRecency.lastDived", {
                    when: t(STAFF_DIVE_RECENCY_KEYS[said.band]),
                  }),
                })}
              </p>
            ) : null}
          </div>
        ) : null}
        {removed ? null : (
          <form
            action={saveLastDiveAction.bind(null, shopSlug, personId)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Field
              label={t("divers.lastDive.fieldLabel")}
              htmlFor="diver-last-dive"
              required
              markRequired={false}
              error={status && !status.silent && status.tone === "danger" ? status.text : undefined}
              className="sm:max-w-56"
            >
              <DateField
                id="diver-last-dive"
                name="lastDiveOn"
                max={today}
                min={EARLIEST_LAST_DIVE}
                required
                defaultValue={known.on ?? ""}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <SubmitButton
                pendingLabel={t("divers.lastDive.saving")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("divers.lastDive.save")}
              </SubmitButton>
              {known.recorded ? (
                <SubmitButton
                  name="intent"
                  value="clear"
                  formNoValidate
                  pendingLabel={t("divers.lastDive.clearing")}
                  className={buttonClass({ variant: "ghost" })}
                >
                  {t("divers.lastDive.clear")}
                </SubmitButton>
              ) : null}
            </div>
          </form>
        )}
        {status?.tone === "danger" ? null : <DiverFormStatus status={status} />}
      </div>
    </DiverFileGroupDisclosure>
  );
}
