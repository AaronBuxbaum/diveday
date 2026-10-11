import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { nowDate } from "@/lib/clock";
import { deskTimeOn, deskTimeValue } from "@/lib/desk-hours";
import { formatTime } from "@/lib/format";
import { saveDeskHoursAction, saveReviewUrlAction } from "../../messages-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { featureRow, MESSAGES_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/**
 * The Messages group: reviews, the review link, the desk's hours, and the
 * shop's own WhatsApp sender.
 */
export function MessagesGroup({
  view,
  canManageMessaging,
}: {
  view: SettingsView;
  canManageMessaging: boolean;
}) {
  const { shop, shopSlug, t, banner, activeSection, notSet, locale } = view;
  const now = nowDate();
  const deskTime = (minute: number) =>
    formatTime(deskTimeOn(minute, now, shop.timezone), locale, shop.timezone);
  const reviewLinkValue = (() => {
    if (!shop.reviewUrl) return notSet;
    try {
      return new URL(shop.reviewUrl).hostname;
    } catch {
      return shop.reviewUrl;
    }
  })();
  return (
    <SettingsGroup group={MESSAGES_GROUP} label={t(MESSAGES_GROUP.labelKey)}>
      <InsetGroup>
        {featureRow(view, "reviews")}

        {/* One of the few rows another surface links straight to: the Reviews
          page's empty state names this box, so it opens itself on the
          `#review-link` fragment rather than dropping a shop at a closed
          row. */}
        <SettingsRow
          heading={t("settings.main.reviewLink.heading")}
          value={reviewLinkValue}
          description={t("settings.main.reviewLink.description")}
          detail={t("settings.main.reviewLink.detail")}
          sectionId="reviewLink"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="reviewLink" active={activeSection} />
          <FieldGrid as="form" action={saveReviewUrlAction} columns={1} className="mt-4">
            <Field
              label={t("settings.main.reviewLink.label")}
              hint={t("settings.main.reviewLink.hint")}
            >
              <input
                name="reviewUrl"
                type="url"
                maxLength={500}
                defaultValue={shop.reviewUrl ?? ""}
                placeholder="https://g.page/r/your-shop/review"
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.reviewLink.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.reviewLink.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>

        {/* When somebody is at the desk. A diver message outside these hours
          pings the staff who asked, from their own email settings. */}
        <SettingsRow
          heading={t("settings.main.deskHours.heading")}
          value={t("settings.main.deskHours.value", {
            opens: deskTime(shop.deskOpensMinute),
            closes: deskTime(shop.deskClosesMinute),
          })}
          description={t("settings.main.deskHours.description")}
          sectionId="deskHours"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="deskHours" active={activeSection} />
          <FieldGrid as="form" action={saveDeskHoursAction} columns={2} className="mt-4">
            <Field label={t("settings.main.deskHours.opens")}>
              <DateField
                name="deskOpens"
                type="time"
                required
                defaultValue={deskTimeValue(shop.deskOpensMinute)}
              />
            </Field>
            <Field label={t("settings.main.deskHours.closes")}>
              <DateField
                name="deskCloses"
                type="time"
                required
                defaultValue={deskTimeValue(shop.deskClosesMinute)}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.deskHours.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.deskHours.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>

        {/* Owner/manager only, like the payment rows: the credential it
          stores can send messages as the business. */}
        {canManageMessaging ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/whatsapp`}
            heading={t("settings.main.whatsapp.heading")}
          />
        ) : null}
      </InsetGroup>
    </SettingsGroup>
  );
}
