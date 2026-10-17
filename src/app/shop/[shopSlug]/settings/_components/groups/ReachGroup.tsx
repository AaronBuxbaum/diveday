import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { nowDate } from "@/lib/clock";
import { deskTimeOn, deskTimeValue } from "@/lib/desk-hours";
import { formatTime } from "@/lib/format";
import { saveDeskHoursAction, saveReviewUrlAction } from "../../messages-actions";
import { resendContactConfirmationAction, saveContactAction } from "../../shop-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { featureRow, REACH_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/**
 * **How divers reach you** (fifth-loop ideas, item 58): the address divers
 * write to (and replies are routed to), the desk's hours, the reader's own
 * email page, then reviews, the review link and the shop's own WhatsApp
 * sender. They were two groups, Notifications and Messages, side by side, and
 * an owner looking for "how do divers get hold of us" read both.
 */
export function ReachGroup({
  view,
  canManageMessaging,
}: {
  view: SettingsView;
  canManageMessaging: boolean;
}) {
  const { shop, shopSlug, t, locale, banner, activeSection, notSet } = view;
  const reviewLinkValue = (() => {
    if (!shop.reviewUrl) return notSet;
    try {
      return new URL(shop.reviewUrl).hostname;
    } catch {
      return shop.reviewUrl;
    }
  })();
  const now = nowDate();
  const deskTime = (minute: number) =>
    formatTime(deskTimeOn(minute, now, shop.timezone), locale, shop.timezone);
  const contactText = <FactLine facts={[shop.contactEmail, shop.contactPhone]} empty={notSet} />;
  // An address the shop has not yet confirmed is the one exceptional state on
  // this row: until the link sent there is opened, diver replies are not
  // routed to it (issue #1288). Confirmed is the quiet default and says nothing.
  const contactUnconfirmed = Boolean(shop.contactEmail && !shop.contactEmailConfirmedAt);
  const contactValue = contactUnconfirmed ? (
    <>
      {contactText} <Badge tone="warning">{t("settings.main.contact.awaitingConfirmation")}</Badge>
    </>
  ) : (
    contactText
  );
  return (
    <SettingsGroup group={REACH_GROUP} label={t(REACH_GROUP.labelKey)}>
      <InsetGroup>
        <SettingsRow
          heading={t("settings.main.contact.heading")}
          value={contactValue}
          description={t("settings.main.contact.description")}
          detail={t("settings.main.contact.detail")}
          sectionId="contact"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="contact" active={activeSection} />
          <FieldGrid as="form" action={saveContactAction} columns={2} className="mt-4">
            <Field label={t("settings.main.contact.emailLabel")}>
              <input
                name="contactEmail"
                type="email"
                maxLength={200}
                autoComplete="email"
                defaultValue={shop.contactEmail ?? ""}
                placeholder="hello@yourshop.com"
                className={controlClass}
              />
            </Field>
            <Field
              label={t("settings.main.contact.phoneLabel")}
              hint={t("settings.main.contact.phoneHint")}
            >
              <input
                name="contactPhone"
                type="tel"
                maxLength={40}
                autoComplete="tel"
                defaultValue={shop.contactPhone ?? ""}
                placeholder="+1 305 555 0134"
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.contact.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.contact.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
          {contactUnconfirmed ? (
            <form action={resendContactConfirmationAction} className="mt-3">
              <SubmitButton
                pendingLabel={t("settings.main.contact.resending")}
                className={buttonClass({ variant: "ghost" })}
              >
                {t("settings.main.contact.resend")}
              </SubmitButton>
            </form>
          ) : null}
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

        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/email`}
          heading={t("emailSettings.title")}
        />

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
