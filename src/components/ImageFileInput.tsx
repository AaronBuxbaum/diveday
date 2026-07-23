"use client";

import { type ChangeEvent, useId, useState } from "react";
import { controlClass } from "@/components/ui/form";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "@/lib/storage/limits";

const ACCEPT = ALLOWED_IMAGE_CONTENT_TYPES.join(",");
const MAX_MB = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));

function describeProblem(files: File[], maxFiles?: number): string | null {
  if (maxFiles && files.length > maxFiles) {
    return `Choose up to ${maxFiles} photo${maxFiles === 1 ? "" : "s"} at a time.`;
  }
  const badType = files.find(
    (file) =>
      !ALLOWED_IMAGE_CONTENT_TYPES.includes(
        file.type as (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number],
      ),
  );
  if (badType) return `${badType.name}: use a JPG, PNG, WebP, or HEIC photo.`;
  const tooBig = files.find((file) => file.size > MAX_IMAGE_BYTES);
  if (tooBig) return `${tooBig.name}: that's over ${MAX_MB} MB — try a smaller photo.`;
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
}: {
  /** Pass when a sibling `<label htmlFor>` targets this input directly (not wrapping it). */
  id?: string;
  name: string;
  multiple?: boolean;
  /** Only meaningful with `multiple` — caps how many files one pick may select. */
  maxFiles?: number;
  required?: boolean;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      setError(null);
      return;
    }
    const problem = describeProblem(files, maxFiles);
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
