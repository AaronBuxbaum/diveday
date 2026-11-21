import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  controlClass,
  Field,
  FieldGrid,
  FormStatus,
  StickyFormActions,
} from "@/components/ui/form";
import { requireShopSurface } from "@/features/accounts/session";
import { canPersonManageShopSettings, listTripLenses } from "@/features/trips/trip-defaults-page";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { MINIMUM_SEATS_DECISION_HOURS_DEFAULT } from "@/lib/minimum-seats";
import { minorToMajor } from "@/lib/money";
import { EMPTY_TRIP_DEFAULTS } from "@/lib/trip-defaults";
import { SettingsEditorPage } from "../_components/SettingsEditorPage";
import { saveTripDefaultsAction } from "./actions";

export const instant = true;
export const metadata = { title: "Trip defaults — DiveDay" };

export default async function TripDefaultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const defaults = shop.tripDefaults ?? EMPTY_TRIP_DEFAULTS;
  const lenses = await listTripLenses(db, shop.id);
  const price = (value: number | null) =>
    value === null ? "" : minorToMajor(value, shop.currency);
  return (
    <SettingsEditorPage
      t={t}
      title={t("settings.tripDefaults.heading")}
      description={t("settings.tripDefaults.description")}
      banner={undefined}
      unframed
    >
      <form action={saveTripDefaultsAction} className="space-y-8">
        <FieldGrid columns={2}>
          <Field
            label={`${t("trips.details.depositLabel")} (${shop.currency.toUpperCase()})`}
            description={t("trips.details.depositDescription")}
            hint={t("trips.details.optionalHint")}
          >
            <input
              className={controlClass}
              name="deposit"
              type="number"
              min="0"
              step="any"
              defaultValue={price(defaults.depositCents)}
            />
          </Field>
          <Field
            label={t("trips.details.cancellationWindowLabel")}
            description={t("trips.details.cancellationWindowDescription")}
            hint={t("trips.details.optionalHint")}
          >
            <input
              className={controlClass}
              name="cancellation"
              type="number"
              min="0"
              max="720"
              step="1"
              defaultValue={defaults.cancellationWindowHours ?? ""}
            />
          </Field>
          <Field
            label={t("trips.details.minimumBookingsLabel")}
            description={t("settings.tripDefaults.minimumHelp", {
              hours: MINIMUM_SEATS_DECISION_HOURS_DEFAULT,
            })}
            hint={t("trips.details.optionalHint")}
          >
            <input
              className={controlClass}
              name="minimum"
              type="number"
              min="1"
              max="60"
              step="1"
              defaultValue={defaults.minimumBookings ?? ""}
            />
          </Field>
          <Field
            label={`${t("participants.terms.snorkelerPrice")} (${shop.currency.toUpperCase()})`}
            description={t("settings.tripDefaults.seatPriceHelp")}
            hint={t("trips.details.optionalHint")}
          >
            <input
              className={controlClass}
              name="snorkeler"
              type="number"
              min="0"
              step="any"
              defaultValue={price(defaults.snorkelerPriceCents)}
            />
          </Field>
          <Field
            label={`${t("participants.terms.riderPrice")} (${shop.currency.toUpperCase()})`}
            description={t("settings.tripDefaults.seatPriceHelp")}
            hint={t("trips.details.optionalHint")}
          >
            <input
              className={controlClass}
              name="rider"
              type="number"
              min="0"
              step="any"
              defaultValue={price(defaults.riderPriceCents)}
            />
          </Field>
          <Field label={t("lenses.tripFieldLabel")} hint={t("trips.details.optionalHint")}>
            <select className={controlClass} name="lensId" defaultValue={defaults.lensId ?? ""}>
              <option value="">{t("lenses.tripFieldNone")}</option>
              {lenses.map((lens) => (
                <option key={lens.id} value={lens.id}>
                  {lens.name}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
        <StickyFormActions>
          <SubmitButton pendingLabel={t("words.busy.saving")} className={buttonClass()}>
            {t("settings.dockDay.save")}
          </SubmitButton>
          <FormStatus tone={notice === "invalid" ? "danger" : "success"} occurrenceKey={notice}>
            {notice === "saved"
              ? t("settings.tripDefaults.saved")
              : notice === "invalid"
                ? t("settings.tripDefaults.invalid")
                : null}
          </FormStatus>
        </StickyFormActions>
      </form>
    </SettingsEditorPage>
  );
}
