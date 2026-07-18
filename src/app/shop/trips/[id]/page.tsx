import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import { assignGear, listAvailableGear, listTripGearAssignments, returnGear } from "@/db/gear";
import { listTripRentalGearRequests } from "@/db/gear-requests";
import {
  cancelBooking,
  getShopById,
  getTripCrewIds,
  getTripRoster,
  getTripWithBooked,
  listStaff,
  restoreBooking,
  setTripCrew,
  setTripStatus,
  updateTrip,
} from "@/db/queries";
import { getTripRequirements, listTripReadiness, upsertTripRequirements } from "@/db/readiness";
import type { RentalGearRequest } from "@/db/schema";
import {
  issueWaiverRequest,
  listTripWaiverActivity,
  listTripWaiverStatuses,
  listWaiverTemplates,
} from "@/db/waivers";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull } from "@/lib/trips";
import { waiverActivityTimeline, waiverState } from "@/lib/waivers";
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

const requirementsSchema = z.object({
  requiresWaiver: z.string().optional(),
  minimumCertificationLevel: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"]).nullable(),
  ),
});

const gearAssignmentSchema = z.object({
  bookingId: z.string().uuid(),
  gearItemId: z.string().uuid(),
});

const BANNERS: Record<string, { tone: "success" | "danger"; text: string }> = {
  saved: { tone: "success", text: "Changes saved." },
  cancelled: { tone: "danger", text: "Trip cancelled — it's off the public schedule." },
  reinstated: { tone: "success", text: "Back on! The trip is on the schedule again." },
  crew: { tone: "success", text: "Crew updated." },
  "booking-removed": { tone: "success", text: "Booking cancelled — the spot is open again." },
  "booking-restored": { tone: "success", text: "Back on the roster." },
  "waiver-complete": { tone: "success", text: "That diver already has a completed waiver." },
  "waiver-error": {
    tone: "danger",
    text: "That waiver link could not be created. Try a current booking and template.",
  },
  requirements: { tone: "success", text: "Trip readiness requirements updated." },
  "gear-assigned": { tone: "success", text: "Gear added to the packing list." },
  "gear-returned": { tone: "success", text: "Gear returned to the gear room." },
  "gear-error": {
    tone: "danger",
    text: "That gear is no longer available. The packing list has been refreshed.",
  },
  invalid: {
    tone: "danger",
    text: "That didn't save — check the date, times, and capacity, then try again.",
  },
  "end-before-start": { tone: "danger", text: "The trip has to end after it starts." },
};

function rentalRequestSummary(request: RentalGearRequest | null | undefined) {
  if (!request) return "No rental request yet.";
  const requested = [
    request.bcd && "BCD",
    request.regulator && "regulator",
    request.wetsuit && "wetsuit",
    request.maskFins && "mask & fins",
    request.weights && "weights",
    request.tank && "tank",
    request.diveComputer && "computer",
  ].filter(Boolean);
  const fit = [
    request.bcdSize && `BCD ${request.bcdSize}`,
    request.wetsuitSize && `wetsuit ${request.wetsuitSize}`,
    request.bootSize && `boot ${request.bootSize}`,
    request.finSize && `fin ${request.finSize}`,
    request.weightPreference,
  ].filter(Boolean);
  return [requested.length > 0 ? requested.join(", ") : "bringing own gear", fit.join(" · ")]
    .filter(Boolean)
    .join(" — ");
}

export default async function ManageTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; bid?: string; waiver?: string }>;
}) {
  const session = await requireStaffSession();
  const { id: tripId } = await params;
  const { notice, bid, waiver } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  const [
    staff,
    crewIds,
    roster,
    templates,
    waiverRows,
    waiverActivityRows,
    requirement,
    readinessRows,
    availableGear,
    tripGearRows,
    gearRequestRows,
  ] = await Promise.all([
    listStaff(db, shop.id),
    getTripCrewIds(db, tripId),
    getTripRoster(db, tripId),
    listWaiverTemplates(db, shop.id),
    listTripWaiverStatuses(db, shop.id, tripId),
    listTripWaiverActivity(db, shop.id, tripId),
    getTripRequirements(db, shop.id, tripId),
    listTripReadiness(db, shop.id, tripId),
    listAvailableGear(db, shop.id),
    listTripGearAssignments(db, shop.id, tripId),
    listTripRentalGearRequests(db, shop.id, tripId),
  ]);
  const banner = notice ? BANNERS[notice] : undefined;
  const undoBookingId = notice === "booking-removed" ? bid : undefined;
  const startWall = utcToWallTime(trip.startsAt, shop.timezone);
  const endWall = utcToWallTime(trip.endsAt, shop.timezone);
  const cancelled = trip.status === "cancelled";
  const isCourseSession = Boolean(trip.courseId);
  const back = `/shop/trips/${tripId}`;
  const hasCourseInstructor = Boolean(
    trip.course?.requiresInstructor &&
      staff.some(
        (entry) => crewIds.includes(entry.person.id) && entry.roles.includes("instructor"),
      ),
  );
  const gearByBooking = new Map<string, { assignmentId: string; label: string; type: string }[]>();
  for (const row of tripGearRows) {
    if (!row.assignment || !row.item) continue;
    const current = gearByBooking.get(row.booking.id) ?? [];
    current.push({
      assignmentId: row.assignment.id,
      label: row.item.label,
      type: row.item.type.replace("_", " "),
    });
    gearByBooking.set(row.booking.id, current);
  }
  const gearRequestByBooking = new Map(
    gearRequestRows.map((row) => [row.booking.id, row.request] as const),
  );
  const waiverRecordsByBooking = new Map<
    string,
    Exclude<(typeof waiverActivityRows)[number]["waiver"], null>[]
  >();
  for (const row of waiverActivityRows) {
    if (!row.waiver) continue;
    const current = waiverRecordsByBooking.get(row.booking.id) ?? [];
    current.push(row.waiver);
    waiverRecordsByBooking.set(row.booking.id, current);
  }

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
    if (!bookingId) redirect(back);
    await cancelBooking(await getDb(), s.user.shopId, bookingId);
    redirect(`${back}?notice=booking-removed&bid=${bookingId}`);
  }

  async function undoRemoveBookingAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const bookingId = String(formData.get("bookingId") ?? "");
    if (bookingId) await restoreBooking(await getDb(), s.user.shopId, bookingId);
    redirect(`${back}?notice=booking-restored`);
  }

  async function issueWaiverAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const bookingId = String(formData.get("bookingId") ?? "");
    const templateId = String(formData.get("templateId") ?? "");
    if (!bookingId || !templateId) redirect(`${back}?notice=waiver-error`);
    const outcome = await issueWaiverRequest(await getDb(), {
      shopId: s.user.shopId,
      bookingId,
      templateId,
    });
    if (!outcome.ok) {
      redirect(
        `${back}?notice=${outcome.reason === "already_completed" ? "waiver-complete" : "waiver-error"}`,
      );
    }
    redirect(`${back}?notice=waiver-link&bid=${bookingId}&waiver=${outcome.token}`);
  }

  async function saveRequirementsAction(formData: FormData) {
    "use server";
    if (isCourseSession) redirect(`${back}?notice=invalid`);
    const s = await requireStaffSession();
    const parsed = requirementsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=invalid`);
    const saved = await upsertTripRequirements(await getDb(), {
      shopId: s.user.shopId,
      tripId,
      requiresWaiver: parsed.data.requiresWaiver === "on",
      minimumCertificationLevel: parsed.data.minimumCertificationLevel,
    });
    redirect(`${back}?notice=${saved ? "requirements" : "invalid"}`);
  }

  async function assignGearAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const parsed = gearAssignmentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=gear-error`);
    const outcome = await assignGear(await getDb(), {
      shopId: s.user.shopId,
      bookingId: parsed.data.bookingId,
      gearItemId: parsed.data.gearItemId,
    });
    redirect(`${back}?notice=${outcome.ok ? "gear-assigned" : "gear-error"}`);
  }

  async function returnGearAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const assignmentId = String(formData.get("assignmentId") ?? "");
    if (!assignmentId) redirect(`${back}?notice=gear-error`);
    const returned = await returnGear(await getDb(), s.user.shopId, assignmentId);
    redirect(`${back}?notice=${returned ? "gear-returned" : "gear-error"}`);
  }

  const inputClass =
    "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice", "bid", "waiver"]} />
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
        {formatTimeRangeTz(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
      </p>
      {trip.course ? (
        <p className="mt-2 text-sm font-medium text-primary">
          Course session · {trip.course.title}
        </p>
      ) : null}

      {banner ? (
        <div
          role="status"
          className={
            banner.tone === "success"
              ? "mt-6 flex items-center justify-between gap-3 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
              : "mt-6 flex items-center justify-between gap-3 rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
          }
        >
          <span>{banner.text}</span>
          {undoBookingId ? (
            <form action={undoRemoveBookingAction}>
              <input type="hidden" name="bookingId" value={undoBookingId} />
              <button
                type="submit"
                className="min-h-11 rounded-lg px-3 font-semibold underline-offset-2 hover:underline"
              >
                Undo
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {notice === "waiver-link" && waiver ? (
        <section className="rise-in mt-6 rounded-lg border border-accent/40 bg-accent/10 p-5">
          <h2 className="font-semibold">Private waiver link ready</h2>
          <p className="mt-1 text-sm text-muted">
            Share this link with the diver. It expires in seven days and is replaced if you issue a
            new one.
          </p>
          <Link
            href={`/waivers/${waiver}`}
            className="mt-3 inline-block min-h-11 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
          >
            Open waiver link
          </Link>
        </section>
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
              className="min-h-11 rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            >
              Save changes
            </button>
          </div>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Readiness requirements</h2>
        <p className="mt-1 text-sm text-muted">
          {trip.course
            ? "This session snapshots the course catalog’s admission rules so a later catalog edit cannot change enrolled students’ requirements."
            : "These are explicit trip rules. A diver is blocked until the shared readiness service can prove each one."}
        </p>
        {trip.course ? (
          <div className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm">
            <p>
              <strong>Waiver:</strong> {requirement?.requiresWaiver ? "required" : "not required"}
            </p>
            <p className="mt-2">
              <strong>Existing certification:</strong>{" "}
              {requirement?.minimumCertificationLevel
                ? `${CERTIFICATION_LEVEL_LABELS[requirement.minimumCertificationLevel]} or higher`
                : "not required for enrollment"}
            </p>
          </div>
        ) : (
          <form
            action={saveRequirementsAction}
            className="mt-4 rounded-lg border border-border bg-surface p-5"
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-end">
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                <input
                  name="requiresWaiver"
                  type="checkbox"
                  defaultChecked={requirement?.requiresWaiver ?? true}
                  className="size-4 accent-primary"
                />
                Require a signed waiver
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Minimum certification
                <select
                  name="minimumCertificationLevel"
                  defaultValue={requirement?.minimumCertificationLevel ?? "open_water"}
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
                >
                  <option value="">No existing C-card required</option>
                  {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="submit"
              className="mt-5 min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
            >
              Save requirements
            </button>
          </form>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Crew</h2>
        <p className="mt-1 text-sm text-muted">Who's running this trip.</p>
        {trip.course?.requiresInstructor && !hasCourseInstructor ? (
          <p className="mt-3 rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
            This course cannot take bookings until one assigned crew member has the instructor role.
          </p>
        ) : null}
        {staff.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No staff on file yet.</p>
        ) : (
          <form action={saveCrewAction} className="mt-4 flex flex-col gap-3">
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {staff.map(({ person, roles }) => (
                <li key={person.id}>
                  <label className="flex min-h-11 items-center gap-3 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="crew"
                      value={person.id}
                      defaultChecked={crewIds.includes(person.id)}
                      className="size-4 accent-primary"
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
                className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
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
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {roster.map(({ booking, person }) => (
              <li
                key={booking.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{person.fullName}</p>
                  <p className="text-muted">{person.email ?? "no email on file"}</p>
                </div>
                <form action={removeBookingAction} className="shrink-0">
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-lg px-4 font-medium text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:text-danger"
                  >
                    Cancel booking
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Waivers</h2>
            <p className="mt-1 text-sm text-muted">
              Share a private completion link before the day of the trip. Medical follow-up stays
              visible here.
            </p>
          </div>
          <Link
            href="/shop/waivers"
            className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
          >
            Manage templates
          </Link>
        </div>
        {waiverRows.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
            Waiver links appear here when divers book this trip.
          </p>
        ) : templates.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
            Create a waiver template before issuing links.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {waiverRows.map(({ booking, person, waiver: currentWaiver }) => {
              const activity = waiverActivityTimeline(waiverRecordsByBooking.get(booking.id) ?? []);
              const state = waiverState(currentWaiver);
              const finished = state === "complete" || state === "medical_review";
              const label =
                state === "not_sent"
                  ? "Not sent"
                  : state === "awaiting_signature"
                    ? "Waiting on diver"
                    : state === "expired"
                      ? "Link expired"
                      : state === "medical_review"
                        ? "Medical review"
                        : "Complete";
              const tone =
                state === "medical_review"
                  ? "bg-warning/10 text-warning"
                  : state === "complete"
                    ? "bg-success/10 text-success"
                    : state === "expired"
                      ? "bg-danger/10 text-danger"
                      : "bg-primary/10 text-primary";
              return (
                <li key={booking.id} className="px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{person.fullName}</p>
                      <p className="mt-1 text-sm text-muted">
                        {currentWaiver
                          ? `${currentWaiver.templateTitle} v${currentWaiver.templateVersion}${currentWaiver.completedAt ? ` · signed ${formatDateTimeTz(currentWaiver.completedAt, "en-US", shop.timezone)}` : ""}`
                          : "No waiver issued"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-sm font-medium ${tone}`}>
                        {label}
                      </span>
                      {finished ? null : (
                        <form
                          action={issueWaiverAction}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="bookingId" value={booking.id} />
                          <select
                            name="templateId"
                            aria-label={`Waiver template for ${person.fullName}`}
                            defaultValue={
                              currentWaiver?.templateId ??
                              templates.find((template) => template.isDefault)?.id
                            }
                            className="min-h-11 max-w-44 rounded-lg border border-border-strong bg-surface px-2 text-sm"
                          >
                            {templates.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.title} v{template.version}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
                          >
                            {state === "not_sent" ? "Create link" : "New link"}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                  {activity.length > 0 ? (
                    <details className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm">
                      <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">
                        Activity · {activity.length} {activity.length === 1 ? "event" : "events"}
                      </summary>
                      <ol className="flex flex-col gap-3 pb-2 pt-1">
                        {activity.map((entry) => (
                          <li key={`${entry.recordId}-${entry.kind}`}>
                            <p className="font-medium">{entry.title}</p>
                            <p className="text-muted">
                              {formatDateTimeTz(entry.at, "en-US", shop.timezone)} · {entry.detail}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Gear prep</h2>
            <p className="mt-1 text-sm text-muted">
              Pack each diver from the live inventory. If another staff member claims an item first,
              it stays blocked here instead of being double-assigned.
            </p>
          </div>
          <Link
            href="/shop/gear"
            className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
          >
            Open gear room
          </Link>
        </div>
        {roster.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
            Booked divers will appear here when there is gear to prepare.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {roster.map(({ booking, person }) => {
              const assignedGear = gearByBooking.get(booking.id) ?? [];
              return (
                <li key={booking.id} className="px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">{person.fullName}</p>
                      <p className="mt-1 text-sm text-muted">
                        {rentalRequestSummary(gearRequestByBooking.get(booking.id))}
                      </p>
                      {assignedGear.length === 0 ? (
                        <p className="mt-1 text-sm text-muted">Nothing packed yet.</p>
                      ) : (
                        <ul className="mt-1 flex flex-wrap gap-2">
                          {assignedGear.map((item) => (
                            <li
                              key={item.assignmentId}
                              className="flex items-center gap-1 rounded-full bg-primary/10 pl-3 text-sm font-medium text-primary"
                            >
                              {item.label} <span className="font-normal">({item.type})</span>
                              <form action={returnGearAction}>
                                <input
                                  type="hidden"
                                  name="assignmentId"
                                  value={item.assignmentId}
                                />
                                <button
                                  type="submit"
                                  aria-label={`Return ${item.label}`}
                                  className="min-h-11 px-3 font-semibold hover:underline"
                                >
                                  Return
                                </button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {availableGear.length > 0 ? (
                      <form action={assignGearAction} className="flex min-w-0 flex-wrap gap-2">
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <select
                          name="gearItemId"
                          aria-label={`Assign gear to ${person.fullName}`}
                          defaultValue=""
                          className="min-h-11 min-w-44 rounded-lg border border-border-strong bg-surface px-3 text-base"
                        >
                          <option value="" disabled>
                            Choose available gear
                          </option>
                          {availableGear.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} · {item.type.replace("_", " ")}
                              {item.size ? ` · ${item.size}` : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-sunken"
                        >
                          Pack item
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm text-muted">No available gear right now.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Readiness</h2>
            <p className="mt-1 text-sm text-muted">
              One result for the front desk today, and the manifest later. Unknown evidence never
              clears a diver.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link
              href={`/shop/trips/${tripId}/manifest`}
              className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
            >
              Open boat manifest
            </Link>
            <Link
              href={`/shop/trips/${tripId}/nitrox`}
              className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
            >
              Nitrox fills
            </Link>
            <Link
              href="/shop/certifications"
              className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
            >
              Manage certifications
            </Link>
          </div>
        </div>
        {readinessRows.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
            Booked divers will appear here with their readiness status.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {readinessRows.map(({ booking, person, readiness }) => (
              <li
                key={booking.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <p className="font-medium">{person.fullName}</p>
                {readiness.status === "ready" ? (
                  <span className="rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success">
                    Ready
                  </span>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm text-danger">
                    {readiness.blockers.map((blocker) => (
                      <li key={blocker.code}>• {blocker.message}</li>
                    ))}
                  </ul>
                )}
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
              className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            >
              Reinstate trip
            </button>
          </form>
        ) : (
          <form action={cancelTripAction} className="flex items-center gap-3">
            <button
              type="submit"
              className="min-h-11 rounded-lg border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition-colors duration-200 hover:bg-danger/10"
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
