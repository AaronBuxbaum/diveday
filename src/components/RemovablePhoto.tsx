import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { StoredPhoto } from "@/components/StoredPhoto";

/**
 * The grid removable photos sit in across a full-width field — two across on
 * a phone, three from `sm` — so a full-width field holding one photo (a
 * course's hero) draws it at the size a gallery's cells are, and a gallery
 * under it lines up with it. A field in a half column (a dive site's map and
 * route stills, a trip's arrival photo) lets the photo take the column
 * instead: in this grid it would be a third of a half, about 83px wide at 640.
 */
export const removablePhotoGridClass = "grid grid-cols-2 gap-3 sm:grid-cols-3";

/**
 * **A photo a record already holds, with the box that takes it back off.**
 *
 * The whole cell is a `<label>` wrapping its own checkbox, so a tap on the
 * photo toggles *that* photo rather than the first one. Ticked, the border and
 * the caption turn danger, the image dims, and the corner tick fills: the
 * photo is still on the page, and says it is leaving on save.
 *
 * It was drawn three ways (the pixel audit, course-edit and dive-site-edit):
 * the course hero a thumbnail beside a visible checkbox, the course gallery
 * this cell, and the dive-site editor a hand copy of this cell that dropped
 * the tick. `RemovablePhoto.test.tsx` refuses a stored photo (a `StoredPhoto`
 * or a raw `<img>`) beside a checkbox anywhere else, and names the one form
 * still drawing its own: the shop settings' logo and cover photo.
 *
 * **Focus lands on the photo.** The checkbox is `sr-only`, a clipped 1px box,
 * so the global ring drew on nothing a person could see and a keyboard user
 * tabbing through a gallery saw no focus at all.
 * `peer-focus-visible:focus-ring` puts the same ring on the photo instead, the
 * way `Switch` and `StarRatingInput` ring their own hidden inputs.
 *
 * **So the dim is on the image, not the box.** Opacity is an element's whole
 * rendering, outline included: dimming the ringed box faded the ring to half,
 * below the 3:1 a focus indicator needs, the moment a keyboard user pressed
 * Space to tick the photo. `peer-checked:*:opacity-50` dims the image inside
 * the box, and the box's danger border and its ring stay whole.
 */
export function RemovablePhoto({
  url,
  name,
  value = "true",
  label,
}: {
  url: string;
  /** The form field the ticked box posts. */
  name: string;
  /** A gallery posts the photo's own URL; a single-photo field posts "true". */
  value?: string;
  /** The words under the photo, which are also the box's accessible name. */
  label: string;
}) {
  return (
    <label className="relative block cursor-pointer">
      <input type="checkbox" name={name} value={value} className="peer sr-only" />
      <StoredPhoto
        src={url}
        alt=""
        className="h-24 w-full rounded-lg border-2 border-border transition *:transition-opacity peer-checked:border-danger peer-checked:*:opacity-50 peer-focus-visible:focus-ring"
        sizes="(min-width: 640px) 25vw, 50vw"
      />
      <span
        aria-hidden="true"
        // diveday:allow-tinted-ink: the tick is `text-transparent` until the box is checked, and `text-danger` on `danger/15` measures 5.01:1 over `--surface` — this sits on a card (issue #874)
        className="absolute top-1.5 end-1.5 grid size-6 place-items-center rounded-full border border-border-strong bg-surface/90 text-sm text-transparent shadow-sm transition peer-checked:border-danger peer-checked:bg-danger/15 peer-checked:text-danger"
      >
        <DiveDayIcon name="check" className="size-4" strokeWidth={2.2} />
      </span>
      <span className="mt-1 block text-xs font-medium text-muted transition peer-checked:text-danger">
        {label}
      </span>
    </label>
  );
}
