"use server";

import { revalidatePath } from "next/cache";
import { changePrivatePersonPhoto } from "@/features/people/person-photo";
import { MAX_IMAGE_BYTES } from "@/lib/storage";
import { contextFor } from "./action-helpers";

export type OwnPhotoState = { outcome: "saved" | "invalid" | "failed" | "rate_limited" | null };

/** The capability is rechecked under the photo service's transaction, not trusted from this render. */
export async function saveOwnPhotoAction(
  token: string,
  _previous: OwnPhotoState,
  formData: FormData,
): Promise<OwnPhotoState> {
  const context = await contextFor(token);
  if (!context.ok) return { outcome: context.reason };
  if (!context.delivered || context.data.identityHeld) return { outcome: "invalid" };

  const remove = formData.get("remove") === "1";
  const selected = formData.get("photo");
  if (
    !remove &&
    (!(selected instanceof File) || selected.size === 0 || selected.size > MAX_IMAGE_BYTES)
  ) {
    return { outcome: "invalid" };
  }
  try {
    const file =
      !remove && selected instanceof File
        ? {
            filename: selected.name,
            contentType: selected.type,
            bytes: await selected.arrayBuffer(),
          }
        : null;
    const outcome = await changePrivatePersonPhoto(context.db, {
      actor: { kind: "readiness", token },
      file,
    });
    if (outcome === "saved") revalidatePath(`/ready/${token}`);
    return { outcome };
  } catch {
    return { outcome: "failed" };
  }
}
