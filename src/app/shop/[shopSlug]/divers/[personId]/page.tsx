import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { createBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { deleteDiver, getDiverProfile, updateDiver } from "@/db/divers";
import { saveRentalGearProfile } from "@/db/gear-requests";
import { createNitroxCertification, reviewNitroxCertification } from "@/db/nitrox";
import { refundOrder } from "@/db/orders";
import { getShopById, upcomingTripsWithCounts } from "@/db/queries";
import {
  createCertification,
  createSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
  verifyCertificationWithAgency,
} from "@/db/readiness";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { CERTIFICATION_LEVEL_LABELS, SPECIALTY_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { storeCardImage } from "@/lib/storage";

export const metadata: Metadata = { title: "Diver — Scuba" };

const agencySchema = z.enum(["padi", "ssi", "naui", "sdi", "tdi", "other"]);
const levelSchema = z.enum([
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
]);
const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit", "nitrox"]);
const dateSchema = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);

const personSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.email().max(320)]),
  phone: z.string().trim().max(40),
});
const certificationSchema = z.object({
  agency: agencySchema,
  level: levelSchema,
  identifier: z.string().trim().min(2).max(120),
  expiresOn: dateSchema,
});
const specialtyCertificationSchema = z.object({
  agency: agencySchema,
  specialty: specialtySchema,
  identifier: z.string().trim().min(2).max(120),
  expiresOn: dateSchema,
});
const profileSchema = z.object({
  bcdSize: z.string().trim().max(40),
  wetsuitSize: z.string().trim().max(40),
  bootSize: z.string().trim().max(40),
  finSize: z.string().trim().max(40),
  weightPreference: z.string().trim().max(120),
});

const AGENCY_LABELS: Record<z.infer<typeof agencySchema>, string> = {
  padi: "PADI",
  ssi: "SSI",
  naui: "NAUI",
  sdi: "SDI",
  tdi: "TDI",
  other: "Other agency",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit paid",
  paid: "Paid",
  waived: "Waived",
  refunded: "Refunded",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  open: "Invoice open",
  paid: "Paid",
  void: "Void",
  uncollectible: "Uncollectible",
  refunded: "Refunded",
};

async function resolveCardImage(formData: FormData) {
  const file = formData.get("cardImage");
  if (!(file instanceof File) || file.size === 0) return { url: undefined };
  const stored = await storeCardImage({
    keyPrefix: "cards",
    filename: file.name,
    contentType: file.type,
    bytes: await file.arrayBuffer(),
  });
  return stored.status === "stored" ? { url: stored.url } : { failed: true };
}

function dateFromInput(value: string) {
  return value ? new Date(`${value}T23:59:59.999Z`) : undefined;
}

function statusTone(status: "pending" | "verified" | "rejected") {
  return status === "verified"
    ? "bg-success/10 text-success"
    : status === "rejected"
      ? "bg-danger/10 text-danger"
      : "bg-warning/10 text-warning";
}

export default async function DiverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; personId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, personId } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const diver = shop ? await getDiverProfile(db, shop.id, personId) : null;
  if (!shop || !diver) notFound();
  const upcoming = (await upcomingTripsWithCounts(db, shop.id)).filter(
    (trip) =>
      !diver.bookings.some(
        ({ booking }) => booking.tripId === trip.id && booking.status !== "cancelled",
      ) && trip.booked < trip.capacity,
  );

  const base = `/shop/${shopSlug}/divers/${personId}`;

  async function savePersonAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = personSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${base}?notice=invalid`);
    const saved = await updateDiver(await getDb(), {
      shopId: staff.user.shopId,
      personId,
      ...parsed.data,
    });
    revalidateAndRedirect(base, `${base}?notice=${saved ? "person-saved" : "duplicate"}`);
  }

  async function addCertificationAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${base}?notice=invalid`);
    const image = await resolveCardImage(formData);
    if (image.failed) redirect(`${base}?notice=image`);
    const saved = await createCertification(await getDb(), {
      shopId: staff.user.shopId,
      personId,
      agency: parsed.data.agency,
      level: parsed.data.level,
      identifier: parsed.data.identifier,
      expiresAt: dateFromInput(parsed.data.expiresOn),
      cardImageUrl: image.url,
    });
    revalidateAndRedirect(base, `${base}?notice=${saved ? "captured" : "invalid"}`);
  }

  async function addSpecialtyAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = specialtyCertificationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${base}?notice=invalid`);
    const image = await resolveCardImage(formData);
    if (image.failed) redirect(`${base}?notice=image`);
    const saved =
      parsed.data.specialty === "nitrox"
        ? await createNitroxCertification(await getDb(), {
            shopId: staff.user.shopId,
            personId,
            agency: parsed.data.agency,
            identifier: parsed.data.identifier,
          })
        : await createSpecialtyCertification(await getDb(), {
            shopId: staff.user.shopId,
            personId,
            agency: parsed.data.agency,
            specialty: parsed.data.specialty,
            identifier: parsed.data.identifier,
            expiresAt: dateFromInput(parsed.data.expiresOn),
            cardImageUrl: image.url,
          });
    revalidateAndRedirect(base, `${base}?notice=${saved ? "captured" : "invalid"}`);
  }

  async function reviewAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const certificationId = String(formData.get("certificationId") ?? "");
    const status = formData.get("status") === "rejected" ? "rejected" : "verified";
    const updated = certificationId
      ? await reviewCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status,
        })
      : null;
    revalidateAndRedirect(base, `${base}?notice=${updated ? status : "invalid"}`);
  }

  async function agencyCheckAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const certificationId = String(formData.get("certificationId") ?? "");
    const outcome = certificationId
      ? await verifyCertificationWithAgency(await getDb(), staff.user.shopId, certificationId)
      : null;
    const result =
      outcome === "verified"
        ? "agency-verified"
        : outcome === "not_found"
          ? "agency-not-found"
          : outcome === "mismatch"
            ? "agency-mismatch"
            : outcome === "unavailable"
              ? "agency-unavailable"
              : "invalid";
    revalidateAndRedirect(base, `${base}?notice=${result}`);
  }

  async function reviewSpecialtyAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const certificationId = String(formData.get("certificationId") ?? "");
    const status = formData.get("status") === "rejected" ? "rejected" : "verified";
    const updated = certificationId
      ? formData.get("cardType") === "nitrox"
        ? await reviewNitroxCertification(await getDb(), {
            shopId: staff.user.shopId,
            certificationId,
            status,
          })
        : await reviewSpecialtyCertification(await getDb(), {
            shopId: staff.user.shopId,
            certificationId,
            status,
          })
      : null;
    revalidateAndRedirect(base, `${base}?notice=${updated ? status : "invalid"}`);
  }

  async function saveProfileAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = profileSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${base}?notice=invalid`);
    const saved = await saveRentalGearProfile(await getDb(), {
      shopId: staff.user.shopId,
      personId,
      ...parsed.data,
    });
    revalidateAndRedirect(base, `${base}?notice=${saved ? "profile-saved" : "invalid"}`);
  }

  async function refundPaymentAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const orderId = String(formData.get("orderId") ?? "");
    const refunded = orderId ? await refundOrder(await getDb(), staff.user.shopId, orderId) : null;
    revalidateAndRedirect(base, `${base}?notice=${refunded ? "refunded" : "refund-failed"}`);
  }

  async function bookActivityAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const tripId = String(formData.get("tripId") ?? "");
    const current = await getDiverProfile(await getDb(), staff.user.shopId, personId);
    if (!tripId || !current?.person.email) redirect(`${base}?notice=booking-invalid`);
    const result = await createBooking(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      fullName: current.person.fullName,
      email: current.person.email,
      phone: current.person.phone ?? undefined,
    });
    revalidateAndRedirect(base, `${base}?notice=${result.ok ? "booked" : result.reason}`);
  }

  async function deletePersonAction() {
    "use server";
    const staff = await requireStaffSession();
    const deleted = await deleteDiver(await getDb(), staff.user.shopId, personId);
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/divers`,
      deleted
        ? `/shop/${staff.user.shopSlug}/divers?notice=deleted&deleted=${encodeURIComponent(personId)}`
        : base,
    );
  }

  const noticeText =
    notice === "captured"
      ? "Card captured as pending. Verify it before it can make this diver ready."
      : notice === "verified"
        ? "Certification verified."
        : notice === "rejected"
          ? "Card marked for correction."
          : notice === "person-saved"
            ? "Diver details updated."
            : notice === "profile-saved"
              ? "Rental fit profile saved."
              : notice === "image"
                ? "That photo could not be used. Upload a JPG, PNG, or WebP under 5 MB."
                : notice === "agency-verified"
                  ? "Confirmed with the agency and verified."
                  : notice === "agency-not-found"
                    ? "The agency could not find this card. It remains pending for manual review."
                    : notice === "agency-mismatch"
                      ? "The agency returned a mismatch. It remains pending for manual review."
                      : notice === "agency-unavailable"
                        ? "Agency verification is not configured. Verify this card manually."
                        : notice === "duplicate"
                          ? "Another diver already uses that email in this shop."
                          : notice === "refunded"
                            ? "Payment refunded and the diver's trip payment gate was reopened."
                            : notice === "booked"
                              ? "Activity booked. Review it below, then create and send the invoice."
                              : notice === "trip_full"
                                ? "That activity just filled up. Choose another."
                                : notice === "already_booked"
                                  ? "This diver is already booked on that activity."
                                  : notice === "course_unstaffed"
                                    ? "Assign an instructor before booking this course."
                                    : notice === "course_prerequisite"
                                      ? "Verify the required certification before booking this course."
                                      : notice === "trip_unavailable" ||
                                          notice === "booking-invalid"
                                        ? "Add an email and choose an available activity."
                                        : notice === "refund-failed"
                                          ? "That payment could not be refunded. It may not be paid, or Stripe may need attention."
                                          : notice === "deleted"
                                            ? "Diver removed from active shop work. Their booking and card history is preserved."
                                            : notice === "invalid"
                                              ? "Check the details and try again."
                                              : null;
  const errorNotice = [
    "image",
    "agency-not-found",
    "agency-mismatch",
    "agency-unavailable",
    "duplicate",
    "refund-failed",
    "invalid",
    "trip_full",
    "already_booked",
    "course_unstaffed",
    "course_prerequisite",
    "trip_unavailable",
    "booking-invalid",
  ].includes(notice ?? "");
  const profile = diver.gearProfile;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <Link
        href={`/shop/${shopSlug}/divers`}
        className="text-sm font-medium text-primary hover:underline"
      >
        ← All divers
      </Link>
      <header className="mt-4 flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{diver.person.fullName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {diver.person.email ? (
              <a
                href={`mailto:${diver.person.email}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 font-medium text-primary hover:bg-primary/10 hover:underline"
              >
                <span aria-hidden="true">✉</span>
                {diver.person.email}
              </a>
            ) : null}
            {diver.person.phone ? (
              <a
                href={`tel:${diver.person.phone.replace(/[^\d+]/g, "")}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 font-medium text-primary hover:bg-primary/10 hover:underline"
              >
                <span aria-hidden="true">☎</span>
                {diver.person.phone}
              </a>
            ) : null}
            {!diver.person.email && !diver.person.phone ? (
              <span>No contact details yet</span>
            ) : null}
          </div>
        </div>
        <details className="rounded-lg border border-border bg-surface px-4 py-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
            Edit details
          </summary>
          <FieldGrid
            as="form"
            action={savePersonAction}
            columns={1}
            className="mt-4 gap-y-3 sm:w-80"
          >
            <Field label="Full name">
              <input
                name="fullName"
                required
                defaultValue={diver.person.fullName}
                className={controlClass}
              />
            </Field>
            <Field label="Email">
              <input
                name="email"
                type="email"
                defaultValue={diver.person.email ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label="Phone">
              <input
                name="phone"
                type="tel"
                defaultValue={diver.person.phone ?? ""}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <button type="submit" className={buttonClass()}>
                Save details
              </button>
            </FieldActions>
          </FieldGrid>
        </details>
      </header>

      {noticeText ? (
        <p
          role="status"
          className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${errorNotice ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}
        >
          {noticeText}
        </p>
      ) : null}

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-muted">Cards</p>
          <p className="mt-1 text-2xl font-semibold">
            {diver.certifications.length +
              diver.specialtyCertifications.length +
              diver.nitroxCertifications.length}
          </p>
          <p className="text-sm text-muted">
            {diver.certifications.filter((card) => card.status === "pending").length +
              diver.specialtyCertifications.filter((card) => card.status === "pending").length +
              diver.nitroxCertifications.filter((card) => card.status === "pending").length}{" "}
            pending review
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-muted">Rental fit</p>
          <p className="mt-1 text-2xl font-semibold">{profile ? "Saved" : "Needed"}</p>
          <p className="text-sm text-muted">Reusable for future bookings</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-muted">Shop history</p>
          <p className="mt-1 text-2xl font-semibold">{diver.bookings.length}</p>
          <p className="text-sm text-muted">booking{diver.bookings.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      <section className="mt-10" aria-labelledby="cards-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="cards-heading" className="text-lg font-semibold">
              Certification cards
            </h2>
            <p className="mt-1 text-sm text-muted">
              Evidence starts pending. Only verified cards affect readiness.
            </p>
          </div>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
              Add card
            </summary>
            <FieldGrid
              as="form"
              action={addCertificationAction}
              encType="multipart/form-data"
              columns={2}
              className="mt-3 gap-y-3 rounded-lg border border-border bg-surface p-4 sm:w-[32rem]"
            >
              <Field label="Agency">
                <select name="agency" className={controlClass}>
                  {Object.entries(AGENCY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Level">
                <select name="level" className={controlClass}>
                  {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Card number">
                <input name="identifier" required className={controlClass} />
              </Field>
              <Field label="Expiry" hint="(if issued)">
                <input name="expiresOn" type="date" className={controlClass} />
              </Field>
              <Field
                label="Card photo"
                hint="(optional; JPG, PNG, or WebP; ≤5 MB)"
                className="sm:col-span-2"
              >
                <input
                  name="cardImage"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  className={controlClass}
                />
              </Field>
              <FieldActions>
                <button type="submit" className={buttonClass({ variant: "secondary" })}>
                  Capture for review
                </button>
              </FieldActions>
            </FieldGrid>
          </details>
        </div>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {diver.certifications.length === 0 ? (
            <li className="px-4 py-5 text-sm text-muted">No level cards on file.</li>
          ) : (
            diver.certifications.map((card) => (
              <li
                key={card.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {AGENCY_LABELS[card.agency]} · {CERTIFICATION_LEVEL_LABELS[card.level]}
                  </p>
                  <p className="mt-1 break-all text-sm text-muted">
                    {card.identifier}
                    {card.expiresAt
                      ? ` · expires ${card.expiresAt.toLocaleDateString("en-US")}`
                      : ""}
                  </p>
                  {card.reviewNote ? (
                    <p className="mt-1 text-sm text-muted italic">{card.reviewNote}</p>
                  ) : null}
                  {card.cardImageUrl ? (
                    <a
                      href={card.cardImageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                    >
                      View card photo
                    </a>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-medium ${statusTone(card.status)}`}
                  >
                    {card.status}
                  </span>
                  {card.status === "pending" ? (
                    <>
                      <form action={agencyCheckAction}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <button
                          type="submit"
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Check agency
                        </button>
                      </form>
                      <form action={reviewAction}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="status" value="verified" />
                        <button
                          type="submit"
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Verify
                        </button>
                      </form>
                      <form action={reviewAction}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <button
                          type="submit"
                          className={buttonClass({ variant: "danger", size: "sm" })}
                        >
                          Needs correction
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-10 border-t border-border pt-8" aria-labelledby="specialty-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="specialty-heading" className="text-lg font-semibold">
              Specialty cards
            </h2>
            <p className="mt-1 text-sm text-muted">
              Specialty cards live with the diver. A verified Nitrox card is required before an EANx
              fill or tank handoff.
            </p>
          </div>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
              Add specialty
            </summary>
            <FieldGrid
              as="form"
              action={addSpecialtyAction}
              encType="multipart/form-data"
              columns={2}
              className="mt-3 gap-y-3 rounded-lg border border-border bg-surface p-4 sm:w-[32rem]"
            >
              <Field label="Agency">
                <select name="agency" className={controlClass}>
                  {Object.entries(AGENCY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Specialty">
                <select name="specialty" className={controlClass}>
                  {[...Object.entries(SPECIALTY_LABELS), ["nitrox", "Nitrox"]].map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Card number">
                <input name="identifier" required className={controlClass} />
              </Field>
              <Field label="Expiry" hint="(if issued)">
                <input name="expiresOn" type="date" className={controlClass} />
              </Field>
              <Field
                label="Card photo"
                hint="(optional; JPG, PNG, or WebP; ≤5 MB)"
                className="sm:col-span-2"
              >
                <input
                  name="cardImage"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  className={controlClass}
                />
              </Field>
              <FieldActions>
                <button type="submit" className={buttonClass({ variant: "secondary" })}>
                  Capture specialty for review
                </button>
              </FieldActions>
            </FieldGrid>
          </details>
        </div>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {diver.specialtyCertifications.length === 0 && diver.nitroxCertifications.length === 0 ? (
            <li className="px-4 py-5 text-sm text-muted">No specialty cards on file.</li>
          ) : (
            <>
              {diver.specialtyCertifications.map((card) => (
                <li
                  key={card.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">
                      {AGENCY_LABELS[card.agency]} · {SPECIALTY_LABELS[card.specialty]}
                    </p>
                    <p className="mt-1 break-all text-sm text-muted">
                      {card.identifier}
                      {card.expiresAt
                        ? ` · expires ${card.expiresAt.toLocaleDateString("en-US")}`
                        : ""}
                    </p>
                    {card.cardImageUrl ? (
                      <a
                        href={card.cardImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                      >
                        View card photo
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-medium ${statusTone(card.status)}`}
                    >
                      {card.status}
                    </span>
                    {card.status === "pending" ? (
                      <>
                        <form action={reviewSpecialtyAction}>
                          <input type="hidden" name="certificationId" value={card.id} />
                          <input type="hidden" name="status" value="verified" />
                          <button
                            type="submit"
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            Verify
                          </button>
                        </form>
                        <form action={reviewSpecialtyAction}>
                          <input type="hidden" name="certificationId" value={card.id} />
                          <input type="hidden" name="status" value="rejected" />
                          <button
                            type="submit"
                            className={buttonClass({ variant: "danger", size: "sm" })}
                          >
                            Needs correction
                          </button>
                        </form>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
              {diver.nitroxCertifications.map((card) => (
                <li
                  key={card.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{AGENCY_LABELS[card.agency]} · Nitrox</p>
                    <p className="mt-1 break-all text-sm text-muted">{card.identifier}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-medium ${statusTone(card.status)}`}
                    >
                      {card.status}
                    </span>
                    {card.status === "pending" ? (
                      <>
                        <form action={reviewSpecialtyAction}>
                          <input type="hidden" name="certificationId" value={card.id} />
                          <input type="hidden" name="cardType" value="nitrox" />
                          <input type="hidden" name="status" value="verified" />
                          <button
                            type="submit"
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            Verify
                          </button>
                        </form>
                        <form action={reviewSpecialtyAction}>
                          <input type="hidden" name="certificationId" value={card.id} />
                          <input type="hidden" name="cardType" value="nitrox" />
                          <input type="hidden" name="status" value="rejected" />
                          <button
                            type="submit"
                            className={buttonClass({ variant: "danger", size: "sm" })}
                          >
                            Needs correction
                          </button>
                        </form>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </>
          )}
        </ul>
      </section>

      <section className="mt-10 border-t border-border pt-8" aria-labelledby="gear-profile-heading">
        <div>
          <h2 id="gear-profile-heading" className="text-lg font-semibold">
            Rental fit
          </h2>
          <p className="mt-1 text-sm text-muted">
            Planning preferences, not an equipment reservation or a substitute for a dock-side fit
            check.
          </p>
        </div>
        <FieldGrid
          as="form"
          action={saveProfileAction}
          columns={2}
          className="mt-4 rounded-lg border border-border bg-surface p-5"
        >
          <Field label="BCD size">
            <input
              name="bcdSize"
              defaultValue={profile?.bcdSize ?? ""}
              placeholder="M"
              className={controlClass}
            />
          </Field>
          <Field label="Wetsuit size">
            <input
              name="wetsuitSize"
              defaultValue={profile?.wetsuitSize ?? ""}
              placeholder="3 mm / M"
              className={controlClass}
            />
          </Field>
          <Field label="Boot size">
            <input
              name="bootSize"
              defaultValue={profile?.bootSize ?? ""}
              placeholder="9"
              className={controlClass}
            />
          </Field>
          <Field label="Fin size">
            <input
              name="finSize"
              defaultValue={profile?.finSize ?? ""}
              placeholder="L"
              className={controlClass}
            />
          </Field>
          <Field label="Weight preference" className="sm:col-span-2">
            <input
              name="weightPreference"
              defaultValue={profile?.weightPreference ?? ""}
              placeholder="Usually 12 lb with 3 mm suit"
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <button type="submit" className={buttonClass({ size: "lg" })}>
              Save rental fit
            </button>
          </FieldActions>
        </FieldGrid>
      </section>

      <section
        className="mt-10 border-t border-border pt-8"
        aria-labelledby="book-activity-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="book-activity-heading" className="text-lg font-semibold">
              Book an activity
            </h2>
            <p className="mt-1 text-sm text-muted">
              Add this diver to an available course or dive, then create the order from their
              booking.
            </p>
          </div>
        </div>
        {diver.person.email ? (
          <form
            action={bookActivityAction}
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
            <button type="submit" className={buttonClass({ size: "lg" })}>
              Book activity
            </button>
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

      <section className="mt-10 border-t border-border pt-8" aria-labelledby="payments-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="payments-heading" className="text-lg font-semibold">
              Payments
            </h2>
            <p className="mt-1 text-sm text-muted">
              Payment status, invoices, and refunds stay with the diver so the next action is easy
              to find.
            </p>
          </div>
          <Link
            href={`/shop/${shopSlug}/orders/new?personId=${personId}`}
            className={buttonClass()}
          >
            New payment
          </Link>
        </div>

        {diver.bookings.length === 0 && diver.orders.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            No trip payments yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {diver.bookings.map(({ booking, trip }) => {
              const bookingPayment = diver.bookingPayments.find(
                (row) => row.booking.id === booking.id,
              );
              const orderRow = diver.orders.find((row) => row.order.bookingId === booking.id);
              return (
                <li
                  key={booking.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <Link
                      href={`/shop/${shopSlug}/trips/${trip.id}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {trip.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {formatShortDate(trip.startsAt, "en-US", shop.timezone)} · booking payment
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {bookingPayment
                        ? `Payment gate: ${PAYMENT_STATUS_LABELS[bookingPayment.payment.status] ?? bookingPayment.payment.status}`
                        : "Payment gate: not recorded"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {orderRow ? (
                      <Link
                        href={`/shop/${shopSlug}/orders/${orderRow.order.id}`}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        Open payment
                      </Link>
                    ) : (
                      <Link
                        href={`/shop/${shopSlug}/orders/new?personId=${personId}&bookingId=${booking.id}`}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        Create invoice
                      </Link>
                    )}
                    {orderRow?.order.status === "paid" ? (
                      <form action={refundPaymentAction}>
                        <input type="hidden" name="orderId" value={orderRow.order.id} />
                        <button
                          type="submit"
                          className={buttonClass({ variant: "danger", size: "sm" })}
                        >
                          Refund
                        </button>
                      </form>
                    ) : null}
                    <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
                      {orderRow
                        ? (ORDER_STATUS_LABELS[orderRow.order.status] ?? orderRow.order.status)
                        : bookingPayment
                          ? (PAYMENT_STATUS_LABELS[bookingPayment.payment.status] ??
                            bookingPayment.payment.status)
                          : "No invoice"}
                    </span>
                  </div>
                </li>
              );
            })}
            {diver.orders
              .filter(({ order }) => order.bookingId === null)
              .map(({ order }) => (
                <li
                  key={order.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{order.description || "Shop payment"}</p>
                    <p className="text-sm text-muted">
                      ${(order.totalCents / 100).toFixed(2)} {order.currency.toUpperCase()} · no
                      trip attached
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/shop/${shopSlug}/orders/${order.id}`}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Open payment
                    </Link>
                    {order.status === "paid" ? (
                      <form action={refundPaymentAction}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <button
                          type="submit"
                          className={buttonClass({ variant: "danger", size: "sm" })}
                        >
                          Refund
                        </button>
                      </form>
                    ) : null}
                    <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
                      {ORDER_STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="mt-10 border-t border-border pt-8" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold">
          Shop history
        </h2>
        {diver.gearAssignments.some(({ assignment }) => assignment.status === "assigned") ? (
          <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
            <h3 className="font-medium">Gear currently checked out</h3>
            <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              {diver.gearAssignments
                .filter(({ assignment }) => assignment.status === "assigned")
                .map(({ assignment, item, trip }) => (
                  <li key={assignment.id}>
                    <strong>{item.label}</strong> · {item.type.replace("_", " ")}
                    <Link
                      href={`/shop/${shopSlug}/trips/${trip.id}`}
                      className="block text-muted hover:text-primary hover:underline"
                    >
                      {trip.title}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        {diver.bookings.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            No bookings yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {diver.bookings.map(({ booking, trip, course }) => (
              <li
                key={booking.id}
                className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <Link
                    href={`/shop/${shopSlug}/trips/${trip.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {trip.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
                    {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
                    {course ? ` · ${course.title}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
                  {booking.status.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8" aria-labelledby="remove-heading">
        <h2 id="remove-heading" className="text-lg font-semibold">
          Remove from active divers
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          This is a soft delete: the person disappears from active shop lists, while bookings,
          cards, and gear history remain intact for records and safety review.
        </p>
        <details className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-4">
          <summary className="flex min-h-11 cursor-pointer items-center py-2 text-sm font-medium text-danger">
            Remove {diver.person.fullName}
          </summary>
          <form action={deletePersonAction} className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">
              You can add them again later as a new active record.
            </p>
            <button type="submit" className={buttonClass({ variant: "danger-solid" })}>
              Remove diver
            </button>
          </form>
        </details>
      </section>
    </main>
  );
}
