"use client";

import { type ChangeEvent, useId, useState } from "react";
import { controlClass } from "@/components/ui/form";
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
 */
export type ImageFileInputCopy = {
  tooMany?: string;
  wrongTypeSuffix: string;
  tooBigSuffix: string;
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
 */
export function ImageFileInput({
  id,
  name,
  multiple,
  maxFiles,
  required,
  className = controlClass,
  copy,
}: {
  /** Pass when a sibling `<label htmlFor>` targets this input directly (not wrapping it). */
  id?: string;
  name: string;
  multiple?: boolean;
  /** Only meaningful with `multiple` — caps how many files one pick may select. */
  maxFiles?: number;
  required?: boolean;
  className?: string;
  copy: ImageFileInputCopy;
}) {
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      setError(null);
      return;
    }
    const problem = describeProblem(files, maxFiles, copy);
    if (problem) {
      event.target.value = "";
      setError(problem);
      return;
    }
    setError(null);
  }

  return (
    <div>
      <input
        id={id}
        type="file"
        name={name}
        multiple={multiple}
        required={required}
        accept={ACCEPT}
        onChange={handleChange}
        aria-describedby={error ? errorId : undefined}
        className={className}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs font-normal text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
