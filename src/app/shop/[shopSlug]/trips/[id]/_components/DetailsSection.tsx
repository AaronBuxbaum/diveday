import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { toDateInputValue, toTimeInputValue, type WallTime } from "@/lib/zoned";
import type { DiveSiteList, Trip, TripDiveList } from "./types";

export function DetailsSection({
  action,
  trip,
  diveSiteList,
  tripDiveList,
  startWall,
  endWall,
}: {
  action: (formData: FormData) => void;
  trip: Trip;
  diveSiteList: DiveSiteList;
  tripDiveList: TripDiveList;
  startWall: WallTime;
  endWall: WallTime;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Details</h2>
      <form action={action} className="mt-4 flex flex-col gap-5">
        <FieldGrid columns={1} className="max-w-2xl gap-y-5">
          <Field label="Title">
            <input
              name="title"
              type="text"
              required
              maxLength={120}
              defaultValue={trip.title}
              className={controlClass}
            />
          </Field>
          <Field label="Description" hint="(optional)">
            <textarea
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={trip.description ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <TripDiveFields
          diveSites={diveSiteList.map((site) => ({ id: site.id, name: site.name }))}
          initialCount={trip.plannedDives}
          initialDives={tripDiveList.map(({ dive }) => ({
            title: dive.title,
            diveSiteId: dive.diveSiteId,
            description: dive.description,
          }))}
        />
        <FieldGrid columns={1} className="gap-x-5 gap-y-5 sm:grid-cols-5">
          <Field label="Date">
            <input
              name="date"
              type="date"
              required
              defaultValue={toDateInputValue(startWall)}
              className={controlClass}
            />
          </Field>
          <Field label="Departs">
            <input
              name="startTime"
              type="time"
              required
              defaultValue={toTimeInputValue(startWall)}
              className={controlClass}
            />
          </Field>
          <Field label="Returns">
            <input
              name="endTime"
              type="time"
              required
              defaultValue={toTimeInputValue(endWall)}
              className={controlClass}
            />
          </Field>
          <Field label="Capacity">
            <input
              name="capacity"
              type="number"
              required
              min={1}
              max={60}
              defaultValue={trip.capacity}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <Field label="Price per diver" hint="(optional)">
            <input
              name="priceDollars"
              type="number"
              step="0.01"
              min={0}
              placeholder="$0.00"
              defaultValue={trip.priceCents === null ? "" : (trip.priceCents / 100).toFixed(2)}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border bg-surface p-5">
          <legend className="px-1 text-sm font-medium">Pay at booking</legend>
          <p className="text-sm text-muted">
            Optional. Leave the deposit blank to charge the full fare when a diver books online.
          </p>
          <FieldGrid columns={2} className="mt-4 gap-x-5 gap-y-5">
            <Field
              label="Deposit per diver"
              hint="(optional)"
              description="Charged now; the balance is still owed at the dock. Ignored if it's blank or not below the price."
            >
              <input
                name="depositDollars"
                type="number"
                step="0.01"
                min={0}
                placeholder="$0.00"
                defaultValue={
                  trip.depositCents === null ? "" : (trip.depositCents / 100).toFixed(2)
                }
                className={`${controlClass} tabular-nums sm:w-40`}
              />
            </Field>
            <Field
              label="Free cancellation window"
              hint="(optional)"
              description="Hours before departure a diver can cancel for a refund. Shown to divers; refunds stay staff-run."
            >
              <div className="flex items-center gap-2">
                <input
                  name="cancellationWindowHours"
                  type="number"
                  step={1}
                  min={0}
                  max={720}
                  placeholder="48"
                  defaultValue={trip.cancellationWindowHours ?? ""}
                  className={`${controlClass} tabular-nums sm:w-28`}
                />
                <span className="text-sm text-muted">hours</span>
              </div>
            </Field>
          </FieldGrid>
        </fieldset>
        <div>
          <SubmitButton
            pendingLabel="Saving…"
            className={buttonClass({ size: "lg", className: "text-base" })}
          >
            Save changes
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
