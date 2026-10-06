"use client";

import { type ChangeEvent, useEffect, useId, useState } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "@/lib/storage/limits";

export const IMAGE_ACCEPT = ALLOWED_IMAGE_CONTENT_TYPES.join(",");

/**
 * Every word this input can show, resolved by the caller — a Client
 * Component takes copy as props rather than a translator (see
 * `src/i18n/staff-messages.ts`), and this one is shared across both staff
 * and diver surfaces, so neither i18n runtime is a natural fit here.
 * `wrongTypeSuffix`/`tooBigSuffix` follow the picked file's own name, so
 * only the *tail* of the sentence is translated; `tooMany` is fully
 * resolved (the caller already knows `maxFiles`) and only needed when
 * `multiple` is set.
 *
 * `choose`/`chooseAnother` are the button's own words. They are props for the
 * reason the rest are, and because the alternative was the browser's: a bare
 * `<input type="file">` renders "Choose Files" in the *device's* language
 * whatever the reader's is, so a Spanish diver met one English control on a
 * page where every other word was Spanish (issue #807).
 */
export type ImageFileInputCopy = {
  tooMany?: string;
  wrongTypeSuffix: string;
  tooBigSuffix: string;
  choose: string;
  chooseAnother: string;
};

export function describeImageProblem(
  files: File[],
  maxFiles: number | undefined,
  copy: Pick<ImageFileInputCopy, "tooMany" | "wrongTypeSuffix" | "tooBigSuffix">,
): string | null {
  if (maxFiles && files.length > maxFiles && copy.tooMany) return copy.tooMany;
  const badType = files.find(
    (file) =>
      !ALLOWED_IMAGE_CONTENT_TYPES.includes(
        file.type as (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number],
      ),
  );
  if (badType) return `${badType.name}${copy.wrongTypeSuffix}`;
  const tooBig = files.find((file) => file.size > MAX_IMAGE_BYTES);
  if (tooBig) return `${tooBig.name}${copy.tooBigSuffix}`;
  return null;
}

/** How big the tile is drawn: the cell it sits beside. */
export type ImageTileShape = "cell" | "square" | "logo";

/**
 * Each shape is the size of the photo it stands in for, so a tile sits in the
 * same grid as the photos already saved and lines up with them: `cell` is a
 * `RemovablePhoto` cell (96px tall, its column wide), `square` a recap gallery
 * square, `logo` the 96px square a shop's logo is drawn as everywhere.
 */
const TILE_SIZE: Record<ImageTileShape, string> = {
  cell: "h-24 w-full",
  square: "aspect-square w-full",
  logo: "size-24",
};

/**
 * **A photo is picked from a tile in the photo grid, and the tile then shows
 * the photo.** A file input that rejects an oversize or wrong-type photo the
 * moment it's picked, before the form is ever submitted — the server
 * (`storeImage` in `src/lib/storage/index.ts`) still re-validates on receipt
 * and remains the actual authority; this only saves a round trip on the common
 * mistake (CR-011). Clearing the input on rejection means a submit can't
 * silently carry a file the user was just told is invalid.
 *
 * **It used to be a grey "Choose a photo" button with a filename beside it**,
 * under or over a grid of the photos already saved: the photo you picked was a
 * word, the ones you had were pictures, and the two sat in different places on
 * the form. Aaron read it as confusing on every editor that had one
 * (2026-10-06). Now the control is a dashed tile drawn at the size of the
 * photo it stands for, placed as the next cell of the grid its photos sit in,
 * and a pick turns into the photo itself, named under it, until the form's own
 * save sends it. `ImageUploadTile` is the same tile for a form whose only job
 * is the one photo, where the pick submits; this one rides a larger save, so
 * the pick never submits.
 *
 * **It renders grid cells, not a block.** One picked photo is drawn inside the
 * tile (the tile *becomes* the photo, captioned "Choose another"); several are
 * drawn as cells of their own before the tile. So the caller places this
 * inside the same grid as the stored photos, as the last cell.
 *
 * The anatomy is the one issue #807 settled: the input `sr-only` inside the
 * `<label>` that is the visible control, so it is one tab stop, the app's own
 * words in the reader's language rather than the device's, and the label draws
 * the ring from `has-[:focus-visible]`.
 *
 * **There is deliberately no `className` escape hatch.** A prop that lets each
 * call site keep the appearance it happens to have preserves the drift behind
 * an abstraction — the same reason `SectionCard` has no `radius`.
 */
export function ImageFileInput({
  id,
  name,
  multiple,
  maxFiles,
  required,
  shape = "cell",
  copy,
}: {
  /**
   * Pass alongside a `<Field htmlFor>` (or any sibling caption) that names this
   * input. The caption and the tile both end up labelling it, in that order —
   * "Map image (optional)" then "Choose a photo". What it must not be is a
   * caption `<label>` **wrapping** this one; `Field` avoids that whenever
   * `htmlFor` is set.
   */
  id?: string;
  name: string;
  multiple?: boolean;
  /** Only meaningful with `multiple` — caps how many files one pick may select. */
  maxFiles?: number;
  required?: boolean;
  shape?: ImageTileShape;
  copy: ImageFileInputCopy;
}) {
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; preview: string | null }[]>([]);
  const errorId = useId();

  // The previews are the reader's own files, held as object URLs only while
  // they are on screen: a new pick, or leaving the page, lets the last go.
  useEffect(
    () => () => {
      for (const file of picked) if (file.preview) URL.revokeObjectURL(file.preview);
    },
    [picked],
  );

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      setError(null);
      setPicked([]);
      return;
    }
    const problem = describeImageProblem(files, maxFiles, copy);
    if (problem) {
      event.target.value = "";
      setError(problem);
      setPicked([]);
      return;
    }
    setError(null);
    // The filename stays under the photo: it needs no words of its own, so no
    // locale, and it is what a screen reader has in place of the picture.
    setPicked(
      files.map((file) => ({
        name: file.name,
        preview: typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
      })),
    );
  }

  const size = TILE_SIZE[shape];
  const inTile = picked.length === 1 ? picked[0] : null;
  const caption = (text: string) => (
    <span className="mt-1 block min-w-0 truncate text-xs font-medium text-muted">{text}</span>
  );

  return (
    <>
      {picked.length > 1
        ? picked.map((file, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one pick's files, replaced whole, never reordered
            <div key={index} className={shape === "logo" ? "w-24" : undefined}>
              <PickedPhoto preview={file.preview} className={size} />
              {caption(file.name)}
            </div>
          ))
        : null}
      <div className={shape === "logo" ? "w-24" : undefined}>
        <label className="group block cursor-pointer">
          {inTile ? (
            <PickedPhoto
              preview={inTile.preview}
              className={`${size} group-has-[:focus-visible]:focus-ring`}
            />
          ) : (
            <span
              className={`${size} flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border-strong p-2 text-center text-sm font-medium text-primary transition group-hover:bg-foreground/8 group-has-[:focus-visible]:focus-ring`}
            >
              <DiveDayIcon name="plus" className="size-5" />
              <span className="text-balance">
                {picked.length > 1 ? copy.chooseAnother : copy.choose}
              </span>
            </span>
          )}
          {inTile ? (
            <>
              {caption(inTile.name)}
              <span className="block text-xs font-medium text-primary">{copy.chooseAnother}</span>
            </>
          ) : null}
          <input
            id={id}
            type="file"
            name={name}
            multiple={multiple}
            required={required}
            accept={IMAGE_ACCEPT}
            onChange={handleChange}
            aria-describedby={error ? errorId : undefined}
            className="sr-only"
          />
        </label>
        {error ? (
          <p id={errorId} role="alert" className="mt-2 text-xs font-normal text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** A picked photo, drawn the way a saved one is until the save sends it. */
function PickedPhoto({ preview, className }: { preview: string | null; className: string }) {
  return (
    <span
      className={`${className} block overflow-hidden rounded-lg border-2 border-border bg-surface-sunken`}
    >
      {preview ? (
        // A blob URL of the reader's own file: there is nothing for
        // `next/image` to optimise, and it would refuse the scheme.
        // biome-ignore lint/performance/noImgElement: local blob preview
        <img src={preview} alt="" className="size-full object-cover" />
      ) : null}
    </span>
  );
}
