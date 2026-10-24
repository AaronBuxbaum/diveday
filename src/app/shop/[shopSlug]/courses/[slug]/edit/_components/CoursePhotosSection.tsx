import { ImageFileInput } from "@/components/ImageFileInput";
import { removablePhotoGridClass } from "@/components/RemovablePhoto";
import { Field, FieldGrid } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_IMAGE_MB, MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION } from "@/lib/storage/limits";
import { CoursePhotoCell } from "./CoursePhotoCell";
import { CourseSection, type CourseSectionRef } from "./CourseSection";
import type { EditableCourse } from "./course-types";

/** The editor's photos section: the cover, the gallery, each with its description box. */
export function CoursePhotosSection({
  course,
  photos,
  t,
}: {
  course: EditableCourse;
  photos: CourseSectionRef;
  t: StaffTranslator;
}) {
  return (
    <>
      {/* **Every photo is one cell: the picture, its Remove tick, and its
                    description under it.** The cover photo used to be a cell
                    with its caption box three rows lower, past its own file
                    picker, while each gallery photo carried its box inside its
                    cell; the two read as different kinds of thing, and "Remove
                    current photo" under one stood beside "Remove" under the
                    rest. What a description is for is said once, in the
                    section's line, not after every box (Aaron, 2026-10-05). */}
      <CourseSection as="fieldset" {...photos} description={t("courses.edit.photosDescription")}>
        <FieldGrid columns={1} className="gap-y-6">
          <Field
            label={t("courses.edit.heroPhotoLabel")}
            hint={t("courses.edit.heroPhotoHint")}
            htmlFor="course-hero-photo"
          >
            <div className={removablePhotoGridClass}>
              {course.heroImageUrl ? (
                <CoursePhotoCell
                  url={course.heroImageUrl}
                  removeName="removeHero"
                  removeLabel={t("courses.edit.removeLabel")}
                  altId="hero-alt"
                  altName="heroImageAlt"
                  alt={course.heroImageAlt ?? ""}
                  altLabel={t("courses.edit.photoCaptionLabel")}
                  altPlaceholder={t("courses.edit.photoCaptionPlaceholder")}
                />
              ) : null}
              <ImageFileInput
                id="course-hero-photo"
                name="heroImageFile"
                copy={{
                  choose: t(
                    course.heroImageUrl
                      ? "courses.edit.replaceHeroPhoto"
                      : "shared.imageInput.choose",
                  ),
                  chooseAnother: t("shared.imageInput.chooseAnother"),
                  wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
                  tooBigSuffix: t("shared.imageInput.tooBigSuffix", {
                    maxMb: MAX_IMAGE_MB,
                  }),
                }}
              />
            </div>
          </Field>
          <Field
            label={t("courses.edit.galleryPhotosLabel")}
            hint={t("courses.edit.galleryPhotosHint", {
              max: MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION,
            })}
            htmlFor="course-gallery-photos"
          >
            <div className={removablePhotoGridClass}>
              {course.galleryPhotos.map(({ url, alt }, index) => (
                <CoursePhotoCell
                  key={url}
                  url={url}
                  removeName="removeGalleryUrls"
                  removeValue={url}
                  removeLabel={t("courses.edit.removeLabel")}
                  altId={`gallery-alt-${index}`}
                  altName="galleryAltValues"
                  alt={alt}
                  altLabel={t("courses.edit.photoCaptionLabel")}
                  altPlaceholder={t("courses.edit.photoCaptionPlaceholder")}
                >
                  <input type="hidden" name="galleryAltUrls" value={url} />
                </CoursePhotoCell>
              ))}
              <ImageFileInput
                id="course-gallery-photos"
                name="galleryImageFiles"
                multiple
                maxFiles={MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION}
                copy={{
                  choose: t("courses.edit.addGalleryPhotos"),
                  chooseAnother: t("shared.imageInput.chooseAnother"),
                  tooMany: t("shared.imageInput.tooMany", {
                    count: MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION,
                  }),
                  wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
                  tooBigSuffix: t("shared.imageInput.tooBigSuffix", {
                    maxMb: MAX_IMAGE_MB,
                  }),
                }}
              />
            </div>
          </Field>
        </FieldGrid>
      </CourseSection>
    </>
  );
}
