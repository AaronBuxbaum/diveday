import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import { getDiverProfile, updateDiver } from "@/db/divers";
import { saveRentalGearProfile } from "@/db/gear-requests";
import { getShopById } from "@/db/queries";
import {
  createCertification,
  createSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
  verifyCertificationWithAgency,
} from "@/db/readiness";
import { formatShortDate, formatTimeRange } from "@/lib/format";
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
const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);
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
    redirect(`${base}?notice=${saved ? "person-saved" : "duplicate"}`);
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
    redirect(`${base}?notice=${saved ? "captured" : "invalid"}`);
  }

  async function addSpecialtyAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = specialtyCertificationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${base}?notice=invalid`);
    const image = await resolveCardImage(formData);
    if (image.failed) redirect(`${base}?notice=image`);
    const saved = await createSpecialtyCertification(await getDb(), {
      shopId: staff.user.shopId,
      personId,
      agency: parsed.data.agency,
      specialty: parsed.data.specialty,
      identifier: parsed.data.identifier,
      expiresAt: dateFromInput(parsed.data.expiresOn),
      cardImageUrl: image.url,
    });
    redirect(`${base}?notice=${saved ? "captured" : "invalid"}`);
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
    redirect(`${base}?notice=${updated ? status : "invalid"}`);
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
    redirect(`${base}?notice=${result}`);
  }

  async function reviewSpecialtyAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const certificationId = String(formData.get("certificationId") ?? "");
    const status = formData.get("status") === "rejected" ? "rejected" : "verified";
    const updated = certificationId
      ? await reviewSpecialtyCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status,
        })
      : null;
    redirect(`${base}?notice=${updated ? status : "invalid"}`);
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
    redirect(`${base}?notice=${saved ? "profile-saved" : "invalid"}`);
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
                          : notice === "invalid"
                            ? "Check the details and try again."
                            : null;
  const errorNotice = [
    "image",
    "agency-not-found",
    "agency-mismatch",
    "agency-unavailable",
    "duplicate",
    "invalid",
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {diver.person.email ? <span>{diver.person.email}</span> : null}
            {diver.person.phone ? <span>{diver.person.phone}</span> : null}
            {!diver.person.email && !diver.person.phone ? (
              <span>No contact details yet</span>
            ) : null}
          </div>
        </div>
        <details className="rounded-lg border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">
            Edit details
          </summary>
          <form action={savePersonAction} className="mt-4 grid gap-3 sm:w-80">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Full name
              <input
                name="fullName"
                required
                defaultValue={diver.person.fullName}
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Email
              <input
                name="email"
                type="email"
                defaultValue={diver.person.email ?? ""}
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Phone
              <input
                name="phone"
                type="tel"
                defaultValue={diver.person.phone ?? ""}
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
              />
            </label>
            <button
              type="submit"
              className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Save details
            </button>
          </form>
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
            {diver.certifications.length + diver.specialtyCertifications.length}
          </p>
          <p className="text-sm text-muted">
            {diver.certifications.filter((card) => card.status === "pending").length +
              diver.specialtyCertifications.filter((card) => card.status === "pending").length}{" "}
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
            <summary className="min-h-11 cursor-pointer rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
              Add card
            </summary>
            <form
              action={addCertificationAction}
              encType="multipart/form-data"
              className="mt-3 grid gap-3 rounded-lg border border-border bg-surface p-4 sm:w-[32rem] sm:grid-cols-2"
            >
              <label className="flex flex-col gap-1 text-sm font-medium">
                Agency
                <select
                  name="agency"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
                >
                  {Object.entries(AGENCY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Level
                <select
                  name="level"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
                >
                  {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Card number
                <input
                  name="identifier"
                  required
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Expiry <span className="font-normal text-muted">(if issued)</span>
                <input
                  name="expiresOn"
                  type="date"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
                Card photo{" "}
                <span className="font-normal text-muted">(optional; JPG, PNG, or WebP; ≤5 MB)</span>
                <input
                  name="cardImage"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
                />
              </label>
              <button
                type="submit"
                className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-sunken sm:col-span-2"
              >
                Capture for review
              </button>
            </form>
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
                  <p className="mt-1 text-sm text-muted">
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
                          className="min-h-11 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-sunken"
                        >
                          Check agency
                        </button>
                      </form>
                      <form action={reviewAction}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="status" value="verified" />
                        <button
                          type="submit"
                          className="min-h-11 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-sunken"
                        >
                          Verify
                        </button>
                      </form>
                      <form action={reviewAction}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <button
                          type="submit"
                          className="min-h-11 rounded-lg px-3 text-sm font-medium text-danger hover:bg-danger/10"
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
              Deep, Wreck, Night, and Drysuit cards gate specific sites and trips.
            </p>
          </div>
          <details>
            <summary className="min-h-11 cursor-pointer rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
              Add specialty
            </summary>
            <form
              action={addSpecialtyAction}
              encType="multipart/form-data"
              className="mt-3 grid gap-3 rounded-lg border border-border bg-surface p-4 sm:w-[32rem] sm:grid-cols-2"
            >
              <label className="flex flex-col gap-1 text-sm font-medium">
                Agency
                <select
                  name="agency"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
                >
                  {Object.entries(AGENCY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Specialty
                <select
                  name="specialty"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
                >
                  {Object.entries(SPECIALTY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Card number
                <input
                  name="identifier"
                  required
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Expiry <span className="font-normal text-muted">(if issued)</span>
                <input
                  name="expiresOn"
                  type="date"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
                Card photo{" "}
                <span className="font-normal text-muted">(optional; JPG, PNG, or WebP; ≤5 MB)</span>
                <input
                  name="cardImage"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
                />
              </label>
              <button
                type="submit"
                className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-sunken sm:col-span-2"
              >
                Capture specialty for review
              </button>
            </form>
          </details>
        </div>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {diver.specialtyCertifications.length === 0 ? (
            <li className="px-4 py-5 text-sm text-muted">No specialty cards on file.</li>
          ) : (
            diver.specialtyCertifications.map((card) => (
              <li
                key={card.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {AGENCY_LABELS[card.agency]} · {SPECIALTY_LABELS[card.specialty]}
                  </p>
                  <p className="mt-1 text-sm text-muted">
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
                          className="min-h-11 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-sunken"
                        >
                          Verify
                        </button>
                      </form>
                      <form action={reviewSpecialtyAction}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <button
                          type="submit"
                          className="min-h-11 rounded-lg px-3 text-sm font-medium text-danger hover:bg-danger/10"
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
        <form
          action={saveProfileAction}
          className="mt-4 grid gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            BCD size
            <input
              name="bcdSize"
              defaultValue={profile?.bcdSize ?? ""}
              placeholder="M"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Wetsuit size
            <input
              name="wetsuitSize"
              defaultValue={profile?.wetsuitSize ?? ""}
              placeholder="3 mm / M"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Boot size
            <input
              name="bootSize"
              defaultValue={profile?.bootSize ?? ""}
              placeholder="9"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Fin size
            <input
              name="finSize"
              defaultValue={profile?.finSize ?? ""}
              placeholder="L"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Weight preference
            <input
              name="weightPreference"
              defaultValue={profile?.weightPreference ?? ""}
              placeholder="Usually 12 lb with 3 mm suit"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground sm:col-span-2 sm:justify-self-start"
          >
            Save rental fit
          </button>
        </form>
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
                    <span className="block text-muted">{trip.title}</span>
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
                  <p className="font-medium">{trip.title}</p>
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
    </main>
  );
}
