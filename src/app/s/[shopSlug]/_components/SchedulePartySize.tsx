"use client";

import { controlClass, Field, FieldGrid } from "@/components/ui/form";

/** Party size is a URL preference, not a reservation. */
export function SchedulePartySize({
  value,
  copy,
  submit,
}: {
  value: number | null;
  copy: { partySize: string; anyPartySize: string };
  submit: () => void;
}) {
  return (
    <FieldGrid columns={1} className="min-w-40">
      <Field label={copy.partySize}>
        <select
          key={value ?? "any"}
          name="partySize"
          defaultValue={value ?? ""}
          onChange={submit}
          className={controlClass}
        >
          <option value="">{copy.anyPartySize}</option>
          {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </Field>
    </FieldGrid>
  );
}
