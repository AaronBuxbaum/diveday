"use client";

import { type ComponentPropsWithoutRef, useId, useState } from "react";
import {
  formatWallTime,
  readTypedMoney,
  readTypedName,
  readTypedPhone,
  readTypedTime,
  type TypedReading,
} from "@/lib/forgiving-fields";
import { controlClass } from "./form";

export type ForgivingKind = "time" | "phone" | "name" | "money";

/** Words for the reading line, resolved server-side (see `forgivingCopy`). */
export type ForgivingCopy = {
  /** "typed as “{raw}”" */
  typedAs: string;
};

/**
 * A text field that takes what a person would say out loud and shows what it
 * made of it.
 *
 * ADR 20260906-before-you-ask, decision 3 ("type it any way"), and the three
 * tests a forgiving field passes:
 *
 * 1. While the field has focus, the reading shows beneath the box with the
 *    typed text beside it ("7:00 AM · typed as “7”"). Nothing is corrected
 *    silently.
 * 2. Escape restores what was typed. Nothing is saved until the form is.
 * 3. Text the reader cannot read is left alone and submitted as typed, so the
 *    server refuses it on the field rather than this component guessing.
 *
 * The visible box carries no `name`; the hidden input beside it submits the
 * canonical value (`HH:MM` for a time, the grouped international form for a
 * phone, the major-unit figure for money), so the server sees exactly what a
 * native control would have sent. On blur the box settles to the reading's
 * label — the value that lands is the one shown.
 *
 * Never on a field from `NEVER_FORGIVING_FIELD_NAMES`;
 * `forgiving-fields.never-list.test.ts` scans every use.
 */
export function ForgivingInput({
  kind,
  name,
  id,
  defaultValue = "",
  locale,
  currency = "usd",
  country = null,
  copy,
  className,
  onCanonicalChange,
  ...input
}: {
  kind: ForgivingKind;
  name: string;
  id?: string;
  /** The canonical value already on file, if any. */
  defaultValue?: string;
  locale: string;
  /** Money only: the shop's currency. */
  currency?: string;
  /** Phone only: the shop's ISO 3166-1 alpha-2 country, for a national number. */
  country?: string | null;
  copy: ForgivingCopy;
  className?: string;
  /** Fires with the canonical value whenever it changes — for a panel that previews the result. */
  onCanonicalChange?: (canonical: string) => void;
} & Omit<
  ComponentPropsWithoutRef<"input">,
  "name" | "id" | "defaultValue" | "value" | "onChange" | "type" | "className"
>) {
  const read = (raw: string): TypedReading | null => {
    switch (kind) {
      case "time":
        return readTypedTime(raw, locale);
      case "phone":
        return readTypedPhone(raw, country);
      case "name":
        return readTypedName(raw);
      case "money":
        return readTypedMoney(raw, currency, locale);
    }
  };
  const settledLabel = (canonical: string): string => {
    if (!canonical) return "";
    if (kind === "time") return formatWallTime(canonical, locale);
    return read(canonical)?.label ?? canonical;
  };

  // `text` is what the box shows; `raw` is what the person last typed, kept
  // so Escape can bring it back after a blur settled the box to the label.
  const [text, setText] = useState(() => settledLabel(defaultValue));
  const [raw, setRaw] = useState(text);
  const [focused, setFocused] = useState(false);
  const readingId = useId();
  const reading = read(text);
  // What the form submits: the reading when there is one, else the text as
  // typed, so an unreadable entry reaches the server's own refusal.
  const canonical = reading?.canonical ?? text;
  const showReading = focused && reading !== null && reading.label !== text;

  return (
    <div className="flex flex-col gap-1">
      <input
        {...input}
        id={id}
        type="text"
        inputMode={kind === "phone" ? "tel" : kind === "money" ? "decimal" : "text"}
        value={text}
        aria-describedby={showReading ? readingId : input["aria-describedby"]}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          setRaw(next);
          onCanonicalChange?.(read(next)?.canonical ?? next);
        }}
        onFocus={(event) => {
          setFocused(true);
          input.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          if (reading) setText(reading.label);
          input.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && text !== raw) {
            event.preventDefault();
            setText(raw);
          }
          input.onKeyDown?.(event);
        }}
        className={className ?? controlClass}
      />
      <input type="hidden" name={name} value={canonical} />
      {showReading ? (
        <p id={readingId} className="text-xs text-muted tabular-nums" aria-live="polite">
          <span className="font-medium text-foreground">{reading.label}</span>
          <span aria-hidden="true"> · </span>
          {copy.typedAs.replace("{raw}", raw)}
        </p>
      ) : null}
    </div>
  );
}
