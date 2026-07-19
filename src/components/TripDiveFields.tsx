"use client";

import { useState } from "react";

type DiveOption = { id: string; name: string };
type InitialDive = {
  title: string | null;
  diveSiteId: string | null;
  description: string | null;
};

const inputClass =
  "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

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
        <label className="flex shrink-0 flex-col gap-1 text-sm font-medium sm:w-36">
          Number of dives
          <select
            name="plannedDives"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className={inputClass}
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value} {value === 1 ? "dive" : "dives"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-3">
        {Array.from({ length: count }, (_, index) => {
          const initial = initialDives[index];
          const number = index + 1;
          return (
            <fieldset key={number} className="rounded-xl border border-border bg-surface p-4">
              <legend className="px-1 text-sm font-semibold text-primary">Dive {number}</legend>
              <div className="mt-1 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Name <span className="font-normal text-muted">(optional)</span>
                  <input
                    name={`dive-${number}-title`}
                    type="text"
                    maxLength={120}
                    defaultValue={initial?.title ?? ""}
                    placeholder={number === 1 ? "Molasses Reef" : "Second tank · site TBD"}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Site briefing <span className="font-normal text-muted">(optional)</span>
                  <select
                    name={`dive-${number}-siteId`}
                    defaultValue={initial?.diveSiteId ?? ""}
                    className={inputClass}
                  >
                    <option value="">No saved site briefing</option>
                    {diveSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
                  Diver-facing details <span className="font-normal text-muted">(optional)</span>
                  <textarea
                    name={`dive-${number}-description`}
                    rows={2}
                    maxLength={500}
                    defaultValue={initial?.description ?? ""}
                    placeholder="What divers should know about this part of the trip."
                    className={inputClass}
                  />
                </label>
              </div>
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
