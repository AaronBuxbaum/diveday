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
        <FieldGrid columns={1} className="gap-y-5">
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
