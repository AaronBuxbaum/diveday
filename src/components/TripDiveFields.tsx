"use client";

import { useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";

type DiveOption = { id: string; name: string };
type InitialDive = {
  title: string | null;
  diveSiteId: string | null;
  description: string | null;
};

export function TripDiveFields({
  diveSites,
  initialCount = 2,
  initialDives = [],
}: {
  diveSites: DiveOption[];
  initialCount?: number;
  initialDives?: InitialDive[];
}) {
  const [count, setCount] = useState(Math.min(4, Math.max(1, initialCount)));

  return (
    <section className="rounded-2xl border border-border bg-surface-sunken/45 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold">Dive plan</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Add the details you know. Leaving a dive blank is okay — divers will still see a clear{" "}
            {count === 2 ? "two-tank trip" : `${count}-dive trip`} plan.
          </p>
        </div>
        <FieldGrid columns={1} className="shrink-0 sm:w-36">
          <Field label="Number of dives">
            <select
              name="plannedDives"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              className={controlClass}
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? "dive" : "dives"}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
      </div>

      <div className="mt-5 grid gap-3">
        {Array.from({ length: count }, (_, index) => {
          const initial = initialDives[index];
          const number = index + 1;
          return (
            <fieldset key={number} className="rounded-xl border border-border bg-surface p-4">
              <legend className="px-1 text-sm font-semibold text-primary">Dive {number}</legend>
              <FieldGrid columns={2} className="mt-1">
                <Field label="Name" hint="(optional)">
                  <input
                    name={`dive-${number}-title`}
                    type="text"
                    maxLength={120}
                    defaultValue={initial?.title ?? ""}
                    placeholder={number === 1 ? "Molasses Reef" : "Second tank · site TBD"}
                    className={controlClass}
                  />
                </Field>
                <Field label="Site briefing" hint="(optional)">
                  <select
                    name={`dive-${number}-siteId`}
                    defaultValue={initial?.diveSiteId ?? ""}
                    className={controlClass}
                  >
                    <option value="">No saved site briefing</option>
                    {diveSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Diver-facing details" hint="(optional)" className="sm:col-span-2">
                  <textarea
                    name={`dive-${number}-description`}
                    rows={2}
                    maxLength={500}
                    defaultValue={initial?.description ?? ""}
                    placeholder="What divers should know about this part of the trip."
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
            </fieldset>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        Site briefings add the saved map and field guide. The trip description and conditions below
        remain shared across the whole boat day.
      </p>
    </section>
  );
}
