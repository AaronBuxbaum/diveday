import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
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
  getTripSeriesSummary,
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
import { issueWaiverRequest, listTripWaiverStatuses, listWaiverTemplates } from "@/db/waivers";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { hasCrewPrediction } from "@/lib/marine-forecast";
import { flaggedMedicalPrompts } from "@/lib/medical";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { CERTIFICATION_LEVEL_LABELS, SPECIALTY_LABELS } from "@/lib/readiness";
import { recurrenceSummary } from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { capacityLabel, isFull } from "@/lib/trips";
import { waiverState } from "@/lib/waivers";
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

// The whole waiver collapses to a single control per diver. Its face is the
// status; its click is the only sensible next action. `action: null` means the
// waiver is signed and there is nothing left to do — it renders as a static pill.
type WaiverControl = {
  label: string;
  hint?: string;
  tone: string;
  action: "send" | "resend" | null;
  confirm: boolean;
};

const WAIVER_CONTROLS: Record<ReturnType<typeof waiverState>, WaiverControl> = {
  not_sent: {
    label: "Send waiver",
    tone: "border border-border bg-surface hover:bg-surface-sunken",
    action: "send",
    confirm: false,
  },
  awaiting_signature: {
    label: "Waiver sent",
    hint: "Resend",
    tone: "border border-border bg-surface hover:bg-surface-sunken",
    action: "resend",
    confirm: true,
  },
  expired: {
    label: "Link expired",
    hint: "Resend",
    tone: "border border-danger/40 text-danger hover:bg-danger/10",
    action: "resend",
    confirm: false,
  },
  complete: {
    label: "Waiver signed",
    tone: "bg-success/10 text-success",
    action: null,
    confirm: false,
  },
  medical_review: {
    label: "Medical review",
    tone: "bg-warning/10 text-warning",
    action: null,
    confirm: false,
  },
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
  const series = await getTripSeriesSummary(db, shop.id, tripId);
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
      {series ? (
        <p className="mt-2 text-sm text-muted">
          Part of a repeating series ·{" "}
          {recurrenceSummary({
            frequency: "weekly",
            intervalWeeks: series.intervalWeeks,
            occurrenceCount: series.occurrenceCount,
          })}
          . Changes here apply to this date only; {series.scheduledCount} still on the schedule.
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
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 font-semibold underline-offset-2 hover:underline"
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
          <Link href={`/waivers/${waiver}`} className={buttonClass({ className: "mt-3" })}>
            Open waiver link
          </Link>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Details</h2>
        <form action={saveDetails} className="mt-4 flex flex-col gap-5">
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
            <button type="submit" className={buttonClass({ size: "lg", className: "text-base" })}>
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
          <FieldGrid columns={1}>
            <Field label="Conditions overview">
              <textarea
                name="conditionsSummary"
                rows={2}
                maxLength={600}
                defaultValue={trip.conditionsSummary ?? ""}
                placeholder="A calm morning is expected; the crew will confirm the final call at the dock."
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <FieldGrid columns={3} className="gap-x-5 gap-y-5">
            <Field label="Water temp °C">
              <input
                name="waterTemperatureC"
                type="number"
                min={-2}
                max={40}
                defaultValue={trip.waterTemperatureC ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label="Visibility metres">
              <input
                name="visibilityMeters"
                type="number"
                min={0}
                max={100}
                defaultValue={trip.visibilityMeters ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label="Surface notes">
              <input
                name="surfaceConditions"
                maxLength={300}
                defaultValue={trip.surfaceConditions ?? ""}
                placeholder="Light breeze · gentle chop"
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <button
            type="submit"
            className={buttonClass({
              variant: "secondary",
              className: "self-start text-foreground",
            })}
          >
            Publish crew prediction
          </button>
        </form>
        {hasCrewPrediction(trip) ? (
          <form action={clearConditionsAction} className="mt-3">
            <button
              type="submit"
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
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
              <FieldGrid columns={1}>
                <Field label="Minimum certification">
                  <select
                    name="minimumCertificationLevel"
                    defaultValue={requirement?.minimumCertificationLevel ?? "open_water"}
                    className={controlClass}
                  >
                    <option value="">No existing C-card required</option>
                    {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </FieldGrid>
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
              className={buttonClass({
                variant: "secondary",
                className: "mt-5 text-foreground",
              })}
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
                className={buttonClass({ variant: "secondary", className: "text-foreground" })}
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
                className={buttonClass({
                  variant: "secondary",
                  className: "text-foreground",
                })}
              >
                Pack recommendations
              </button>
            </form>
            <Link
              href={`/shop/${shopSlug}/gear`}
              className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
            >
              Gear room
            </Link>
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}/manifest`}
              className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
            >
              Boat manifest
            </Link>
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}/nitrox`}
              className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
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
              const waiverControl = WAIVER_CONTROLS[waiverStatus];
              const flaggedPrompts =
                waiverStatus === "medical_review" && currentWaiver?.medicalAnswers
                  ? flaggedMedicalPrompts(currentWaiver.medicalAnswers)
                  : [];
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
                    {readiness ? (
                      readiness.status === "ready" ? (
                        <span className="shrink-0 rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success">
                          Ready
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-danger/10 px-3 py-1 text-sm font-medium text-danger">
                          Needs attention
                        </span>
                      )
                    ) : null}
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
                      <div className="mt-2">
                        {waiverControl.action && templates.length === 0 ? (
                          <span className="text-sm text-muted">Add a template to send</span>
                        ) : waiverControl.action ? (
                          <form action={issueWaiverAction}>
                            <input type="hidden" name="bookingId" value={booking.id} />
                            <SubmitButton
                              pendingLabel={
                                waiverControl.action === "send" ? "Sending…" : "Resending…"
                              }
                              confirmMessage={
                                waiverControl.confirm
                                  ? `Send ${person.fullName} a new waiver link? Their previous link will stop working.`
                                  : undefined
                              }
                              className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors duration-200 ${waiverControl.tone}`}
                            >
                              {waiverControl.label}
                              {waiverControl.hint ? (
                                <>
                                  <span aria-hidden="true" className="opacity-40">
                                    ·
                                  </span>
                                  <span className="font-normal opacity-70">
                                    {waiverControl.hint}
                                  </span>
                                </>
                              ) : null}
                            </SubmitButton>
                          </form>
                        ) : (
                          <span
                            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${waiverControl.tone}`}
                          >
                            {waiverControl.label}
                          </span>
                        )}
                      </div>
                      {currentWaiver?.completedAt && waiverStatus === "complete" ? (
                        <p className="mt-2 text-sm text-muted">
                          Signed{" "}
                          {formatDateTimeTz(currentWaiver.completedAt, "en-US", shop.timezone)}
                        </p>
                      ) : null}
                      {waiverStatus === "medical_review" ? (
                        <div className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                          <p className="font-medium">Follow up before boarding</p>
                          {flaggedPrompts.length > 0 ? (
                            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                              {flaggedPrompts.map((prompt) => (
                                <li key={prompt}>{prompt}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1">
                              A diver answered yes to a medical question. Confirm physician
                              clearance before boarding.
                            </p>
                          )}
                        </div>
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
                                  className="inline-flex min-h-11 items-center px-3 font-semibold hover:underline"
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
                            className={`${controlClass} min-w-44 flex-1`}
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
                            className={buttonClass({
                              variant: "secondary",
                              className: "text-foreground",
                            })}
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
                          className="min-h-11 items-center rounded-lg border border-border-strong bg-surface px-2 text-sm"
                        >
                          {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className={buttonClass({
                            variant: "secondary",
                            size: "sm",
                            className: "text-foreground",
                          })}
                        >
                          Update
                        </button>
                      </form>
                    ) : null}
                    <Link
                      href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
                      className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
                    >
                      Create order
                    </Link>
                    <form action={removeBookingAction} className="sm:ml-auto">
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <SubmitButton
                        pendingLabel="Removing…"
                        confirmMessage={`Remove ${person.fullName} from this trip? Their spot opens back up.`}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:text-danger"
                      >
                        Remove booking
                      </SubmitButton>
                    </form>
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
            <button type="submit" className={buttonClass()}>
              Reinstate trip
            </button>
          </form>
        ) : (
          <form action={cancelTripAction} className="flex items-center gap-3">
            <button type="submit" className={buttonClass({ variant: "danger" })}>
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
