"use client";

import { useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { fill, pluralForm } from "@/i18n/fill";
import { DOCK_DAY_LIMITS } from "@/lib/diver-planning";

type DiveOption = { id: string; name: string };
type InitialDive = {
  title: string | null;
  diveSiteId: string | null;
  description: string | null;
  travelMinutes: number | null;
};

export type TripDiveFieldsCopy = {
  heading: string;
  description: string;
  twoTankTrip: string;
  diveCountTripOne: string;
  diveCountTripOther: string;
  numberOfDivesLabel: string;
  diveOptionOne: string;
  diveOptionOther: string;
  diveLegend: string;
  nameLabel: string;
  optionalHint: string;
  namePlaceholderFirst: string;
  namePlaceholderOther: string;
  diveSiteLabel: string;
  noSiteChosen: string;
  travelLabelFirst: string;
  travelLabelOther: string;
  travelHint: string;
  diverFacingDetailsLabel: string;
  footerNote: string;
};

export function TripDiveFields({
  diveSites,
  initialCount = 2,
  initialDives = [],
  copy,
  disabled = false,
  onCountChange,
  onFirstDiveSiteChange,
}: {
  diveSites: DiveOption[];
  initialCount?: number;
  initialDives?: InitialDive[];
  copy: TripDiveFieldsCopy;
  /**
   * Renders every control inert *and out of the form's submission*. A caller
   * that keeps this block mounted while it is off screen (the schedule board's
   * add panel, which hides rather than unmounts so nothing typed is lost)
   * relies on that: a disabled control submits nothing, so its `plannedDives`
   * cannot collide with a caller's own.
   */
  disabled?: boolean;
  /** Fires when the dive count changes, for a caller mirroring it elsewhere. */
  onCountChange?: (count: number) => void;
  /** Fires when dive one's site changes, likewise. */
  onFirstDiveSiteChange?: (diveSiteId: string) => void;
}) {
  const [count, setCount] = useState(Math.min(4, Math.max(1, initialCount)));

  return (
    <section
      // `hidden` rather than unmounted, when a caller asks: React drops the
      // state of an unmounted subtree, and these are a staff member's typed
      // dive plans.
      hidden={disabled}
      className="rounded-panel border border-border bg-surface-sunken/45 p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold">{copy.heading}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {fill(copy.description, {
              tripShape:
                count === 2
                  ? copy.twoTankTrip
                  : fill(
                      pluralForm(count, {
                        one: copy.diveCountTripOne,
                        other: copy.diveCountTripOther,
                      }),
                      { count },
                    ),
            })}
          </p>
        </div>
        <FieldGrid columns={1} className="shrink-0 sm:w-36">
          <Field label={copy.numberOfDivesLabel}>
            <select
              name="plannedDives"
              value={count}
              disabled={disabled}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCount(next);
                onCountChange?.(next);
              }}
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
            <fieldset
              key={number}
              disabled={disabled}
              className="rounded-inset border border-border bg-surface p-4"
            >
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
                <Field label={copy.diveSiteLabel} hint={copy.optionalHint}>
                  <select
                    name={`dive-${number}-siteId`}
                    defaultValue={initial?.diveSiteId ?? ""}
                    onChange={
                      number === 1
                        ? (event) => onFirstDiveSiteChange?.(event.target.value)
                        : undefined
                    }
                    className={controlClass}
                  >
                    <option value="">{copy.noSiteChosen}</option>
                    {diveSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {/* Per leg, not per trip: a departure is dock -> A -> B -> dock
                    and the legs are order-dependent, so one number on the trip
                    could never say "10 minutes out to the house reef, 25 across
                    to the wall" (ADR 20260815-per-leg-travel-minutes). Left
                    blank it stays on the shop's own ride-out figure, which is
                    what every departure read before this box existed. */}
                <Field
                  label={number === 1 ? copy.travelLabelFirst : copy.travelLabelOther}
                  hint={copy.travelHint}
                >
                  <input
                    name={`dive-${number}-travelMinutes`}
                    type="number"
                    inputMode="numeric"
                    min={DOCK_DAY_LIMITS.boatRideMinutes.min}
                    max={DOCK_DAY_LIMITS.boatRideMinutes.max}
                    step={5}
                    defaultValue={initial?.travelMinutes ?? ""}
                    className={`${controlClass} tabular-nums`}
                  />
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
