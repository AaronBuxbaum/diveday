import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/queries";
import {
  createCertification,
  createSpecialtyCertification,
  listShopCertifications,
  listShopDivers,
  listShopSpecialtyCertifications,
  reviewCertification,
  reviewSpecialtyCertification,
  verifyCertificationWithAgency,
} from "@/db/readiness";
import { CERTIFICATION_LEVEL_LABELS, SPECIALTY_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { storeCardImage } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Certifications — Scuba",
};

/**
 * Resolve the durable card-image reference: prefer an uploaded photo, fall back
 * to a pasted URL, and report a hard failure (bad file) so the caller can warn.
 * An unconfigured store silently falls back to the pasted URL.
 */
async function resolveCardImageUrl(
  formData: FormData,
  pastedUrl: string,
): Promise<{ url?: string; failed?: boolean }> {
  const file = formData.get("cardImage");
  if (file instanceof File && file.size > 0) {
    const stored = await storeCardImage({
      keyPrefix: "cards",
      filename: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer(),
    });
    if (stored.status === "stored") return { url: stored.url };
    if (stored.status === "failed") return { failed: true };
  }
  return { url: pastedUrl || undefined };
}

const agencySchema = z.enum(["padi", "ssi", "naui", "sdi", "tdi", "other"]);
const levelSchema = z.enum([
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
]);
const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);
const certificationSchema = z.object({
  personId: z.string().uuid(),
  agency: agencySchema,
  level: levelSchema,
  identifier: z.string().trim().min(2).max(120),
  expiresOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  cardImageUrl: z.union([z.literal(""), z.url().max(2_000)]),
});
const specialtyCertificationSchema = z.object({
  personId: z.string().uuid(),
  agency: agencySchema,
  specialty: specialtySchema,
  identifier: z.string().trim().min(2).max(120),
  expiresOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  cardImageUrl: z.union([z.literal(""), z.url().max(2_000)]),
});

const AGENCY_LABELS: Record<z.infer<typeof agencySchema>, string> = {
  padi: "PADI",
  ssi: "SSI",
  naui: "NAUI",
  sdi: "SDI",
  tdi: "TDI",
  other: "Other agency",
};

export default async function CertificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const [divers, certificationRows, specialtyRows] = await Promise.all([
    listShopDivers(db, shop.id),
    listShopCertifications(db, shop.id),
    listShopSpecialtyCertifications(db, shop.id),
  ]);

  async function addCertificationAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/certifications?notice=invalid`);
    const image = await resolveCardImageUrl(formData, parsed.data.cardImageUrl);
    if (image.failed) redirect(`/shop/${staff.user.shopSlug}/certifications?notice=image`);
    const expiresAt = parsed.data.expiresOn
      ? new Date(`${parsed.data.expiresOn}T23:59:59.999Z`)
      : undefined;
    const certification = await createCertification(await getDb(), {
      shopId: staff.user.shopId,
      personId: parsed.data.personId,
      agency: parsed.data.agency,
      level: parsed.data.level,
      identifier: parsed.data.identifier,
      expiresAt,
      cardImageUrl: image.url,
    });
    redirect(
      `/shop/${staff.user.shopSlug}/certifications?notice=${certification ? "captured" : "invalid"}`,
    );
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
    redirect(`/shop/${staff.user.shopSlug}/certifications?notice=${updated ? status : "invalid"}`);
  }

  async function agencyCheckAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const certificationId = String(formData.get("certificationId") ?? "");
    const outcome = certificationId
      ? await verifyCertificationWithAgency(await getDb(), staff.user.shopId, certificationId)
      : null;
    const notice =
      outcome === "verified"
        ? "agency-verified"
        : outcome === "not_found"
          ? "agency-not-found"
          : outcome === "mismatch"
            ? "agency-mismatch"
            : outcome === "unavailable"
              ? "agency-unavailable"
              : "invalid";
    redirect(`/shop/${staff.user.shopSlug}/certifications?notice=${notice}`);
  }

  async function addSpecialtyAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = specialtyCertificationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/certifications?notice=invalid`);
    const image = await resolveCardImageUrl(formData, parsed.data.cardImageUrl);
    if (image.failed) redirect(`/shop/${staff.user.shopSlug}/certifications?notice=image`);
    const expiresAt = parsed.data.expiresOn
      ? new Date(`${parsed.data.expiresOn}T23:59:59.999Z`)
      : undefined;
    const certification = await createSpecialtyCertification(await getDb(), {
      shopId: staff.user.shopId,
      personId: parsed.data.personId,
      agency: parsed.data.agency,
      specialty: parsed.data.specialty,
      identifier: parsed.data.identifier,
      expiresAt,
      cardImageUrl: image.url,
    });
    redirect(
      `/shop/${staff.user.shopSlug}/certifications?notice=${certification ? "captured" : "invalid"}`,
    );
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
    redirect(`/shop/${staff.user.shopSlug}/certifications?notice=${updated ? status : "invalid"}`);
  }

  const banner =
    notice === "captured"
      ? "Card captured as pending. Verify it before it can make a diver ready."
      : notice === "verified"
        ? "Certification verified."
        : notice === "rejected"
          ? "Certification marked for correction."
          : notice === "invalid"
            ? "That certification could not be saved. Check the diver and card details."
            : notice === "image"
              ? "That photo couldn’t be used. Upload a JPG, PNG, or WebP under 5 MB, or paste a URL."
              : notice === "agency-verified"
                ? "Confirmed with the agency and verified."
                : notice === "agency-not-found"
                  ? "The agency couldn’t find this card. Left pending with a note — review manually."
                  : notice === "agency-mismatch"
                    ? "The agency returned a mismatch. Left pending with a note — review manually."
                    : notice === "agency-unavailable"
                      ? "Agency verification isn’t configured. Verify this card manually."
                      : undefined;
  const errorNotice =
    notice === "invalid" ||
    notice === "image" ||
    notice === "agency-not-found" ||
    notice === "agency-mismatch" ||
    notice === "agency-unavailable";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <Link href={`/shop/${shopSlug}`} className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>
      <header className="mt-4">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Certifications</h1>
        <p className="mt-2 text-muted">
          Capture card evidence, then explicitly verify it before the readiness service can clear a
          diver.
        </p>
      </header>

      {banner ? (
        <p
          role="status"
          className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${errorNotice ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}
        >
          {banner}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Capture a card</h2>
        {divers.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            Divers appear here after they book a trip.
          </p>
        ) : (
          <form
            action={addCertificationAction}
            className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2"
          >
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Diver
              <select
                name="personId"
                required
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
              >
                <option value="">Choose a diver</option>
                {divers.map((diver) => (
                  <option key={diver.id} value={diver.id}>
                    {diver.fullName}
                    {diver.email ? ` · ${diver.email}` : ""}
                  </option>
                ))}
              </select>
            </label>
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
                maxLength={120}
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
              <span className="font-normal text-muted">(upload; JPG/PNG/WebP, ≤5 MB)</span>
              <input
                name="cardImage"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Card image URL{" "}
              <span className="font-normal text-muted">(or paste a secure reference)</span>
              <input
                name="cardImageUrl"
                type="url"
                maxLength={2000}
                placeholder="https://…"
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
              >
                Capture for review
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Capture a specialty card</h2>
        <p className="mt-1 text-sm text-muted">
          Deep, Wreck, Night, and Drysuit gate specific sites and trips. Nitrox is handled per tank
          at fill time, not here.
        </p>
        {divers.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            Divers appear here after they book a trip.
          </p>
        ) : (
          <form
            action={addSpecialtyAction}
            className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2"
          >
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Diver
              <select
                name="personId"
                required
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
              >
                <option value="">Choose a diver</option>
                {divers.map((diver) => (
                  <option key={diver.id} value={diver.id}>
                    {diver.fullName}
                    {diver.email ? ` · ${diver.email}` : ""}
                  </option>
                ))}
              </select>
            </label>
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
                maxLength={120}
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
              <span className="font-normal text-muted">(upload; JPG/PNG/WebP, ≤5 MB)</span>
              <input
                name="cardImage"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Card image URL{" "}
              <span className="font-normal text-muted">(or paste a secure reference)</span>
              <input
                name="cardImageUrl"
                type="url"
                maxLength={2000}
                placeholder="https://…"
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
              >
                Capture specialty for review
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Cards on file</h2>
        {certificationRows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No certification cards are on file yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {certificationRows.map(({ certification, person }) => {
              const tone =
                certification.status === "verified"
                  ? "bg-success/10 text-success"
                  : certification.status === "rejected"
                    ? "bg-danger/10 text-danger"
                    : "bg-warning/10 text-warning";
              return (
                <li
                  key={certification.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">
                      {person.fullName} · {AGENCY_LABELS[certification.agency]}{" "}
                      {CERTIFICATION_LEVEL_LABELS[certification.level]}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {certification.identifier}
                      {certification.expiresAt
                        ? ` · expires ${certification.expiresAt.toLocaleDateString("en-US")}`
                        : ""}
                    </p>
                    {certification.reviewNote ? (
                      <p className="mt-1 text-sm text-muted italic">{certification.reviewNote}</p>
                    ) : null}
                    {certification.cardImageUrl ? (
                      <a
                        href={certification.cardImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                      >
                        View card reference
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-sm font-medium ${tone}`}>
                      {certification.status}
                    </span>
                    {certification.status === "pending" ? (
                      <>
                        <form action={agencyCheckAction}>
                          <input type="hidden" name="certificationId" value={certification.id} />
                          <button
                            type="submit"
                            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-sunken"
                          >
                            Check with {AGENCY_LABELS[certification.agency]}
                          </button>
                        </form>
                        <form action={reviewAction}>
                          <input type="hidden" name="certificationId" value={certification.id} />
                          <input type="hidden" name="status" value="verified" />
                          <button
                            type="submit"
                            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-sunken"
                          >
                            Verify
                          </button>
                        </form>
                        <form action={reviewAction}>
                          <input type="hidden" name="certificationId" value={certification.id} />
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
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Specialty cards on file</h2>
        {specialtyRows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No specialty cards are on file yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {specialtyRows.map(({ certification, person }) => {
              const tone =
                certification.status === "verified"
                  ? "bg-success/10 text-success"
                  : certification.status === "rejected"
                    ? "bg-danger/10 text-danger"
                    : "bg-warning/10 text-warning";
              return (
                <li
                  key={certification.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">
                      {person.fullName} · {AGENCY_LABELS[certification.agency]}{" "}
                      {SPECIALTY_LABELS[certification.specialty]} specialty
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {certification.identifier}
                      {certification.expiresAt
                        ? ` · expires ${certification.expiresAt.toLocaleDateString("en-US")}`
                        : ""}
                    </p>
                    {certification.reviewNote ? (
                      <p className="mt-1 text-sm text-muted italic">{certification.reviewNote}</p>
                    ) : null}
                    {certification.cardImageUrl ? (
                      <a
                        href={certification.cardImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                      >
                        View card reference
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-sm font-medium ${tone}`}>
                      {certification.status}
                    </span>
                    {certification.status === "pending" ? (
                      <>
                        <form action={reviewSpecialtyAction}>
                          <input type="hidden" name="certificationId" value={certification.id} />
                          <input type="hidden" name="status" value="verified" />
                          <button
                            type="submit"
                            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-sunken"
                          >
                            Verify
                          </button>
                        </form>
                        <form action={reviewSpecialtyAction}>
                          <input type="hidden" name="certificationId" value={certification.id} />
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
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
