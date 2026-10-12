import { ImageFileInput } from "@/components/ImageFileInput";
import { RemovablePhoto, removablePhotoGridClass } from "@/components/RemovablePhoto";
import { Field } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_SITE_IMAGES } from "@/lib/dive-sites";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import type { SiteFieldValues } from "./SiteFields";

/**
 * The photos section: the map and route images, one each, and the site's own
 * photos up to `MAX_SITE_IMAGES` — every one an upload, never a pasted link.
 */
export function SitePhotoFields({ t, values }: { t: StaffTranslator; values?: SiteFieldValues }) {
  // `ImageFileInput` is a Client Component, so its words arrive resolved.
  const imageInputCopy = {
    choose: t("shared.imageInput.choose"),
    chooseAnother: t("shared.imageInput.chooseAnother"),
    wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
    tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
  };

  return (
    <>
      {/* Each field is one grid: the photos it holds, then the tile that
          adds the next, so a picked photo lands where it will live. The
          `Field`s carry `htmlFor`, so the caption names the tile rather
          than wrapping the cells, each of which is a `<label>` of its own
          (see `src/components/ui/form.tsx`). */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
        <Field
          label={t("diveSites.form.mapImageLabel")}
          hint={t("diveSites.form.optionalHint")}
          htmlFor="site-satellite-image"
        >
          <div className="flex flex-col gap-3">
            {values?.satelliteImageUrl ? (
              <RemovablePhoto
                url={values.satelliteImageUrl}
                name="removeSatelliteImage"
                label={t("diveSites.form.removeCurrentPhoto")}
              />
            ) : null}
            <ImageFileInput
              id="site-satellite-image"
              name="satelliteImageFile"
              copy={imageInputCopy}
            />
          </div>
        </Field>
        <Field
          label={t("diveSites.form.routeImageLabel")}
          hint={t("diveSites.form.optionalHint")}
          htmlFor="site-route-image"
        >
          <div className="flex flex-col gap-3">
            {values?.routeImageUrl ? (
              <RemovablePhoto
                url={values.routeImageUrl}
                name="removeRouteImage"
                label={t("diveSites.form.removeCurrentPhoto")}
              />
            ) : null}
            <ImageFileInput id="site-route-image" name="routeImageFile" copy={imageInputCopy} />
          </div>
        </Field>
      </div>
      <Field
        label={t("diveSites.form.sitePhotosLabel")}
        hint={t("diveSites.form.sitePhotosHint", { max: MAX_SITE_IMAGES })}
        htmlFor="site-photos"
      >
        <div className={removablePhotoGridClass}>
          {values?.imageUrls.map((url) => (
            <RemovablePhoto
              key={url}
              url={url}
              name="removeSiteImageUrls"
              value={url}
              label={t("diveSites.form.removeLabel")}
            />
          ))}
          <ImageFileInput
            id="site-photos"
            name="siteImageFiles"
            multiple
            maxFiles={MAX_SITE_IMAGES}
            copy={{
              ...imageInputCopy,
              chooseAnother: t("shared.imageInput.chooseOthers"),
              tooMany: t("diveSites.form.tooManyPhotos", { max: MAX_SITE_IMAGES }),
            }}
          />
        </div>
      </Field>
    </>
  );
}
