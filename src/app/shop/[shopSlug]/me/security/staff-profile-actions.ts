"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { ownStaffProfile, writeOwnStaffProfile } from "@/features/public-staff-profiles";
import { requireShopSurface } from "@/features/session";
import { publicStaffProfileSchema } from "@/lib/public-staff-profile";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { storeStaffProfileImage } from "@/lib/storage";

export async function saveStaffProfileAction(shopSlug: string, form: FormData) {
  const { session, db } = await requireShopSurface(shopSlug);
  const shopId = session.user.shopId;
  const personId = session.user.personId;
  const path = shopPath(shopSlug, "me", "security");
  const refuse = () => redirect(noticeUrl(path, "invalid"));
  if (form.get("personId") !== personId) return refuse();
  const own = await ownStaffProfile(db, shopId, personId);
  if (!own) return refuse();
  const enabled = form.get("profileEnabled") === "on";
  const removed = new Set(form.getAll("removeProfilePhoto").map(String));
  // Only URLs already owned by this record can survive. There is no pasted URL field.
  const kept = enabled ? (own.profile?.photoUrls ?? []).filter((url) => !removed.has(url)) : [];
  const files = enabled
    ? form
        .getAll("profilePhotos")
        .filter((value): value is File => value instanceof File && value.size > 0)
    : [];
  if (files.length > 2 || files.length + kept.length > 4) return refuse();
  const parsed = publicStaffProfileSchema.safeParse({
    firstName: form.get("profileFirstName"),
    role: form.get("profileRole"),
    sinceYear: form.get("profileSinceYear") ? Number(form.get("profileSinceYear")) : null,
    languages: form.get("profileLanguages"),
    description: form.get("profileDescription"),
    photoUrls: kept,
  });
  if (enabled && !parsed.success) return refuse();
  const added: string[] = [];
  const clean = async () => {
    for (const url of added)
      await queueAndAttemptMediaDeletion(db, { shopId, personId, kind: "staff_profile", url });
  };
  for (const file of files) {
    const stored = await storeStaffProfileImage({
      filename: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer(),
    });
    if (stored.status !== "stored") {
      await clean();
      return refuse();
    }
    added.push(stored.url);
  }
  let saved: boolean;
  try {
    saved = await writeOwnStaffProfile(db, {
      shopId,
      personId,
      actorPersonId: personId,
      enabled,
      expected: own.profile,
      profile:
        enabled && parsed.success ? { ...parsed.data, photoUrls: [...kept, ...added] } : null,
    });
  } catch (error) {
    await clean();
    throw error;
  }
  if (!saved) {
    await clean();
    return refuse();
  }
  // Invalidate every buying surface, including course and trip pages, after withdrawal.
  revalidatePath(`/s/${shopSlug}`, "layout");
  revalidatePath(path);
  redirect(noticeUrl(path, enabled ? "staff-profile-saved" : "staff-profile-withdrawn"));
}
