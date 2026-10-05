"use client";

import { type ChangeEvent, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { describeImageProblem, IMAGE_ACCEPT } from "@/components/ImageFileInput";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";

/**
 * Every word the tile can show, resolved by the caller, for the reason
 * `ImageFileInputCopy` gives: a Client Component takes its copy as props.
 */
export type ImageUploadTileCopy = {
  /** The tile's own words, and its accessible name: "Add a photo". */
  add: string;
  /** Shown on the tile while the picked photo is on its way up. */
  adding: string;
  wrongTypeSuffix: string;
  tooBigSuffix: string;
};

/**
 * **One control that picks and uploads, drawn as the next cell of the photo
 * grid it adds to.** A gallery that saves itself (the crew photos on a returned
 * departure) used to stack a caption, a "Choose a photo" button and a separate
 * "Upload photo" button: three things to read for one act, and the second
 * button did nothing until the first had been used. Picking a photo *is* the
 * decision, so the pick submits the form, and while it travels the tile shows
 * the photo itself, dimmed, under "Uploading photo…". An empty gallery is this
 * one dashed tile, which is its own empty state.
 *
 * Use it only where a form exists to send one photo. A photo that rides a
 * larger form's own save (a course hero, a site map) keeps `ImageFileInput`,
 * because there the pick is one answer among many and must not submit.
 *
 * It must render inside the `<form>` it submits: `useFormStatus` reads that
 * form, and `requestSubmit()` finds it through the input. The anatomy is
 * `ImageFileInput`'s: the input `sr-only` inside the `<label>` that is the
 * visible control, so the tile is one tab stop and draws the ring from
 * `has-[:focus-visible]`. The same early refusal applies, and the server still
 * re-validates on receipt.
 */
export function ImageUploadTile({
  id,
  name,
  copy,
}: {
  id?: string;
  name: string;
  copy: ImageUploadTileCopy;
}) {
  const { pending } = useFormStatus();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const errorId = useId();

  // The object URL lives exactly as long as the upload it previews: once the
  // form settles the saved photo has its own cell, so this one lets go.
  useEffect(() => {
    if (pending || !preview) return;
    URL.revokeObjectURL(preview);
    setPreview(null);
  }, [pending, preview]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const problem = describeImageProblem(files, undefined, copy);
    if (problem) {
      input.value = "";
      setError(problem);
      return;
    }
    setError(null);
    setPreview(URL.createObjectURL(files[0]));
    input.form?.requestSubmit();
  }

  return (
    <div>
      <label
        className={`relative flex aspect-square w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-panel border border-dashed border-border-strong p-3 text-center text-sm font-medium text-primary has-[:focus-visible]:focus-ring ${
          pending ? "cursor-progress" : "cursor-pointer hover:bg-foreground/8"
        }`}
      >
        {pending && preview ? (
          // A blob URL of the reader's own file: there is nothing for
          // `next/image` to optimise, and it would refuse the scheme.
          // biome-ignore lint/performance/noImgElement: local blob preview
          <img
            src={preview}
            alt=""
            className="absolute inset-0 size-full object-cover opacity-40"
          />
        ) : null}
        {pending ? null : <DiveDayIcon name="plus" className="relative size-6" />}
        <span className="relative" aria-live="polite">
          {pending ? copy.adding : copy.add}
        </span>
        <input
          id={id}
          type="file"
          name={name}
          required
          accept={IMAGE_ACCEPT}
          disabled={pending}
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
  );
}
