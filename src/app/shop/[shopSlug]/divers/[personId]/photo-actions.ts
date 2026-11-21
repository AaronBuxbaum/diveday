"use server";

import { revalidatePath } from "next/cache";
import { changePrivatePersonPhoto } from "@/features/people/person-photo";
import { requireDiverActionContext } from "./action-helpers";

/** Live staff may add, replace, or remove a diver's portrait. */
export async function savePersonPhotoAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "invalid");
  const { db, staff } = context;
  const remove = formData.get("remove") === "1";
  const file = formData.get("photo");
  if (!remove && (!(file instanceof File) || file.size === 0)) {
    return false;
  }
  const result = await changePrivatePersonPhoto(db, {
    actor: {
      kind: "staff",
      shopId: staff.user.shopId,
      personId: context.personId,
      staffPersonId: staff.user.personId,
    },
    file:
      !remove && file instanceof File
        ? { filename: file.name, contentType: file.type, bytes: await file.arrayBuffer() }
        : null,
  });
  if (result !== "saved") {
    return false;
  }
  revalidatePath(`/shop/${shopSlug}`, "layout");
  return true;
}
