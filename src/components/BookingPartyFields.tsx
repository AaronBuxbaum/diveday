"use client";

import { useEffect, useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";

const diverSlots = ["one", "two", "three", "four", "five", "six"] as const;

export function BookingPartyFields({ maxPartySize }: { maxPartySize: number }) {
  const [size, setSize] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const limit = Math.max(1, Math.min(6, maxPartySize));
  useEffect(() => setHydrated(true), []);
  return (
    <>
      <FieldGrid columns={1} className="max-w-48">
        <Field label="Number of divers" className="text-base">
          <select
            name="partySize"
            value={size}
            data-hydrated={hydrated ? "true" : "false"}
            onChange={(event) => setSize(Number(event.target.value))}
            className={controlClass}
          >
            {Array.from({ length: limit }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? "diver" : "divers"}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      {diverSlots.slice(0, size).map((slot, index) => (
        <fieldset key={slot} className="rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-muted">
            {index === 0 ? "Your details" : `Diver ${index + 1}`}
          </legend>
          <FieldGrid columns={2}>
            <Field label={index === 0 ? "Name" : `Diver ${index + 1} name`} className="text-base">
              <input name={`fullName-${index}`} required maxLength={120} className={controlClass} />
            </Field>
            <Field label={index === 0 ? "Email" : `Diver ${index + 1} email`} className="text-base">
              <input
                name={`email-${index}`}
                type="email"
                required
                maxLength={200}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>
      ))}
    </>
  );
}
