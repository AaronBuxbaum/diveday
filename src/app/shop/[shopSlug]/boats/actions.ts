"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageBoats } from "@/db/authz";
import {
  type BoatPapersInput,
  createBoat,
  deleteBoat,
  replaceBoatPhoto,
  updateBoatWithinCertificate,
} from "@/db/boats";
import { getDb } from "@/db/client";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getShopById } from "@/db/shops";
import { type BoatSeatsRefusal, boatSeatsRefusal } from "@/lib/boat-safety";
import { isValidCalendarDate } from "@/lib/calendar-date";
import {
  normalizeCallSign,
  normalizeMmsi,
  normalizeWorkingChannel,
} from "@/lib/emergency-reference";
import { formValue, readForm, trimmedText } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { MAX_SHOP_HERO_BYTES, storeShopHeroImage } from "@/lib/storage";
import { uuidParam } from "@/lib/uuid";
import { registerBlock } from "../register-block";
import { boatRowId } from "./certificate-error";

/** A fleet row as posted; the boat's papers are narrowed by `boatPapers`. */
const boatForm = z.object({
  boatId: formValue(),
  name: trimmedText(),
  capacity: formValue(),
  description: trimmedText(),
  certifiedPassengers: trimmedText(),
  certifiedTotalPersons: trimmedText(),
  coiExpiresOn: trimmedText(),
  inspectionDueOn: trimmedText(),
  registrationExpiresOn: trimmedText(),
  insuranceExpiresOn: trimmedText(),
  callSign: trimmedText(),
  mmsi: trimmedText(),
  workingChannel: trimmedText(),
});
type BoatForm = z.infer<typeof boatForm>;

/** The storefront's one line about a hull: trimmed, bounded, and null when empty. */
function boatDescription(form: BoatForm): string | null {
  const text = form.description.slice(0, 200);
  return text.length > 0 ? text : null;
}

/**
 * The certificate's two limits (passengers, and total persons with the crew,
 * #2302) and the boat's four paper dates, as the fleet row posts them. Every
 * one optional, and an empty box is a cleared value; anything that is not a
 * whole number of people or a real calendar day refuses the save rather than
 * being dropped, so a typo is never stored as "nothing said" (roadmap N-10).
 * The radio identity rides with them (fourth review, item 11): an MMSI that is
 * not nine digits refuses the save the same way.
 */
function boatPapers(
  form: BoatForm,
): BoatPapersInput | "invalid" | "radio-invalid" | "channel-distress" {
  const day = (
    name: "coiExpiresOn" | "inspectionDueOn" | "registrationExpiresOn" | "insuranceExpiresOn",
  ): string | null | "invalid" => {
    const value = form[name];
    if (!value) return null;
    return isValidCalendarDate(value) ? value : "invalid";
  };
  const people = (name: "certifiedPassengers" | "certifiedTotalPersons") => {
    const value = form[name];
    if (!value) return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 999 ? number : "invalid";
  };
  const certifiedPassengers = people("certifiedPassengers");
  const certifiedTotalPersons = people("certifiedTotalPersons");
  const coiExpiresOn = day("coiExpiresOn");
  const inspectionDueOn = day("inspectionDueOn");
  const registrationExpiresOn = day("registrationExpiresOn");
  const insuranceExpiresOn = day("insuranceExpiresOn");
  if (
    certifiedPassengers === "invalid" ||
    certifiedTotalPersons === "invalid" ||
    coiExpiresOn === "invalid" ||
    inspectionDueOn === "invalid" ||
    registrationExpiresOn === "invalid" ||
    insuranceExpiresOn === "invalid"
  ) {
    return "invalid";
  }
  const callSign = normalizeCallSign(form.callSign ?? "");
  const mmsi = normalizeMmsi(form.mmsi ?? "");
  const workingChannel = normalizeWorkingChannel(form.workingChannel ?? "");
  // Its own refusal: "Provide a boat name and capacity." over a mistyped
  // MMSI sent the owner looking at the two fields that were fine.
  if (callSign === "invalid" || mmsi === "invalid" || workingChannel === "invalid") {
    return "radio-invalid";
  }
  // 16 and 70 are every boat's distress and calling channels: said in its own
  // words, because "check the working channel" over a real channel reads wrong.
  if (workingChannel === "distress") return "channel-distress";
  return {
    certifiedPassengers,
    certifiedTotalPersons,
    coiExpiresOn,
    inspectionDueOn,
    registrationExpiresOn,
    insuranceExpiresOn,
    callSign,
    mmsi,
    workingChannel,
  };
}

/**
 * Redirects with the fleet row's field error when the boat's numbers break
 * the certificate (H-20261009-certificate-caps-seats). `boat` names the row the error belongs on ("new"
 * for the add form), and the numbers ride along so the sentence can say them.
 */
function certificateRefusal(page: string, boat: string, refusal: BoatSeatsRefusal | null) {
  if (!refusal) return;
  // The fragment scrolls to the row the error is on (`boatRowId`).
  const row = `${page}#${boatRowId(boat)}`;
  if (refusal.code === "capacity_above_total_persons") {
    redirect(
      noticeUrl(row, "boat-capacity-above-persons", {
        boat,
        capacity: refusal.capacity,
        limit: refusal.limit,
      }),
    );
  }
  if (refusal.code === "passengers_above_total_persons") {
    redirect(
      noticeUrl(row, "boat-passengers-above-persons", {
        boat,
        passengers: refusal.passengers,
        limit: refusal.limit,
      }),
    );
  }
  redirect(
    noticeUrl(row, "boat-departures-above-certificate", {
      boat,
      count: refusal.departures,
      limit: refusal.limit,
      dates: refusal.firstDates.join(","),
    }),
  );
}

/** Validation must return to the editor that can correct it, including Add. */
function validationRefusal(
  page: string,
  boat: string | null | undefined,
  notice: "boat-invalid" | "boat-radio-invalid" | "boat-channel-distress",
): never {
  redirect(
    noticeUrl(boat ? `${page}#${boatRowId(boat)}` : page, notice, {
      boat: boat ?? undefined,
    }),
  );
}

/** Creates a new boat for the shop. */
export async function createBoatAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "boats");
  await registerBlock(session, canPersonManageBoats);
  const form = readForm(boatForm, formData);

  const name = form.name;
  const capacity = Number(form.capacity ?? 0);
  const description = boatDescription(form);
  const papers = boatPapers(form);

  if (papers === "radio-invalid") validationRefusal(page, "new", "boat-radio-invalid");
  if (papers === "channel-distress") validationRefusal(page, "new", "boat-channel-distress");
  if (!name || Number.isNaN(capacity) || capacity <= 0 || papers === "invalid") {
    validationRefusal(page, "new", "boat-invalid");
  }

  // H-20261009-certificate-caps-seats: no seat above the certificate is sold, so none is put on sale.
  certificateRefusal(page, "new", boatSeatsRefusal({ capacity, ...papers }));

  const db = await getDb();
  await createBoat(
    db,
    session.user.shopId,
    name,
    capacity,
    description,
    papers,
    session.user.personId,
  );

  revalidateAndRedirect(page, noticeUrl(page, "boat-created"));
}

/** Updates an existing boat: its name, seats, line, certificate and papers. */
export async function updateBoatAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "boats");
  await registerBlock(session, canPersonManageBoats);
  const form = readForm(boatForm, formData);

  const rawBoatId = form.boatId;
  const boatId = typeof rawBoatId === "string" ? uuidParam(rawBoatId) : null;
  const name = form.name;
  const capacity = Number(form.capacity ?? 0);
  const description = boatDescription(form);
  const papers = boatPapers(form);

  if (papers === "radio-invalid") validationRefusal(page, boatId, "boat-radio-invalid");
  if (papers === "channel-distress") validationRefusal(page, boatId, "boat-channel-distress");
  if (!boatId || !name || Number.isNaN(capacity) || capacity <= 0 || papers === "invalid") {
    validationRefusal(page, boatId, "boat-invalid");
  }

  const db = await getDb();
  // H-20261009-certificate-caps-seats, on every save of the row: a hull already over its certificate
  // keeps sailing, but this is the save that has to put it right. Upcoming
  // departures are read too, so a certificate cannot be lowered under seats
  // a departure is still selling — checked and written in one transaction.
  const saved = await updateBoatWithinCertificate(db, {
    shopId: session.user.shopId,
    boatId,
    name,
    capacity,
    description,
    papers,
    timeZone: (await getShopById(db, session.user.shopId))?.timezone ?? "UTC",
    actorPersonId: session.user.personId,
  });
  if (!saved.ok && saved.reason === "certificate") certificateRefusal(page, boatId, saved.refusal);
  if (!saved.ok) validationRefusal(page, boatId, "boat-invalid");

  const file = formData.get("boatPhoto");
  const picked = file instanceof File && file.size > 0 ? file : null;
  const remove = formData.get("removeBoatPhoto") === "true";
  if (picked || remove) {
    const refusePhoto = () =>
      redirect(noticeUrl(`${page}#${boatRowId(boatId)}`, "boat-photo-invalid", { boat: boatId }));
    if (picked && picked.size > MAX_SHOP_HERO_BYTES) refusePhoto();
    const result = picked
      ? await storeShopHeroImage({
          filename: picked.name,
          contentType: picked.type,
          bytes: await picked.arrayBuffer(),
        })
      : null;
    if (result && result.status !== "stored") refusePhoto();
    const photoUrl = result?.status === "stored" ? result.url : null;
    const replaced = await replaceBoatPhoto(
      db,
      session.user.shopId,
      boatId,
      saved.boat.photoUrl,
      photoUrl,
    );
    if (!replaced) {
      if (photoUrl)
        await queueAndAttemptMediaDeletion(db, {
          shopId: session.user.shopId,
          kind: "boat_photo",
          url: photoUrl,
        });
      refusePhoto();
    }
    revalidatePath(`/s/${session.user.shopSlug}`);
  }

  revalidateAndRedirect(page, noticeUrl(page, "boat-updated"));
}

/** Deletes a boat from the shop. */
export async function deleteBoatAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "boats");
  await registerBlock(session, canPersonManageBoats);
  const form = readForm(boatForm, formData);

  const rawBoatId = form.boatId;
  const boatId = typeof rawBoatId === "string" ? uuidParam(rawBoatId) : null;
  if (!boatId) {
    redirect(noticeUrl(page, "boat-invalid"));
  }

  const db = await getDb();
  await deleteBoat(db, session.user.shopId, boatId);

  revalidateAndRedirect(page, noticeUrl(page, "boat-deleted"));
}
