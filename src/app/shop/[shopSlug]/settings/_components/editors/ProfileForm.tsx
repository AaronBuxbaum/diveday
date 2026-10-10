import { ImageFileInput } from "@/components/ImageFileInput";
import { RemovablePhoto, removablePhotoGridClass } from "@/components/RemovablePhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  ChoiceFieldset,
  ChoiceRow,
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  BRAND_BADGE_CODES,
  BRAND_DISPLAY_FONT_CODES,
  BRAND_DISPLAY_FONTS,
  DIVEDAY_BRAND_COLOR,
  deriveBrandTheme,
  deriveDarkBrandTheme,
} from "@/lib/brand";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { saveProfileAction } from "../../website-actions";
import { BrandColorField } from "../BrandColorField";
import { BrandPreview } from "../BrandPreview";
import type { SettingsShop } from "../groups/kit";

/**
 * **The storefront's profile and branding** — the editor that was the Website
 * group's first row on the settings hub and is a page of its own now
 * (`/settings/profile`, #1854). The markup is the row's own, unchanged; only
 * where it renders moved.
 */
export function ProfileForm({
  shop,
  t,
  className = "",
}: {
  shop: SettingsShop;
  t: StaffTranslator;
  className?: string;
}) {
  // A shop's colour is checked at render, never on save: the hint says when
  // it had to be darkened so the owner learns here, not on the storefront.
  const brandTheme = shop.brandColor ? deriveBrandTheme(shop.brandColor) : null;
  const brandNightTheme = shop.brandColor ? deriveDarkBrandTheme(shop.brandColor) : null;
  // The logo's and the cover photo's pickers, in the words every photo
  // picker in the app uses.
  const imageInputCopy = {
    choose: t("shared.imageInput.choose"),
    chooseAnother: t("shared.imageInput.chooseAnother"),
    wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
    tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
  };
  return (
    <FieldGrid as="form" action={saveProfileAction} columns={1} className={className}>
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
  );
}
