"use client";

import { useState } from "react";
import { Field, textareaClassFor } from "@/components/ui/form";
import { fill, pluralForm } from "@/i18n/fill";
import { MEDICAL_ALERT_FIELD, MEDICAL_ALERT_MAX } from "@/lib/medical-alert";

/**
 * The medical alert's one box, with a count of what is left against the
 * 500-character limit (domain review 2, N4), so `maxlength` never stops
 * typing without saying why. The count is the box's description.
 */
export function MedicalAlertBox({
  id,
  label,
  hint,
  error,
  defaultValue,
  counter,
}: {
  id: string;
  label: string;
  hint: string;
  error: string | undefined;
  defaultValue: string;
  /** `{count}` in `other`. */
  counter: { one: string; other: string };
}) {
  const [length, setLength] = useState(defaultValue.length);
  const left = Math.max(0, MEDICAL_ALERT_MAX - length);
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={id}
      description={fill(pluralForm(left, counter), { count: left })}
    >
      <textarea
        id={id}
        name={MEDICAL_ALERT_FIELD}
        rows={3}
        maxLength={MEDICAL_ALERT_MAX}
        autoComplete="off"
        defaultValue={defaultValue}
        onChange={(event) => setLength(event.currentTarget.value.length)}
        className={textareaClassFor(3)}
      />
    </Field>
  );
}
