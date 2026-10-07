import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { saveReviewUrlAction } from "../../actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { featureRow, MESSAGES_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/** The Messages group: reviews, the review link, and the shop's own WhatsApp sender. */
export function MessagesGroup({
  view,
  canManageMessaging,
}: {
  view: SettingsView;
  canManageMessaging: boolean;
}) {
  const { shop, shopSlug, t, banner, activeSection, notSet } = view;
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
