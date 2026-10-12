"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addDockRider, type DockRiderRefusal } from "@/db/dock-rider";
import { diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * The Boat tab's "Add a rider" (batch 4, D6). Its own file so the manifest's
 * shared actions stay as they are; the whole consequence path is
 * `addDockRider` (`src/db/dock-rider.ts`), and the shop comes off the session,
 * never the form.
 */

export type DockRiderState =
  | { status: "added"; name: string }
  | { status: "refused"; reason: DockRiderRefusal | "invalid" };

const dockRiderSchema = z.object({
  fullName: diverNameSchema,
  phone: diverPhoneSchema.optional(),
  emergencyContactName: diverNameSchema,
  emergencyContactPhone: diverPhoneSchema.min(1),
});

export async function addDockRiderAction(
  ctx: { shopSlug: string; tripId: string },
  _previous: DockRiderState | undefined,
  formData: FormData,
): Promise<DockRiderState> {
  const session = await requireStaffSession();
  if (!z.uuid().safeParse(ctx.tripId).success) return { status: "refused", reason: "invalid" };
  const parsed = dockRiderSchema.safeParse({
    fullName: formData.get("fullName") ?? "",
    phone: formData.get("phone") || undefined,
    emergencyContactName: formData.get("emergencyContactName") ?? "",
    emergencyContactPhone: formData.get("emergencyContactPhone") ?? "",
  });
  if (!parsed.success) return { status: "refused", reason: "invalid" };
  const result = await addDockRider(await getDb(), {
    shopId: session.user.shopId,
    tripId: ctx.tripId,
    actorPersonId: session.user.personId,
    ...parsed.data,
  });
  if (!result.ok) return { status: "refused", reason: result.reason };
  revalidatePath(shopPath(ctx.shopSlug, "trips", ctx.tripId, "manifest"));
  revalidatePath(shopPath(ctx.shopSlug, "trips", ctx.tripId));
  return { status: "added", name: parsed.data.fullName };
}
