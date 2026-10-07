import { ImageFileInput } from "@/components/ImageFileInput";
import { RemovablePhoto, removablePhotoGridClass } from "@/components/RemovablePhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import {
  ChoiceFieldset,
  ChoiceRow,
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import {
  BRAND_BADGE_CODES,
  BRAND_DISPLAY_FONT_CODES,
  BRAND_DISPLAY_FONTS,
  DIVEDAY_BRAND_COLOR,
  deriveBrandTheme,
  deriveDarkBrandTheme,
} from "@/lib/brand";
import {
  MAX_IMAGE_MB,
  MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE,
  MAX_SHOPFRONT_PHOTOS,
} from "@/lib/storage/limits";
import { saveProfileAction, saveSearchListingAction, saveShopPhotosAction } from "../../actions";
import { BrandColorField } from "../BrandColorField";
import { BrandPreview } from "../BrandPreview";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { featureRow, SectionNotice, SettingsGroup, type SettingsView, WEBSITE_GROUP } from "./kit";

/** The Website group: the storefront's profile, photos, search listing and embed. */
export function WebsiteGroup({ view }: { view: SettingsView }) {
  const { shop, shopSlug, t, banner, activeSection, notSet } = view;
  // A shop's colour is checked at render, never on save: the summary says
  // when it had to be darkened so the owner learns here, not on the storefront.
  const brandTheme = shop.brandColor ? deriveBrandTheme(shop.brandColor) : null;
  const brandNightTheme = shop.brandColor ? deriveDarkBrandTheme(shop.brandColor) : null;
  const profileValue = (
    <FactLine
      facts={[
        shop.tagline ? { value: shop.tagline, wraps: true } : null,
        shop.description ? t("settings.main.profile.descriptionSet") : null,
        shop.logoUrl ? t("settings.main.profile.logoSet") : null,
        shop.brandBadges.length > 0
          ? t("settings.main.profile.badgesSet", { count: shop.brandBadges.length })
          : null,
      ]}
      empty={notSet}
    />
  );
  // The logo's and the cover photo's pickers, in the words every photo
  // picker in the app uses.
  const imageInputCopy = {
    choose: t("shared.imageInput.choose"),
    chooseAnother: t("shared.imageInput.chooseAnother"),
    wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
    tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
  };
  return (
    <SettingsGroup group={WEBSITE_GROUP} label={t(WEBSITE_GROUP.labelKey)}>
      <InsetGroup>
        <SettingsRow
          heading={t("settings.main.profile.heading")}
          value={profileValue}
          description={t("settings.main.profile.description")}
          sectionId="profile"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="profile" active={activeSection} />
          <FieldGrid as="form" action={saveProfileAction} columns={1} className="mt-4">
            <Field label={t("settings.main.profile.tagline")}>
              <input
                name="tagline"
                type="text"
                maxLength={120}
                defaultValue={shop.tagline ?? ""}
                placeholder={t("settings.main.profile.taglinePlaceholder")}
                className={controlClass}
              />
            </Field>
            <Field label={t("settings.main.profile.descriptionLabel")}>
              <textarea
                name="description"
                rows={3}
                maxLength={1000}
                defaultValue={shop.description ?? ""}
                placeholder={t("settings.main.profile.descriptionPlaceholder")}
                className={textareaClassFor(3)}
              />
            </Field>
            {/* `htmlFor` the picker: wrapped in the caption's label, with a
                logo on file "Logo" labelled the remove box before it, and
                a click on the caption ticked it (K-13 review). */}
            <Field
              label={t("settings.main.profile.logo")}
              hint={t("settings.main.profile.logoHint")}
              htmlFor="settings-logo-file"
            >
              {/* The stored logo is taken back off the way every stored
                  photo is (K-247 follow-up), in the square it is drawn as
                  on the storefront. */}
              <div className="flex flex-wrap items-start gap-3">
                {shop.logoUrl ? (
                  <RemovablePhoto
                    url={shop.logoUrl}
                    name="removeLogo"
                    label={t("settings.main.profile.removeLogo")}
                    shape="logo"
                  />
                ) : null}
                <ImageFileInput
                  id="settings-logo-file"
                  name="logoFile"
                  shape="logo"
                  copy={imageInputCopy}
                />
              </div>
            </Field>
            <FieldGrid columns={2}>
              <Field
                label={t("settings.main.profile.brandColor")}
                hint={
                  brandTheme?.adjusted
                    ? t("settings.main.profile.brandColorDarkened", {
                        hex: brandTheme.primary,
                      })
                    : brandNightTheme?.adjusted
                      ? t("settings.main.profile.brandColorLightenedAtNight", {
                          hex: brandNightTheme.primary,
                        })
                      : t("settings.main.profile.brandColorHint")
                }
              >
                <BrandColorField
                  initial={shop.brandColor}
                  pickerLabel={t("settings.main.profile.brandColorPicker")}
                  placeholder={DIVEDAY_BRAND_COLOR}
                />
              </Field>
              <Field label={t("settings.main.profile.displayFont")}>
                <select
                  name="brandDisplayFont"
                  defaultValue={shop.brandDisplayFont ?? ""}
                  className={controlClass}
                >
                  <option value="">{t("settings.main.profile.displayFontDefault")}</option>
                  {BRAND_DISPLAY_FONT_CODES.map((code) => (
                    <option key={code} value={code}>
                      {BRAND_DISPLAY_FONTS[code].family}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldGrid>
            <BrandPreview
              shopName={shop.name}
              brandColor={shop.brandColor}
              brandDisplayFont={shop.brandDisplayFont}
              label={t("settings.main.profile.brandPreview")}
              nightLabel={t("settings.main.profile.brandPreviewNight")}
            />
            <Field
              label={t("settings.main.profile.heroPhoto")}
              hint={t("settings.main.profile.heroHint")}
              htmlFor="settings-cover-photo-file"
            >
              {/* One cell of the gallery grid, as the course hero is: a
                  full-width field holding one photo draws it at a
                  gallery cell's size (RemovablePhoto's grid doc). */}
              <div className={removablePhotoGridClass}>
                {shop.brandHeroImageUrl ? (
                  <RemovablePhoto
                    url={shop.brandHeroImageUrl}
                    name="removeHero"
                    label={t("settings.main.profile.removeHero")}
                  />
                ) : null}
                <ImageFileInput
                  id="settings-cover-photo-file"
                  name="brandHeroFile"
                  copy={imageInputCopy}
                />
              </div>
            </Field>
            <FieldGrid columns={2}>
              <Field label={t("settings.main.profile.heroAlt")}>
                <input
                  name="brandHeroImageAlt"
                  type="text"
                  required={Boolean(shop.brandHeroImageUrl)}
                  maxLength={200}
                  defaultValue={shop.brandHeroImageAlt ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field label={t("settings.main.profile.establishedYear")}>
                <input
                  name="establishedYear"
                  type="number"
                  inputMode="numeric"
                  min={1900}
                  max={2100}
                  defaultValue={shop.establishedYear ?? ""}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            {/* A group of choices, so a legend over them: as a `Field` the
                caption's label wrapped every badge and named the first
                (K-13 review). */}
            <ChoiceFieldset
              legend={t("settings.main.profile.badges")}
              hint={t("settings.main.profile.badgesHint")}
              bodyClassName="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
            >
              {BRAND_BADGE_CODES.map((code) => (
                <ChoiceRow
                  key={code}
                  name="badge"
                  type="checkbox"
                  value={code}
                  defaultChecked={shop.brandBadges.includes(code)}
                  className="text-sm"
                >
                  {t(`settings.main.profile.badgeLabels.${code}`)}
                </ChoiceRow>
              ))}
            </ChoiceFieldset>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.profile.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.profile.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>

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
