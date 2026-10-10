import { ImageFileInput } from "@/components/ImageFileInput";
import { RemovablePhoto, removablePhotoGridClass } from "@/components/RemovablePhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import {
  MAX_IMAGE_MB,
  MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE,
  MAX_SHOPFRONT_PHOTOS,
} from "@/lib/storage/limits";
import { saveSearchListingAction, saveShopPhotosAction } from "../../actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { featureRow, SectionNotice, SettingsGroup, type SettingsView, WEBSITE_GROUP } from "./kit";

/** The Website group: the storefront's profile, photos, search listing and embed. */
export function WebsiteGroup({ view }: { view: SettingsView }) {
  const { shop, shopSlug, t, banner, activeSection } = view;
  // The shop-photos picker, in the words every photo picker in the app uses.
  const imageInputCopy = {
    choose: t("shared.imageInput.choose"),
    chooseAnother: t("shared.imageInput.chooseAnother"),
    wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
    tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
  };
  return (
    <SettingsGroup group={WEBSITE_GROUP} label={t(WEBSITE_GROUP.labelKey)}>
      <InsetGroup>
        {/* A form of a dozen fields, a logo, a cover and a preview: a page of
            its own (#1854), as every editor longer than about three fields is. */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/profile`}
          heading={t("settings.main.profile.heading")}
        />

        {/* The storefront's photo strip, its own form: the profile above
            already posts a logo and a cover, and these beside them would
            outgrow one save's body (`saveShopPhotosAction`). */}
        <SettingsRow
          heading={t("settings.main.shopPhotos.heading")}
          value={
            shop.shopfrontPhotoUrls.length > 0
              ? t("settings.main.shopPhotos.value", {
                  count: shop.shopfrontPhotoUrls.length,
                })
              : t("settings.main.shopPhotos.valueNone")
          }
          description={t("settings.main.shopPhotos.description")}
          sectionId="shopPhotos"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="shopPhotos" active={activeSection} />
          <FieldGrid as="form" action={saveShopPhotosAction} columns={1} className="mt-4">
            <Field
              label={t("settings.main.shopPhotos.label")}
              hint={t("settings.main.shopPhotos.hint", {
                max: MAX_SHOPFRONT_PHOTOS,
                perSave: MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE,
              })}
              htmlFor="settings-shop-photo-files"
            >
              <div className={removablePhotoGridClass}>
                {shop.shopfrontPhotoUrls.map((url) => (
                  <RemovablePhoto
                    key={url}
                    url={url}
                    name="removeShopPhotoUrls"
                    value={url}
                    label={t("settings.main.shopPhotos.remove")}
                  />
                ))}
                <ImageFileInput
                  id="settings-shop-photo-files"
                  name="shopPhotoFiles"
                  multiple
                  maxFiles={MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE}
                  copy={{
                    ...imageInputCopy,
                    choose: t("settings.main.shopPhotos.add"),
                    chooseAnother: t("shared.imageInput.chooseOthers"),
                    tooMany: t("settings.main.shopPhotos.tooMany", {
                      count: MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE,
                    }),
                  }}
                />
              </div>
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.shopPhotos.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.shopPhotos.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>

        {/* A shop is listed by default and the box says so; unticking it drops the shop out of
          sitemap.xml *and* makes its public pages emit robots: noindex
          (ADR 20260813-search-listing-is-a-choice). */}
        <SettingsRow
          heading={t("settings.main.searchListing.heading")}
          value={
            shop.searchListingOptOutAt
              ? t("settings.main.searchListing.valueHidden")
              : t("settings.main.searchListing.valueListed")
          }
          detail={t("settings.main.searchListing.detail")}
          sectionId="searchListing"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="searchListing" active={activeSection} />
          <FieldGrid as="form" action={saveSearchListingAction} columns={1} className="mt-4">
            <ChoiceRow
              name="searchListed"
              type="checkbox"
              defaultChecked={!shop.searchListingOptOutAt}
              className="text-sm"
            >
              {t("settings.main.searchListing.label")}
            </ChoiceRow>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.searchListing.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.searchListing.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>

        {featureRow(view, "dateRequests")}

        {featureRow(view, "lastMinuteList")}

        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/embed`}
          heading={t("settings.main.embed.heading")}
        />
      </InsetGroup>
    </SettingsGroup>
  );
}
