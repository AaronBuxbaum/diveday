import { controlClass, Field } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { pickChoices } from "@/features/shop-pick";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import type { SettingsShop } from "../groups/kit";

/**
 * **The shop's pick** (#4823): the one departure or course it features above its schedule. The
 * choices are read here, behind the form's boundary, so the rest of the profile never waits on
 * them. A pick that has lapsed is not among the options, so the field reads "None" until the shop
 * chooses again.
 */
export async function PickField({
  shop,
  t,
  locale,
}: {
  shop: SettingsShop;
  t: StaffTranslator;
  locale: string;
}) {
  const choices = await pickChoices(await getDb(), shop, nowDate());
  const value = shop.pickTripId
    ? `trip:${shop.pickTripId}`
    : shop.pickCourseId
      ? `course:${shop.pickCourseId}`
      : "";
  return (
    <Field label={t("settings.main.profile.pick")} hint={t("settings.main.profile.pickHint")}>
      <select name="pick" defaultValue={value} className={controlClass}>
        <option value="">{t("settings.main.profile.pickNone")}</option>
        {choices.trips.length > 0 ? (
          <optgroup label={t("settings.main.profile.pickTrips")}>
            {choices.trips.map((trip) => (
              <option key={trip.id} value={`trip:${trip.id}`}>
                {trip.title} · {formatShortDate(trip.startsAt, locale, shop.timezone)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {choices.courses.length > 0 ? (
          <optgroup label={t("settings.main.profile.pickCourses")}>
            {choices.courses.map((course) => (
              <option key={course.id} value={`course:${course.id}`}>
                {course.title}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </Field>
  );
}
