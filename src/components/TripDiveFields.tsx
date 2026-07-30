"use client";

import { useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";

type DiveOption = { id: string; name: string };
type InitialDive = {
  title: string | null;
  diveSiteId: string | null;
  description: string | null;
};

export type TripDiveFieldsCopy = {
  heading: string;
  description: string;
  twoTankTrip: string;
  diveCountTrip: string;
  numberOfDivesLabel: string;
  diveOptionOne: string;
  diveOptionOther: string;
  diveLegend: string;
  nameLabel: string;
  optionalHint: string;
  namePlaceholderFirst: string;
  namePlaceholderOther: string;
  diveBriefingLabel: string;
  noSavedBriefing: string;
  diverFacingDetailsLabel: string;
  detailsPlaceholder: string;
  footerNote: string;
};

/** Fills `{name}` placeholders in a plain ICU-style template — never a translator crossing the client boundary. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}

export function TripDiveFields({
  diveSites,
  initialCount = 2,
  initialDives = [],
  copy,
}: {
  diveSites: DiveOption[];
  initialCount?: number;
  initialDives?: InitialDive[];
  copy: TripDiveFieldsCopy;
}) {
  const [count, setCount] = useState(Math.min(4, Math.max(1, initialCount)));

  return (
    <section className="rounded-2xl border border-border bg-surface-sunken/45 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold">{copy.heading}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {fill(copy.description, {
              tripShape: count === 2 ? copy.twoTankTrip : fill(copy.diveCountTrip, { count }),
            })}
          </p>
        </div>
        <FieldGrid columns={1} className="shrink-0 sm:w-36">
          <Field label={copy.numberOfDivesLabel}>
            <select
              name="plannedDives"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              className={controlClass}
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {fill(value === 1 ? copy.diveOptionOne : copy.diveOptionOther, { count: value })}
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
              <legend className="px-1 text-sm font-semibold text-primary">
                {fill(copy.diveLegend, { number })}
              </legend>
              <FieldGrid columns={2} className="mt-1">
                <Field label={copy.nameLabel} hint={copy.optionalHint}>
                  <input
                    name={`dive-${number}-title`}
                    type="text"
                    maxLength={120}
                    defaultValue={initial?.title ?? ""}
                    placeholder={
                      number === 1 ? copy.namePlaceholderFirst : copy.namePlaceholderOther
                    }
                    className={controlClass}
                  />
                </Field>
                <Field label={copy.diveBriefingLabel} hint={copy.optionalHint}>
                  <select
                    name={`dive-${number}-siteId`}
                    defaultValue={initial?.diveSiteId ?? ""}
                    className={controlClass}
                  >
                    <option value="">{copy.noSavedBriefing}</option>
                    {diveSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={copy.diverFacingDetailsLabel}
                  hint={copy.optionalHint}
                  className="sm:col-span-2"
                >
                  <textarea
                    name={`dive-${number}-description`}
                    rows={2}
                    maxLength={500}
                    defaultValue={initial?.description ?? ""}
                    placeholder={copy.detailsPlaceholder}
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
            </fieldset>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">{copy.footerNote}</p>
    </section>
  );
}
