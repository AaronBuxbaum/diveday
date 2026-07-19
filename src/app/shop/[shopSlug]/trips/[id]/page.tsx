import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import {
  assignGear,
  assignRecommendedGear,
  listAvailableGear,
  listTripGearAssignments,
  returnGear,
} from "@/db/gear";
import { listTripRentalGearRequests } from "@/db/gear-requests";
import { sendAndRecordNotification } from "@/db/notifications";
import { setBookingPayment } from "@/db/payments";
import {
  cancelBooking,
  getBookingForTrip,
  getShopById,
  getTripCrewIds,
  getTripRoster,
  getTripWaitlist,
  getTripWithBooked,
  listStaff,
  listTripDives,
  restoreBooking,
  setTripCrew,
  setTripStatus,
  updateTrip,
  updateTripConditions,
} from "@/db/queries";
import {
  getTripRequirements,
  getTripSiteRequirement,
  listTripReadiness,
  upsertTripRequirements,
} from "@/db/readiness";
import type { RentalGearProfile, RentalGearRequest } from "@/db/schema";
import {
  issueWaiverRequest,
  listTripWaiverActivity,
  listTripWaiverStatuses,
  listWaiverTemplates,
} from "@/db/waivers";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { hasCrewPrediction } from "@/lib/marine-forecast";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { CERTIFICATION_LEVEL_LABELS, SPECIALTY_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
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
  plannedDives: z.coerce.number().int().min(1).max(4),
  priceDollars: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().nonnegative().finite().optional(),
  ),
});

const conditionsSchema = z.object({
  conditionsSummary: z.string().trim().max(600),
  waterTemperatureC: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(-2).max(40).optional(),
  ),
  visibilityMeters: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(100).optional(),
  ),
  surfaceConditions: z.string().trim().max(300),
});

const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);
const paymentStatusSchema = z.enum(["unpaid", "deposit_paid", "paid", "waived", "refunded"]);
const PAYMENT_LABELS: Record<z.infer<typeof paymentStatusSchema>, string> = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit paid",
  paid: "Paid",
  waived: "Waived",
  refunded: "Refunded",
};
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
  payment: { tone: "success", text: "Payment status updated." },
  conditions: { tone: "success", text: "Diver-facing conditions briefing updated." },
  "conditions-cleared": {
    tone: "success",
    text: "Crew prediction cleared. Divers will see the automated outlook when it is available.",
  },
  "gear-assigned": { tone: "success", text: "Gear added to the packing list." },
  "gear-returned": { tone: "success", text: "Gear returned to the gear room." },
  "gear-packed": { tone: "success", text: "Available gear was packed from diver requests." },
  "gear-none": {
    tone: "danger",
    text: "Nothing was packed automatically. Check each diver’s request and live inventory.",
  },
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

function rentalRequestSummary(
  request: RentalGearRequest | null | undefined,
  profile: RentalGearProfile | null | undefined,
) {
  if (!request && !profile) return "No rental request yet.";
  const requested = [
    request?.bcd && "BCD",
    request?.regulator && "regulator",
    request?.wetsuit && "wetsuit",
    request?.maskFins && "mask & fins",
    request?.weights && "weights",
    request?.tank && "tank",
    request?.diveComputer && "computer",
  ].filter(Boolean);
  const fit = [
    (request?.bcdSize ?? profile?.bcdSize) && `BCD ${request?.bcdSize ?? profile?.bcdSize}`,
    (request?.wetsuitSize ?? profile?.wetsuitSize) &&
      `wetsuit ${request?.wetsuitSize ?? profile?.wetsuitSize}`,
    (request?.bootSize ?? profile?.bootSize) && `boot ${request?.bootSize ?? profile?.bootSize}`,
    (request?.finSize ?? profile?.finSize) && `fin ${request?.finSize ?? profile?.finSize}`,
    request?.weightPreference ?? profile?.weightPreference,
  ].filter(Boolean);
  return [requested.length > 0 ? requested.join(", ") : "No rental set requested", fit.join(" · ")]
    .filter(Boolean)
    .join(" — ");
}

const WAIVER_BADGES: Record<ReturnType<typeof waiverState>, { label: string; tone: string }> = {
  not_sent: { label: "Not sent", tone: "bg-primary/10 text-primary" },
  awaiting_signature: { label: "Waiting on diver", tone: "bg-primary/10 text-primary" },
  expired: { label: "Link expired", tone: "bg-danger/10 text-danger" },
  medical_review: { label: "Medical review", tone: "bg-warning/10 text-warning" },
  complete: { label: "Complete", tone: "bg-success/10 text-success" },
};

export default async function ManageTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; bid?: string; waiver?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice, bid, waiver } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  const tripTitle = trip.title;
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
    diveSiteList,
    tripDiveList,
    waitlist,
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
    listDiveSites(db, shop.id),
    listTripDives(db, shop.id, tripId),
    getTripWaitlist(db, tripId),
  ]);
  const siteRequirement = await getTripSiteRequirement(db, shop.id, tripId);
  const banner = notice ? BANNERS[notice] : undefined;
  const undoBookingId = notice === "booking-removed" ? bid : undefined;
  const startWall = utcToWallTime(trip.startsAt, shop.timezone);
  const endWall = utcToWallTime(trip.endsAt, shop.timezone);
  const cancelled = trip.status === "cancelled";
  const isCourseSession = Boolean(trip.courseId);
  const back = `/shop/${shopSlug}/trips/${tripId}`;
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
  const gearProfileByBooking = new Map(
    gearRequestRows.map((row) => [row.booking.id, row.profile] as const),
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
  // The roster is the spine of the diver section; waiver and readiness detail
  // hang off it by booking id so each diver renders as one consolidated card.
  const waiverByBooking = new Map(waiverRows.map((row) => [row.booking.id, row] as const));
  const readinessByBooking = new Map(readinessRows.map((row) => [row.booking.id, row] as const));

  async function saveDetails(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=invalid`);
    const { title, description, date, startTime, endTime, capacity, plannedDives, priceDollars } =
      parsed.data;
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
      plannedDives,
      priceCents: priceDollars === undefined ? null : Math.round(priceDollars * 100),
      diveSiteId: tripDiveDraftsFromForm(formData, plannedDives)[0]?.diveSiteId ?? null,
      dives: tripDiveDraftsFromForm(formData, plannedDives),
    });
    revalidateAndRedirect(back, `${back}?notice=saved`);
  }

  async function saveConditionsAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const parsed = conditionsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=invalid`);
    const saved = await updateTripConditions(await getDb(), s.user.shopId, tripId, parsed.data);
    revalidateAndRedirect(back, `${back}?notice=${saved ? "conditions" : "invalid"}`);
  }

  async function clearConditionsAction() {
    "use server";
    const s = await requireStaffSession();
    const saved = await updateTripConditions(await getDb(), s.user.shopId, tripId, {});
    revalidateAndRedirect(back, `${back}?notice=${saved ? "conditions-cleared" : "invalid"}`);
  }

  async function cancelTripAction() {
    "use server";
    const s = await requireStaffSession();
    await setTripStatus(await getDb(), s.user.shopId, tripId, "cancelled");
    revalidateAndRedirect(back, `${back}?notice=cancelled`);
  }

  async function reinstateTripAction() {
    "use server";
    const s = await requireStaffSession();
    await setTripStatus(await getDb(), s.user.shopId, tripId, "scheduled");
    revalidateAndRedirect(back, `${back}?notice=reinstated`);
  }

  async function saveCrewAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const ids = formData.getAll("crew").map(String);
    await setTripCrew(await getDb(), s.user.shopId, tripId, ids);
    revalidateAndRedirect(back, `${back}?notice=crew`);
  }

  async function removeBookingAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const bookingId = String(formData.get("bookingId") ?? "");
    if (!bookingId) redirect(back);
    await cancelBooking(await getDb(), s.user.shopId, bookingId);
    revalidateAndRedirect(back, `${back}?notice=booking-removed&bid=${bookingId}`);
  }

  async function undoRemoveBookingAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const bookingId = String(formData.get("bookingId") ?? "");
    if (bookingId) await restoreBooking(await getDb(), s.user.shopId, bookingId);
    revalidateAndRedirect(back, `${back}?notice=booking-restored`);
  }

  async function issueWaiverAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const bookingId = String(formData.get("bookingId") ?? "");
    if (!bookingId) redirect(`${back}?notice=waiver-error`);
    const db = await getDb();
    const outcome = await issueWaiverRequest(db, {
      shopId: s.user.shopId,
      bookingId,
    });
    if (!outcome.ok) {
      redirect(
        `${back}?notice=${outcome.reason === "already_completed" ? "waiver-complete" : "waiver-error"}`,
      );
    }
    const origin = publicAppUrl();
    if (origin) {
      const booking = await getBookingForTrip(db, tripId, bookingId);
      if (booking?.person.email) {
        try {
          const delivery = await sendAndRecordNotification(db, {
            kind: "waiver_request",
            waiverRecordId: outcome.recordId,
            bookingId,
            shopId: s.user.shopId,
            to: booking.person.email,
            diverName: booking.person.fullName,
            shopName: shop.name,
            tripTitle,
            completionUrl: new URL(`/waivers/${outcome.token}`, `${origin}/`).toString(),
            expiresAt: outcome.expiresAt,
            timezone: shop.timezone,
          });
          if (delivery.status === "failed") {
            console.error("Waiver request notification failed", {
              waiverRecordId: outcome.recordId,
            });
          }
        } catch {
          // Keep the staff-visible one-time link available if email delivery is unavailable.
          console.error("Waiver request notification could not be prepared", {
            waiverRecordId: outcome.recordId,
          });
        }
      }
    }
    revalidateAndRedirect(
      back,
      `${back}?notice=waiver-link&bid=${bookingId}&waiver=${outcome.token}`,
    );
  }

  async function markPaymentAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const bookingId = String(formData.get("bookingId") ?? "");
    const status = paymentStatusSchema.safeParse(formData.get("status"));
    const saved =
      bookingId && status.success
        ? await setBookingPayment(await getDb(), {
            shopId: s.user.shopId,
            bookingId,
            status: status.data,
          })
        : null;
    revalidateAndRedirect(back, `${back}?notice=${saved ? "payment" : "invalid"}`);
  }

  async function saveRequirementsAction(formData: FormData) {
    "use server";
    if (isCourseSession) redirect(`${back}?notice=invalid`);
    const s = await requireStaffSession();
    const parsed = requirementsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=invalid`);
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
    if (!specialties.success) redirect(`${back}?notice=invalid`);
    const saved = await upsertTripRequirements(await getDb(), {
      shopId: s.user.shopId,
      tripId,
      requiresWaiver: parsed.data.requiresWaiver === "on",
      minimumCertificationLevel: parsed.data.minimumCertificationLevel,
      requiredSpecialties: specialties.data,
      requiresNitrox: formData.get("requiresNitrox") === "on",
      requiresPayment: formData.get("requiresPayment") === "on",
    });
    revalidateAndRedirect(back, `${back}?notice=${saved ? "requirements" : "invalid"}`);
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
    revalidateAndRedirect(back, `${back}?notice=${outcome.ok ? "gear-assigned" : "gear-error"}`);
  }

  async function assignRecommendedGearAction() {
    "use server";
    const s = await requireStaffSession();
    const outcome = await assignRecommendedGear(await getDb(), s.user.shopId, tripId);
    revalidateAndRedirect(
      back,
      `${back}?notice=${outcome.assigned > 0 ? "gear-packed" : "gear-none"}`,
    );
  }

  async function returnGearAction(formData: FormData) {
    "use server";
    const s = await requireStaffSession();
    const assignmentId = String(formData.get("assignmentId") ?? "");
    if (!assignmentId) redirect(`${back}?notice=gear-error`);
    const returned = await returnGear(await getDb(), s.user.shopId, assignmentId);
    revalidateAndRedirect(back, `${back}?notice=${returned ? "gear-returned" : "gear-error"}`);
  }

  const inputClass =
    "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice", "bid", "waiver"]} />
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
          <TripDiveFields
            diveSites={diveSiteList.map((site) => ({ id: site.id, name: site.name }))}
            initialCount={trip.plannedDives}
            initialDives={tripDiveList.map(({ dive }) => ({
              title: dive.title,
              diveSiteId: dive.diveSiteId,
              description: dive.description,
            }))}
          />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-5">
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
            <label className="flex flex-col gap-1 text-sm font-medium">
              Price per diver <span className="font-normal text-muted">(optional)</span>
              <input
                name="priceDollars"
                type="number"
                step="0.01"
                min={0}
                placeholder="$0.00"
                defaultValue={trip.priceCents === null ? "" : (trip.priceCents / 100).toFixed(2)}
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

      <section className="mt-10 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Crew prediction</h2>
        <p className="mt-1 text-sm text-muted">
          Publish the crew’s read on the day. It replaces the automated marine outlook for divers.
        </p>
        <form action={saveConditionsAction} className="mt-5 flex flex-col gap-5">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Conditions overview
            <textarea
              name="conditionsSummary"
              rows={2}
              maxLength={600}
              defaultValue={trip.conditionsSummary ?? ""}
              placeholder="A calm morning is expected; the crew will confirm the final call at the dock."
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Water temp °C
              <input
                name="waterTemperatureC"
                type="number"
                min={-2}
                max={40}
                defaultValue={trip.waterTemperatureC ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Visibility metres
              <input
                name="visibilityMeters"
                type="number"
                min={0}
                max={100}
                defaultValue={trip.visibilityMeters ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Surface notes
              <input
                name="surfaceConditions"
                maxLength={300}
                defaultValue={trip.surfaceConditions ?? ""}
                placeholder="Light breeze · gentle chop"
                className={inputClass}
              />
            </label>
          </div>
          <button
            type="submit"
            className="min-h-11 self-start rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
          >
            Publish crew prediction
          </button>
        </form>
        {hasCrewPrediction(trip) ? (
          <form action={clearConditionsAction} className="mt-3">
            <button
              type="submit"
              className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
            >
              Return to automated outlook
            </button>
          </form>
        ) : null}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">
          Wait list <span className="font-normal text-muted tabular-nums">{waitlist.length}</span>
        </h2>
        <p className="mt-1 text-sm text-muted">
          These divers have not booked a seat and do not appear on the manifest.
        </p>
        {waitlist.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
            No one is waiting for a spot yet.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {waitlist.map(({ entry, person }, index) => (
              <li key={entry.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-medium text-primary tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{person.fullName}</p>
                  <p className="text-muted">{person.email ?? "no email on file"}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
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
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                <input
                  name="requiresPayment"
                  type="checkbox"
                  defaultChecked={requirement?.requiresPayment ?? false}
                  className="size-4 accent-primary"
                />
                Require payment to board
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
            <fieldset className="mt-5">
              <legend className="text-sm font-medium">Required specialties</legend>
              <p className="mt-1 text-sm text-muted">
                A diver is blocked until a verified card for each proves the specialty.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(SPECIALTY_LABELS).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex min-h-11 items-center gap-2 text-sm font-medium"
                  >
                    <input
                      name="specialty"
                      type="checkbox"
                      value={value}
                      defaultChecked={requirement?.requiredSpecialties?.includes(
                        value as keyof typeof SPECIALTY_LABELS,
                      )}
                      className="size-4 accent-primary"
                    />
                    {label}
                  </label>
                ))}
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input
                    name="requiresNitrox"
                    type="checkbox"
                    defaultChecked={requirement?.requiresNitrox ?? false}
                    className="size-4 accent-primary"
                  />
                  Nitrox
                </label>
              </div>
            </fieldset>
            {siteRequirement &&
            (siteRequirement.minimumCertificationLevel ||
              siteRequirement.requiredSpecialties.length > 0 ||
              siteRequirement.requiresNitrox) ? (
              <p className="mt-4 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-muted">
                <strong className="font-medium text-foreground">
                  {trip.diveSite?.name ?? "This site"}
                </strong>{" "}
                also requires{" "}
                {[
                  siteRequirement.minimumCertificationLevel
                    ? `${CERTIFICATION_LEVEL_LABELS[siteRequirement.minimumCertificationLevel]} or higher`
                    : null,
                  ...siteRequirement.requiredSpecialties.map(
                    (specialty) => `${SPECIALTY_LABELS[specialty]} specialty`,
                  ),
                  siteRequirement.requiresNitrox ? "a nitrox card" : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                . Readiness always enforces the stricter of the site and this trip.
              </p>
            ) : null}
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
              <SubmitButton
                pendingLabel="Saving crew…"
                className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
              >
                Save crew
              </SubmitButton>
            </div>
          </form>
        )}
      </section>

      <section id="roster" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Divers{" "}
              <span className="font-normal text-muted tabular-nums">
                {trip.booked} of {trip.capacity}
              </span>
            </h2>
            <p className="mt-1 text-sm text-muted">
              Readiness, waiver, gear, and payment for each diver — together in one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <form action={assignRecommendedGearAction}>
              <button
                type="submit"
                className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-sunken"
              >
                Pack recommendations
              </button>
            </form>
            <Link
              href={`/shop/${shopSlug}/gear`}
              className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
            >
              Gear room
            </Link>
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}/manifest`}
              className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
            >
              Boat manifest
            </Link>
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}/nitrox`}
              className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
            >
              Nitrox fills
            </Link>
          </div>
        </div>
        {roster.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
            No bookings yet — share the trip page and they'll show up here.
          </p>
        ) : (
          <ul className="mt-5 grid gap-4">
            {roster.map(({ booking, person }) => {
              const readiness = readinessByBooking.get(booking.id)?.readiness;
              const paymentStatus = readinessByBooking.get(booking.id)?.paymentStatus;
              const currentWaiver = waiverByBooking.get(booking.id)?.waiver ?? null;
              const waiverStatus = waiverState(currentWaiver);
              const badge = WAIVER_BADGES[waiverStatus];
              const waiverFinished =
                waiverStatus === "complete" || waiverStatus === "medical_review";
              const activity = waiverActivityTimeline(waiverRecordsByBooking.get(booking.id) ?? []);
              const assignedGear = gearByBooking.get(booking.id) ?? [];
              return (
                <li
                  key={booking.id}
                  className="rounded-xl border border-border bg-surface p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/shop/${shopSlug}/divers/${person.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {person.fullName}
                      </Link>
                      <p className="text-sm text-muted">{person.email ?? "no email on file"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {readiness ? (
                        readiness.status === "ready" ? (
                          <span className="rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success">
                            Ready
                          </span>
                        ) : (
                          <span className="rounded-full bg-danger/10 px-3 py-1 text-sm font-medium text-danger">
                            Needs attention
                          </span>
                        )
                      ) : null}
                      <form action={removeBookingAction}>
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <button
                          type="submit"
                          className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:text-danger"
                        >
                          Cancel
                        </button>
                      </form>
                    </div>
                  </div>

                  {readiness && readiness.status !== "ready" ? (
                    <ul className="mt-3 grid gap-2 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
                      {readiness.blockers.map((blocker) => (
                        <li key={blocker.message} className="flex gap-2">
                          <span aria-hidden="true">!</span>
                          <span>{blocker.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-4 grid gap-5 border-t border-border pt-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                        Waiver
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-medium ${badge.tone}`}
                        >
                          {badge.label}
                        </span>
                        {waiverFinished ? null : templates.length === 0 ? (
                          <span className="text-sm text-muted">Add a template to send</span>
                        ) : (
                          <form action={issueWaiverAction} className="flex items-center gap-2">
                            <input type="hidden" name="bookingId" value={booking.id} />
                            <SubmitButton
                              pendingLabel="Sending…"
                              confirmMessage={
                                waiverStatus === "not_sent"
                                  ? undefined
                                  : `Send ${person.fullName} a new waiver link? Their previous link will stop working.`
                              }
                              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
                            >
                              {waiverStatus === "not_sent" ? "Send link" : "Resend"}
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-muted">
                        {currentWaiver
                          ? `${currentWaiver.templateTitle} v${currentWaiver.templateVersion}${currentWaiver.completedAt ? ` · signed ${formatDateTimeTz(currentWaiver.completedAt, "en-US", shop.timezone)}` : ""}`
                          : "No waiver issued"}
                      </p>
                      {activity.length > 0 ? (
                        <details className="mt-2 rounded-lg bg-surface-sunken px-3 py-1 text-sm">
                          <summary className="flex min-h-11 cursor-pointer items-center py-2 font-medium text-primary">
                            Activity · {activity.length}{" "}
                            {activity.length === 1 ? "event" : "events"}
                          </summary>
                          <ol className="flex flex-col gap-3 pb-2 pt-1">
                            {activity.map((entry) => (
                              <li key={`${entry.recordId}-${entry.kind}`}>
                                <p className="font-medium">{entry.title}</p>
                                <p className="text-muted">
                                  {formatDateTimeTz(entry.at, "en-US", shop.timezone)} ·{" "}
                                  {entry.detail}
                                </p>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
                    </div>

                    <div>
                      <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                        Gear
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        {rentalRequestSummary(
                          gearRequestByBooking.get(booking.id),
                          gearProfileByBooking.get(booking.id),
                        )}
                      </p>
                      {assignedGear.length === 0 ? (
                        <p className="mt-2 text-sm text-muted">Nothing packed yet.</p>
                      ) : (
                        <ul className="mt-2 flex flex-wrap gap-2">
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
                      {availableGear.length > 0 ? (
                        <form action={assignGearAction} className="mt-2 flex flex-wrap gap-2">
                          <input type="hidden" name="bookingId" value={booking.id} />
                          <select
                            name="gearItemId"
                            aria-label={`Assign gear to ${person.fullName}`}
                            defaultValue=""
                            className="min-h-11 min-w-44 flex-1 rounded-lg border border-border-strong bg-surface px-3 text-base"
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
                            Pack
                          </button>
                        </form>
                      ) : (
                        <p className="mt-2 text-sm text-muted">No available gear right now.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
                    {requirement?.requiresPayment ? (
                      <form
                        action={markPaymentAction}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <span className="text-sm text-muted">
                          Payment: {PAYMENT_LABELS[paymentStatus ?? "unpaid"]}
                        </span>
                        <select
                          name="status"
                          defaultValue={paymentStatus ?? "unpaid"}
                          className="min-h-11 rounded-lg border border-border-strong bg-surface px-2 text-sm"
                        >
                          {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-sunken"
                        >
                          Update
                        </button>
                      </form>
                    ) : null}
                    <Link
                      href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
                      className="min-h-11 py-2 text-sm font-medium text-primary hover:underline"
                    >
                      Create order
                    </Link>
                  </div>
                </li>
              );
            })}
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
