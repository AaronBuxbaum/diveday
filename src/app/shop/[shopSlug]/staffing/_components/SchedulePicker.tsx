"use client";

import { controlClass } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * The schedule's one scope control: everyone, the reader, or (for a manager) any one
 * person. Choosing applies at once; there is no button to press.
 */
export function SchedulePicker({
  week,
  value,
  label,
  options,
}: {
  week: string;
  value: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <QueryForm keep={{ week }} className="mb-6">
      <select
        key={value}
        name="person"
        defaultValue={value}
        aria-label={label}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className={`${controlClass} w-auto min-w-48`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </QueryForm>
  );
}
