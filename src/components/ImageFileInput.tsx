"use client";

import { type ChangeEvent, useId, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "@/lib/storage/limits";

const ACCEPT = ALLOWED_IMAGE_CONTENT_TYPES.join(",");

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

function describeProblem(
  files: File[],
  maxFiles: number | undefined,
  copy: ImageFileInputCopy,
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

/**
 * A file input that rejects an oversize or wrong-type photo the moment it's
 * picked, before the form is ever submitted — the server (`storeImage` in
 * `src/lib/storage/index.ts`) still re-validates on receipt and remains the
 * actual authority; this only saves a round trip on the common mistake
 * (CR-011). Clearing the input on rejection means a submit can't silently
 * carry a file the user was just told is invalid.
 *
 * **It looks like the rest of the app, which it did not.** This rendered a bare
 * `<input type="file">` and left appearance to a `className` no caller passed
 * — so every surface where somebody picks a *photo* got the operating system's
 * grey "Choose Files / No file chosen", including `/recap/[token]`, the most
 * carefully designed page in the product and the one a diver meets an hour off
 * the boat. Meanwhile the CSV picker in Settings had a real control. Exactly
 * backwards (issue #807).
 *
 * The treatment is `ImportWizard`'s, lifted here so every caller gets it: the
 * input `sr-only` inside a `<label>` wearing `buttonClass`, with what was
 * picked named beside it in the app's own words.
 *
 * **There is deliberately no `className` escape hatch any more.** A prop that
 * lets each call site keep the appearance it happens to have preserves the
 * drift behind an abstraction — the same reason `SectionCard` has no `radius`.
 */
export function ImageFileInput({
  id,
  name,
  multiple,
  maxFiles,
  required,
  copy,
}: {
  /**
   * Pass alongside a `<Field htmlFor>` (or any sibling caption) that names this
   * input. The caption and the button below both end up labelling it, in that
   * order — "Map image (optional)" then "Choose a photo" — which is what a
   * caption *plus* an action reads as anyway. What it must not be is a caption
   * `<label>` **wrapping** this one; `Field` avoids that whenever `htmlFor` is
   * set.
   */
  id?: string;
  name: string;
  multiple?: boolean;
  /** Only meaningful with `multiple` — caps how many files one pick may select. */
  maxFiles?: number;
  required?: boolean;
  copy: ImageFileInputCopy;
}) {
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const errorId = useId();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      setError(null);
      setPicked(null);
      return;
    }
    const problem = describeProblem(files, maxFiles, copy);
    if (problem) {
      event.target.value = "";
      setError(problem);
      setPicked(null);
      return;
    }
    setError(null);
    // What was picked, named — the half of the native control that was worth
    // keeping, since "No file chosen" was the only thing it ever said in the
    // reader's favour. Filenames rather than a count, so it needs no words of
    // its own and therefore no locale: the browser's list separator is the one
    // thing here that is genuinely the device's to choose.
    setPicked(files.map((file) => file.name).join(", "));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {/* The label *wraps* the input rather than pointing at it, so the
            control is one tab stop and one target: the thing that looks like a
            button *is* the file input's label. The input stays `sr-only` and
            not `hidden`, because a `display:none` control carrying `required`
            makes Chrome refuse the whole submit with "not focusable" instead of
            reporting the field — which is the shape `ImportWizard` already
            uses. Focus therefore lands on the invisible input, so the ring is
            drawn by `focus-within` on the label. */}
        <label
          className={buttonClass({
            variant: "secondary",
            className:
              "cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary",
          })}
        >
          {picked ? copy.chooseAnother : copy.choose}
          <input
            id={id}
            type="file"
            name={name}
            multiple={multiple}
            required={required}
            accept={ACCEPT}
            onChange={handleChange}
            aria-describedby={error ? errorId : undefined}
            className="sr-only"
          />
        </label>
        {picked ? <span className="min-w-0 truncate text-sm text-muted">{picked}</span> : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-xs font-normal text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
