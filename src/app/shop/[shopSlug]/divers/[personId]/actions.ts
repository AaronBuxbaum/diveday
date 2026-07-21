"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { deleteDiver, getDiverProfile, updateDiver } from "@/db/divers";
import {
  archiveNitroxCertification,
  createNitroxCertification,
  reviewNitroxCertification,
} from "@/db/nitrox";
import { refundOrder } from "@/db/orders";
import {
  archiveCertification,
  archiveSpecialtyCertification,
  createCertification,
  createSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
} from "@/db/readiness";
import { saveRentalFit } from "@/db/rental-fit";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { storeCardImage } from "@/lib/storage";

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
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  wetsuit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  diveComputer: z.string().optional(),
  gopro: z.string().optional(),
  bcdSize: z.string().trim().max(40),
  wetsuitSize: z.string().trim().max(40),
  bootSize: z.string().trim().max(40),
  finSize: z.string().trim().max(40),
  weightPreference: z.string().trim().max(120),
});

type ResolvedCardImage =
  /** No file offered, or one stored successfully (url undefined when none given). */
  | { url: string | undefined }
  /** Storage isn't set up for this deployment — keep the card, just without a photo. */
  | { unconfigured: true }
  /** The file itself was rejected (wrong type, too large, or the provider failed). */
  | { failed: true };

async function resolveCardImage(formData: FormData): Promise<ResolvedCardImage> {
  const file = formData.get("cardImage");
  if (!(file instanceof File) || file.size === 0) return { url: undefined };
  const stored = await storeCardImage({
    keyPrefix: "cards",
    filename: file.name,
    contentType: file.type,
    bytes: await file.arrayBuffer(),
  });
  // `not_configured` is not a bad photo: no blob storage is wired up, so we save
  // the card without the image rather than rejecting a perfectly valid upload.
  if (stored.status === "not_configured") return { unconfigured: true };
  return stored.status === "stored" ? { url: stored.url } : { failed: true };
}

function dateFromInput(value: string) {
  return value ? new Date(`${value}T23:59:59.999Z`) : undefined;
}

export async function savePersonAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
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

export async function addCertificationAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?notice=invalid`);
  const image = await resolveCardImage(formData);
  if ("failed" in image) redirect(`${base}?notice=image`);
  const saved = await createCertification(await getDb(), {
    shopId: staff.user.shopId,
    personId,
    agency: parsed.data.agency,
    level: parsed.data.level,
    identifier: parsed.data.identifier,
    expiresAt: dateFromInput(parsed.data.expiresOn),
    cardImageUrl: "url" in image ? image.url : undefined,
  });
  const notice = saved ? ("unconfigured" in image ? "captured-no-photo" : "captured") : "invalid";
  revalidateAndRedirect(base, `${base}?notice=${notice}`);
}

export async function addSpecialtyAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = specialtyCertificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?notice=invalid`);
  const image = await resolveCardImage(formData);
  if ("failed" in image) redirect(`${base}?notice=image`);
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
          cardImageUrl: "url" in image ? image.url : undefined,
        });
  const notice = saved ? ("unconfigured" in image ? "captured-no-photo" : "captured") : "invalid";
  revalidateAndRedirect(base, `${base}?notice=${notice}`);
}

/** The only review outcome is "certified" — a bad card is deleted, not marked for correction. */
export async function reviewAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const updated = certificationId
    ? await reviewCertification(await getDb(), {
        shopId: staff.user.shopId,
        certificationId,
        status: "verified",
      })
    : null;
  revalidateAndRedirect(base, `${base}?notice=${updated ? "verified" : "invalid"}`);
}

export async function reviewSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const updated = certificationId
    ? formData.get("cardType") === "nitrox"
      ? await reviewNitroxCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
        })
      : await reviewSpecialtyCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
        })
    : null;
  revalidateAndRedirect(base, `${base}?notice=${updated ? "verified" : "invalid"}`);
}

/**
 * Delete a level card. It is a soft-archive: the card leaves the diver's list
 * and stops counting toward readiness, but the row is kept for safety history
 * (ADR 20260719-crud-archive-semantics). Replaces the old "needs correction" flow.
 */
export async function deleteCertificationAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const deleted = certificationId
    ? await archiveCertification(await getDb(), { shopId: staff.user.shopId, certificationId })
    : false;
  revalidateAndRedirect(base, `${base}?notice=${deleted ? "card-deleted" : "invalid"}`);
}

/** Delete a specialty or nitrox card (soft-archive; dispatched by the hidden `cardType`). */
export async function deleteSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const db = await getDb();
  const deleted = certificationId
    ? formData.get("cardType") === "nitrox"
      ? await archiveNitroxCertification(db, { shopId: staff.user.shopId, certificationId })
      : await archiveSpecialtyCertification(db, { shopId: staff.user.shopId, certificationId })
    : false;
  revalidateAndRedirect(base, `${base}?notice=${deleted ? "card-deleted" : "invalid"}`);
}

export async function saveProfileAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?notice=invalid`);
  const saved = await saveRentalFit(await getDb(), {
    shopId: staff.user.shopId,
    personId,
    rentsBcd: parsed.data.bcd === "on",
    rentsRegulator: parsed.data.regulator === "on",
    rentsWetsuit: parsed.data.wetsuit === "on",
    rentsMaskFins: parsed.data.maskFins === "on",
    rentsWeights: parsed.data.weights === "on",
    rentsDiveComputer: parsed.data.diveComputer === "on",
    rentsGopro: parsed.data.gopro === "on",
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    bootSize: parsed.data.bootSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
  });
  revalidateAndRedirect(base, `${base}?notice=${saved ? "profile-saved" : "invalid"}`);
}

export async function refundPaymentAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const refunded = orderId ? await refundOrder(await getDb(), staff.user.shopId, orderId) : null;
  revalidateAndRedirect(base, `${base}?notice=${refunded ? "refunded" : "refund-failed"}`);
}

export async function bookActivityAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
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

export async function deletePersonAction(shopSlug: string, personId: string, _formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const deleted = await deleteDiver(await getDb(), staff.user.shopId, personId);
  revalidateAndRedirect(
    `/shop/${staff.user.shopSlug}/divers`,
    deleted
      ? `/shop/${staff.user.shopSlug}/divers?notice=deleted&deleted=${encodeURIComponent(personId)}`
      : base,
  );
}
