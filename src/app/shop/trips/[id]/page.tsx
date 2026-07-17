import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  cancelBooking,
  getShopById,
  getTripCrewIds,
  getTripRoster,
  getTripWithBooked,
  listStaff,
  setTripCrew,
  setTripStatus,
  updateTrip,
} from "@/db/queries";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull } from "@/lib/trips";
import {
  parseWallTime,
  toDateInputValue,
  toTimeInputValue,
  utcToWallTime,
  wallTimeToUtc,
} from "@/lib/zoned";

export const metadata: Metadata = {
  title: "Manage trip — Scuba",
};

const detailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  capacity: z.coerce.number().int().min(1).max(60),
});

const BANNERS: Record<string, { tone: "success" | "danger"; text: string }> = {
  saved: { tone: "success", text: "Changes saved." },
  cancelled: { tone: "danger", text: "Trip cancelled — it's off the public schedule." },
  reinstated: { tone: "success", text: "Back on! The trip is on the schedule again." },
  crew: { tone: "success", text: "Crew updated." },
  "booking-removed": { tone: "success", text: "Booking cancelled — the spot is open again." },
  invalid: { tone: "danger", text: "Something didn't parse — check the fields and try again." },
  "end-before-start": { tone: "danger", text: "The trip has to end after it starts." },
};

export default async function ManageTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { id: tripId } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  const [staff, crewIds, roster] = await Promise.all([
    listStaff(db, shop.id),
    getTripCrewIds(db, tripId),
    getTripRoster(db, tripId),
  ]);
  const banner = notice ? BANNERS[notice] : undefined;
  const startWall = utcToWallTime(trip.startsAt, shop.timezone);
  const endWall = utcToWallTime(trip.endsAt, shop.timezone);
  const cancelled = trip.status === "cancelled";
  const back = `/shop/trips/${tripId}`;

  async function saveDetails(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=invalid`);
    const { title, description, date, startTime, endTime, capacity } = parsed.data;
    const sw = parseWallTime(date, startTime);
    const ew = parseWallTime(date, endTime);
    if (!sw || !ew) redirect(`${back}?notice=invalid`);
    const dbi = await getDb();
    const shopNow = await getShopById(dbi, s.user.shopId);
    if (!shopNow) redirect(`${back}?notice=invalid`);
    const startsAt = wallTimeToUtc(sw, shopNow.timezone);
    const endsAt = wallTimeToUtc(ew, shopNow.timezone);
    if (endsAt <= startsAt) redirect(`${back}?notice=end-before-start`);
    await updateTrip(dbi, s.user.shopId, tripId, {
      title,
      description: description || undefined,
      startsAt,
      endsAt,
      capacity,
    });
    redirect(`${back}?notice=saved`);
  }

  async function cancelTripAction() {
    "use server";
    const s = await requireStaffSession();
    await setTripStatus(await getDb(), s.user.shopId, tripId, "cancelled");
    redirect(`${back}?notice=cancelled`);
  }

  async function reinstateTripAction() {
    "use server";
    const s = await requireStaffSession();
    await setTripStatus(await getDb(), s.user.shopId, tripId, "scheduled");
    redirect(`${back}?notice=reinstated`);
  }

  async function saveCrewAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const ids = formData.getAll("crew").map(String);
    await setTripCrew(await getDb(), s.user.shopId, tripId, ids);
    redirect(`${back}?notice=crew`);
  }

  async function removeBookingAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const bookingId = String(formData.get("bookingId") ?? "");
    if (bookingId) await cancelBooking(await getDb(), s.user.shopId, bookingId);
    redirect(`${back}?notice=booking-removed`);
  }

  const inputClass =
    "rounded-lg border border-border bg-background px-3 py-2 text-base font-normal";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link href="/shop" className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>

      <header className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{trip.title}</h1>
        {cancelled ? (
          <span className="rounded-full bg-danger/10 px-3 py-1 text-sm font-medium text-danger">
            Cancelled
          </span>
        ) : (
          <span
            className={
              isFull(trip)
                ? "rounded-full border border-border bg-surface-sunken px-3 py-1 text-sm font-medium text-muted"
                : "rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums"
            }
          >
            {capacityLabel(trip)}
          </span>
        )}
      </header>
      <p className="mt-1 text-muted">
        {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
        {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
      </p>

      {banner ? (
        <p
          role="status"
          className={
            banner.tone === "success"
              ? "mt-6 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
              : "mt-6 rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
          }
        >
          {banner.text}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Details</h2>
        <form action={saveDetails} className="mt-4 flex flex-col gap-5">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Title
            <input
              name="title"
              type="text"
              required
              maxLength={120}
              defaultValue={trip.title}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Description <span className="font-normal text-muted">(optional)</span>
            <textarea
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={trip.description ?? ""}
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Date
              <input
                name="date"
                type="date"
                required
                defaultValue={toDateInputValue(startWall)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Departs
              <input
                name="startTime"
                type="time"
                required
                defaultValue={toTimeInputValue(startWall)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Returns
              <input
                name="endTime"
                type="time"
                required
                defaultValue={toTimeInputValue(endWall)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Capacity
              <input
                name="capacity"
                type="number"
                required
                min={1}
                max={60}
                defaultValue={trip.capacity}
                className={`${inputClass} tabular-nums`}
              />
            </label>
          </div>
          <div>
            <button
              type="submit"
              className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            >
              Save changes
            </button>
          </div>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Crew</h2>
        <p className="mt-1 text-sm text-muted">Who's running this trip.</p>
        {staff.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No staff on file yet.</p>
        ) : (
          <form action={saveCrewAction} className="mt-4 flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {staff.map(({ person, roles }) => (
                <li key={person.id}>
                  <label className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="crew"
                      value={person.id}
                      defaultChecked={crewIds.includes(person.id)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="font-medium">{person.fullName}</span>
                    <span className="text-muted">{roles.join(", ")}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div>
              <button
                type="submit"
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
              >
                Save crew
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">
          Divers{" "}
          <span className="font-normal text-muted tabular-nums">
            {trip.booked} of {trip.capacity}
          </span>
        </h2>
        {roster.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
            No bookings yet — share the trip page and they'll show up here.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {roster.map(({ booking, person }) => (
              <li
                key={booking.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{person.fullName}</p>
                  <p className="text-muted">{person.email ?? "no email on file"}</p>
                </div>
                <form action={removeBookingAction} className="shrink-0">
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <button
                    type="submit"
                    className="rounded-lg px-3 py-1.5 font-medium text-danger transition-colors duration-200 hover:bg-danger/10"
                  >
                    Cancel booking
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-6">
        {cancelled ? (
          <form action={reinstateTripAction}>
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            >
              Reinstate trip
            </button>
          </form>
        ) : (
          <form action={cancelTripAction} className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition-colors duration-200 hover:bg-danger/10"
            >
              Cancel trip
            </button>
            <p className="text-sm text-muted">
              Takes it off the public schedule. You can reinstate it any time.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
