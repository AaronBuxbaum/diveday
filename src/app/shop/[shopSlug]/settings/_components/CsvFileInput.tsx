"use client";

import { type ChangeEvent, useState } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * **One file-picker grammar across Settings.** Import contacts had a styled
 * "Choose CSV file" control while Import gear history, one row above it in the
 * same group, rendered the operating system's grey "Choose File — No file
 * chosen": two spellings of the same act, one tap apart, and only one of them
 * in the reader's language (issue #807 made exactly this argument for photos).
 *
 * The treatment is `ImageFileInput`'s and `ImportWizard`'s, written once for
 * the plain server-rendered CSV forms that have neither: the input is
 * `sr-only` **inside** a `<label>` wearing `buttonClass`, so the thing that
 * looks like a button *is* the input's label — one tab stop, one target. It
 * stays `sr-only` rather than `hidden` because a `display:none` control
 * carrying `required` makes Chrome refuse the whole submit as "not focusable"
 * instead of reporting the field. Focus lands on the invisible input, so the
 * ring is drawn by `focus-within` on the label.
 *
 * What was picked is named beside it — the one half of the native control
 * worth keeping. Filenames rather than a count, so the readout needs no words
 * of its own and therefore no locale.
 */
export function CsvFileInput({
  name,
  required,
  copy,
}: {
  name: string;
  required?: boolean;
  /** A Client Component takes its words as props (src/i18n/staff-messages.ts). */
  copy: { choose: string; chooseAnother: string };
}) {
  const [picked, setPicked] = useState<string | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPicked(file?.name ?? null);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label
        className={buttonClass({
          variant: "secondary",
          className:
            "cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary",
        })}
      >
        {picked ? copy.chooseAnother : copy.choose}
        <input
          type="file"
          name={name}
          accept=".csv,text/csv"
          required={required}
          onChange={handleChange}
          className="sr-only"
        />
      </label>
      {picked ? <span className="min-w-0 truncate text-sm text-muted">{picked}</span> : null}
    </div>
  );
}
