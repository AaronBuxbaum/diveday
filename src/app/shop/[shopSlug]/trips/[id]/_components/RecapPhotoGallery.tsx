import Image from "next/image";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { StaffRecapPhoto } from "@/db/recap";
import { staffTranslator } from "@/i18n/staff-messages";
import type { FormNotice } from "@/lib/staff-notices";

/**
 * The diver photos shared to this trip's recaps, for the shop to reuse — and to
 * take down anything it shouldn't. A diver only ever sees their own photos on
 * their own recap; this is the one place staff see them all, so the remove
 * button is the moderation seam (20260723-post-trip-recap follow-up).
 */
export function RecapPhotoGallery({
  photos,
  removeAction,
  status,
  locale,
}: {
  photos: StaffRecapPhoto[];
  removeAction: (formData: FormData) => void;
  /** This gallery's own outcome, rendered under its heading rather than at the top of the page. */
  status?: FormNotice;
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
      <FormStatus tone={status?.tone} className="mt-2">
        {status?.text}
      </FormStatus>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo) => (
          <li key={photo.id} className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="relative aspect-square w-full">
              {/* Diver photos always come from the blob store (storeRecapImage), so the
                  remotePatterns entry in next.config.ts covers every url here. */}
              {/* A fixed `sizes`, not a viewport-relative one, for two reasons.

                  It is more accurate: these tiles render 163px at a 390 phone
                  and cap at 273px on desktop, where the container's max width
                  stops them growing. The old `(min-width: 640px) 33vw, 50vw`
                  claimed 422px at 1280 — over half again what is ever drawn —
                  so the browser fetched a candidate wider than any screen uses.

                  And it is deterministic, which is what actually forced the
                  change. A viewport-relative `sizes` is evaluated whenever the
                  browser gets around to selecting a candidate, and the visual
                  suite resizes the page immediately before each capture — so
                  the same tile could resolve to a 128px source in one run and a
                  256px one in the next, and `trip-manage-dark-vw-390`
                  alternated between a soft and a sharp thumbnail on unrelated
                  PRs. A length with no viewport term cannot race a resize.

                  288px covers the widest this ever draws (~290px just below the
                  `sm` breakpoint, where the grid is still two columns) without
                  upscaling at any breakpoint. */}
              <Image
                src={photo.imageUrl}
                alt={
                  photo.caption ??
                  t("trips.recapPhotos.photoFromAlt", { diverName: photo.diverName })
                }
                fill
                sizes="288px"
                className="object-cover"
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{photo.diverName}</p>
                {photo.caption ? (
                  <p className="truncate text-xs text-muted">{photo.caption}</p>
                ) : null}
              </div>
              <form action={removeAction}>
                <input type="hidden" name="photoId" value={photo.id} />
                {/* `buttonClass`, not a hand-written class string: this one had
                    no `min-h-*` at all, so the moderation control — the seam a
                    shop takes a diver's photo down through — was a ~24px tap
                    target, well under the 44px floor (design/principles.md §2).
                    The confirm half spells the same variant with `busy`,
                    because it is a `SubmitButton` that disables itself while
                    its own submit is in flight; the default not-allowed cursor
                    there reads as "the tap was refused" (components/ui/button.ts). */}
                <InlineConfirm
                  triggerLabel={t("trips.recapPhotos.remove")}
                  triggerClassName={buttonClass({
                    variant: "danger-ghost",
                    size: "sm",
                    className: "shrink-0",
                  })}
                  confirmClassName={buttonClass({
                    variant: "danger-ghost",
                    size: "sm",
                    busy: true,
                  })}
                  message={t("trips.recapPhotos.confirmRemove")}
                  confirmLabel={t("trips.recapPhotos.removeConfirmButton")}
                  cancelLabel={t("trips.recapPhotos.removeCancel")}
                  pendingLabel={t("trips.recapPhotos.removing")}
                />
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
