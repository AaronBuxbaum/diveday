import { SubmitButton } from "@/components/SubmitButton";
import type { StaffRecapPhoto } from "@/db/recap";
import { staffTranslator } from "@/i18n/staff-messages";

/**
 * The diver photos shared to this trip's recaps, for the shop to reuse — and to
 * take down anything it shouldn't. A diver only ever sees their own photos on
 * their own recap; this is the one place staff see them all, so the remove
 * button is the moderation seam (20260723-post-trip-recap follow-up).
 */
export function RecapPhotoGallery({
  photos,
  removeAction,
  locale,
}: {
  photos: StaffRecapPhoto[];
  removeAction: (formData: FormData) => void;
  locale: string;
}) {
  if (photos.length === 0) return null;
  const t = staffTranslator(locale);
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">
        {t("trips.recapPhotos.heading")}{" "}
        <span className="font-normal text-muted tabular-nums">{photos.length}</span>
      </h2>
      <p className="mt-1 text-sm text-muted">{t("trips.recapPhotos.description")}</p>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo) => (
          <li key={photo.id} className="overflow-hidden rounded-lg border border-border bg-surface">
            {/* biome-ignore lint/performance/noImgElement: diver photos come from the blob store, which no build-time image allowlist can enumerate. */}
            <img
              src={photo.imageUrl}
              alt={
                photo.caption ?? t("trips.recapPhotos.photoFromAlt", { diverName: photo.diverName })
              }
              loading="lazy"
              className="aspect-square w-full object-cover"
            />
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{photo.diverName}</p>
                {photo.caption ? (
                  <p className="truncate text-xs text-muted">{photo.caption}</p>
                ) : null}
              </div>
              <form action={removeAction}>
                <input type="hidden" name="photoId" value={photo.id} />
                <SubmitButton
                  pendingLabel={t("trips.recapPhotos.removing")}
                  confirmMessage={t("trips.recapPhotos.confirmRemove")}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                >
                  {t("trips.recapPhotos.remove")}
                </SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
