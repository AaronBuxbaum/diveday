"use client";

import { useState } from "react";

const inputClass =
  "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";
const diverSlots = ["one", "two", "three", "four", "five", "six"] as const;

export function BookingPartyFields({ maxPartySize }: { maxPartySize: number }) {
  const [size, setSize] = useState(1);
  const limit = Math.max(1, Math.min(6, maxPartySize));
  return (
    <>
      <label className="flex max-w-48 flex-col gap-1 text-base font-medium">
        Number of divers
        <select
          name="partySize"
          value={size}
          onChange={(event) => setSize(Number(event.target.value))}
          className={inputClass}
        >
          {Array.from({ length: limit }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>
              {count} {count === 1 ? "diver" : "divers"}
            </option>
          ))}
        </select>
      </label>
      {diverSlots.slice(0, size).map((slot, index) => (
        <fieldset key={slot} className="rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-muted">
            {index === 0 ? "Your details" : `Diver ${index + 1}`}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-base font-medium">
              {index === 0 ? "Name" : `Diver ${index + 1} name`}
              <input name={`fullName-${index}`} required maxLength={120} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-base font-medium">
              {index === 0 ? "Email" : `Diver ${index + 1} email`}
              <input
                name={`email-${index}`}
                type="email"
                required
                maxLength={200}
                className={inputClass}
              />
            </label>
          </div>
        </fieldset>
      ))}
    </>
  );
}
