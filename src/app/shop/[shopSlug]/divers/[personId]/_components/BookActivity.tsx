import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { bookActivityAction } from "../actions";
import type { DiverProfile, Shop, UpcomingTrip } from "./shared";

export function BookActivity({
  diver,
  shop,
  locale,
  upcoming,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shop: Shop;
  locale: string;
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
      {diver.person.email ? (
        <form
          action={bookActivityAction.bind(null, shopSlug, personId)}
          className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-end"
        >
          <FieldGrid columns={1} className="flex-1">
            <Field label={t("divers.bookActivity.courseOrDiveLabel")}>
              <select name="tripId" required defaultValue="" className={controlClass}>
                <option value="" disabled>
                  {t("divers.bookActivity.chooseActivity")}
                </option>
                {upcoming.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.course ? `${trip.course.title} — ` : ""}
                    {trip.title} · {formatShortDate(trip.startsAt, locale, shop.timezone)}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <SubmitButton
            pendingLabel={t("divers.bookActivity.booking")}
            className={buttonClass({ size: "lg" })}
          >
            {t("divers.bookActivity.bookActivityButton")}
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          {t("divers.bookActivity.needEmailWarning")}
        </p>
      )}
      {diver.person.email && upcoming.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("divers.bookActivity.noOpenActivities")}</p>
      ) : null}
    </section>
  );
}
