import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { addAction } from "../actions";
import { GEAR_TYPES } from "./types";

export function AddGearForm() {
  return (
    <details
      id="add-gear"
      className="mt-8 scroll-mt-24 rounded-2xl border border-border bg-surface p-5 shadow-sm"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold [&::-webkit-details-marker]:hidden">
        Add inventory item{" "}
        <span aria-hidden="true" className="text-xl font-normal text-primary">
          +
        </span>
      </summary>
      <FieldGrid columns={2} as="form" action={addAction} className="mt-4">
        <Field label="Inventory label">
          <input
            name="label"
            required
            placeholder="BCD-12"
            className={`${controlClass} rounded-xl`}
          />
        </Field>
        <Field label="Type">
          <select name="type" className={`${controlClass} rounded-xl`}>
            {Object.entries(GEAR_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size" hint="(optional)">
          <input
            name="size"
            placeholder="Medium / 10 / 80 cu ft"
            className={`${controlClass} rounded-xl`}
          />
        </Field>
        <Field label="Next service due" hint="(optional)">
          <input name="serviceDueOn" type="date" className={`${controlClass} rounded-xl`} />
        </Field>
        <Field label="Notes" hint="(optional)" className="sm:col-span-2">
          <textarea
            name="notes"
            rows={2}
            placeholder="Serial number, fit notes, or storage location"
            className={`${controlClass} rounded-xl`}
          />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel="Adding…"
            className={buttonClass({ className: "rounded-xl py-2" })}
          >
            Add inventory item
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </details>
  );
}
