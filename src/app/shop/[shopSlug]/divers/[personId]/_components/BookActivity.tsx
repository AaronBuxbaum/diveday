import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { formatShortDate } from "@/lib/format";
import { bookActivityAction } from "../actions";
import type { DiverProfile, Shop, UpcomingTrip } from "./shared";

export function BookActivity({
  diver,
  shop,
  upcoming,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shop: Shop;
  upcoming: UpcomingTrip[];
  shopSlug: string;
  personId: string;
}) {
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="book-activity-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="book-activity-heading" className="text-lg font-semibold">
            Book an activity
          </h2>
          <p className="mt-1 text-sm text-muted">
            Add this diver to an available course or dive, then create the order from their booking.
          </p>
        </div>
      </div>
      {diver.person.email ? (
        <form
          action={bookActivityAction.bind(null, shopSlug, personId)}
          className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-end"
        >
          <FieldGrid columns={1} className="flex-1">
            <Field label="Course or dive">
              <select name="tripId" required defaultValue="" className={controlClass}>
                <option value="" disabled>
                  Choose an available activity
                </option>
                {upcoming.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.course ? `${trip.course.title} — ` : ""}
                    {trip.title} · {formatShortDate(trip.startsAt, "en-US", shop.timezone)}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <SubmitButton pendingLabel="Booking…" className={buttonClass({ size: "lg" })}>
            Book activity
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          Add an email address before booking. It identifies the diver and is needed to send their
          order.
        </p>
      )}
      {diver.person.email && upcoming.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No open activities are available right now.</p>
      ) : null}
    </section>
  );
}
