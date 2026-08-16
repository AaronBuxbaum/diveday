import Image from "next/image";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The crew's post-trip note, written where the crew is standing when they still
 * remember the day: the close-out, on the row of the departure it belongs to.
 *
 * The note rides out on every diver's recap, which the nightly run sends once a
 * trip has ended (`sendDueRecaps`, src/db/recap.ts) — so the evening the boat
 * came back is both the last moment to add one and the only moment anyone can
 * still name the highlight. It used to live only on the trip's setup page and
 * only *before* the trip, which is to say it asked for the highlight of a day
 * that had not happened.
 *
 * Deliberately a `<details>` rather than an always-open box: the close-out's
 * departures list is a reconciliation ("did everyone come home?") and a row of
 * open textareas would bury the head counts. The note as written is the summary,
 * so a row that already has one says so without opening.
 *
 * Its `<form>` is why this section sits *above* the page's close form rather
 * than inside it — a form cannot nest in a form, and the carry/dismiss radios
 * below must survive a note being saved.
 */
export function RecapNoteEditor({
  action,
  shoutout,
  saved,
  t,
  photos = [],
  deletePhotoAction,
}: {
  action: (formData: FormData) => void;
  shoutout: string | null;
  /** True right after this row's own save, which is also what holds it open. */
  saved: boolean;
  t: StaffTranslator;
  photos?: {
    id: string;
    imageUrl: string;
    caption: string | null;
    diverName: string;
    bookingId: string;
  }[];
  deletePhotoAction?: (formData: FormData) => void;
}) {
  return (
    <details open={saved} className="group/recap mt-3 border-t border-border pt-3">
      {/* Stacked below `sm`, one line from there. Inline at phone width the
          label and the note fought over ~340px and the three-word heading
          broke across three lines beside a single line of note. */}
      {/* `sm:justify-start`: once the row turns horizontal, `justify-center`
          would centre the label and note in the card instead of centring them
          in the row's own height, which is all it is there for. */}
      <summary className="flex min-h-11 cursor-pointer list-none flex-col justify-center gap-0.5 text-sm [&::-webkit-details-marker]:hidden sm:flex-row sm:items-center sm:justify-start sm:gap-2">
        <span className="flex shrink-0 items-center gap-2 font-medium">
          <DisclosureCaret className="text-muted group-open/recap:rotate-90" />
          {t("trips.recapNote.heading")}
        </span>
        {/* The note itself at rest, one line of it — what a passing glance
            needs is "is there one, and does it still read right", not the
            form. `min-w-0 truncate` so a long note ellipses instead of pushing
            the row wider than the card; `pl-5` on the stacked layout keeps it
            under the label rather than under the caret. */}
        <span className="min-w-0 truncate pl-5 text-muted sm:pl-0">
          {shoutout ?? t("trips.recapNote.emptySummary")}
        </span>
      </summary>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t("trips.recapNote.description")}</p>
      <form action={action} className="mt-2 flex flex-col gap-3">
        <textarea
          name="recapShoutout"
          rows={3}
          maxLength={400}
          defaultValue={shoutout ?? ""}
          placeholder={t("trips.recapNote.placeholder")}
          aria-label={t("trips.recapNote.heading")}
          className={controlClass}
        />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel={t("trips.recapNote.saving")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("trips.recapNote.save")}
          </SubmitButton>
          <FormStatus tone={saved ? "success" : undefined}>
            {saved ? t("trips.notices.recapNote") : null}
          </FormStatus>
        </div>
      </form>

      {photos.length > 0 && deletePhotoAction ? (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="text-xs font-bold tracking-wide text-muted uppercase">
            {t("trips.recapPhotos.heading")}{" "}
            <span className="font-normal text-muted tabular-nums">{photos.length}</span>
          </h4>
          <p className="mt-1 text-sm text-muted">{t("trips.recapPhotos.description")}</p>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((photo) => (
              <li
                key={photo.id}
                className={sectionCardClass({ padding: "none", className: "overflow-hidden" })}
              >
                <div className="relative aspect-square w-full">
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
                  <form action={deletePhotoAction}>
                    <input type="hidden" name="photoId" value={photo.id} />
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
        </div>
      ) : null}
    </details>
  );
}
