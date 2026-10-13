import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { nowDate } from "@/lib/clock";
import { deskTimeOn, deskTimeValue } from "@/lib/desk-hours";
import { formatTime } from "@/lib/format";
import { saveDeskHoursAction } from "../../messages-actions";
import { resendContactConfirmationAction, saveContactAction } from "../../shop-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { NOTIFICATIONS_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/**
 * The Notifications group: everything that decides where mail goes. The
 * address divers write to (and replies are routed to), the hours outside
 * which a diver's message pings the staff who asked, and the reader's own
 * email page (reply address, digest, after-hours pings). They were three
 * rows in three groups (Shop, Messages, Account), so a shop asking "where
 * does my mail go?" opened three.
 */
export function NotificationsGroup({ view }: { view: SettingsView }) {
  const { shop, shopSlug, t, locale, banner, activeSection, notSet } = view;
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
    <SettingsGroup group={NOTIFICATIONS_GROUP} label={t(NOTIFICATIONS_GROUP.labelKey)}>
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
      </InsetGroup>
    </SettingsGroup>
  );
}
