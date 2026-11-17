"use server";

import { revalidatePath } from "next/cache";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { setPersonPhoto } from "@/db/people";
import { revalidateAndRedirect } from "@/features/navigation";
import { storePersonPhoto } from "@/lib/storage";
import { backTo, requireDiverActionContext } from "./action-helpers";

/**
 * Put a picture on a diver's record, or take it off. Any live staffer may: the
 * picture is only there to tell people apart on a roster. The new file is
 * stored first and the old one retired after the row points at the new one, so
 * a failure at either step never leaves the record pointing at a missing file.
 */
export async function savePersonPhotoAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "invalid");
  const { base, db, staff } = context;
  const shopId = staff.user.shopId;
  personId = context.personId;
  const remove = formData.get("remove") === "1";
  const file = formData.get("photo");
  let photoPath: string | null = null;
  if (!remove) {
    if (!(file instanceof File) || file.size === 0) {
      revalidateAndRedirect(base, backTo(base, "invalid"));
      return;
    }
    const stored = await storePersonPhoto({
      filename: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer(),
    });
    if (stored.status !== "stored") {
      revalidateAndRedirect(base, backTo(base, "invalid"));
      return;
    }
    photoPath = stored.url;
  }
  const changed = await setPersonPhoto(db, { shopId, personId, photoPath });
  if (!changed) {
    if (photoPath)
      await queueAndAttemptMediaDeletion(db, {
        shopId,
        personId,
        kind: "staff_profile",
        url: photoPath,
      });
    revalidateAndRedirect(base, backTo(base, "invalid"));
    return;
  }
  if (changed.previous)
    await queueAndAttemptMediaDeletion(db, {
      shopId,
      personId,
      kind: "staff_profile",
      url: changed.previous,
    });
  revalidatePath(`/shop/${shopSlug}`, "layout");
}
