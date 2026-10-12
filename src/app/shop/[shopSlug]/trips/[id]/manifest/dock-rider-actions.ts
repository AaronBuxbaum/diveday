"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addDockRider, type DockRiderOwes, type DockRiderRefusal } from "@/db/dock-rider";
import { getShopById } from "@/db/shops";
import { diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * The Boat tab's "Add a rider" (batch 4, D6). Its own file so the manifest's
 * shared actions stay as they are; the whole consequence path is
 * `addDockRider` (`src/db/dock-rider.ts`). The shop comes off the session,
 * never the form, and so does the slug the paths are revalidated under.
 */

export type DockRiderState =
  | { status: "added"; bookingId: string; name: string; owes: DockRiderOwes[]; waiverPath?: string }
  | { status: "refused"; reason: DockRiderRefusal | "invalid" };

const dockRiderSchema = z.object({
  fullName: diverNameSchema,
  phone: diverPhoneSchema.optional(),
  emergencyContactName: diverNameSchema,
  emergencyContactPhone: diverPhoneSchema.min(1),
  dateOfBirth: z.string().trim().max(10).optional(),
  participantType: z.enum(["rider", "snorkeler"]),
});

export async function addDockRiderAction(
  tripId: string,
  _previous: DockRiderState | undefined,
  formData: FormData,
): Promise<DockRiderState> {
  const session = await requireStaffSession();
  if (!z.uuid().safeParse(tripId).success) return { status: "refused", reason: "invalid" };
  const parsed = dockRiderSchema.safeParse({
    fullName: formData.get("fullName") ?? "",
    phone: formData.get("phone") || undefined,
    emergencyContactName: formData.get("emergencyContactName") ?? "",
    emergencyContactPhone: formData.get("emergencyContactPhone") ?? "",
    dateOfBirth: formData.get("dateOfBirth") || undefined,
    participantType: formData.get("participantType") ?? "rider",
  });
  if (!parsed.success) return { status: "refused", reason: "invalid" };
  const db = await getDb();
  const result = await addDockRider(db, {
    shopId: session.user.shopId,
    tripId,
    actorPersonId: session.user.personId,
    ...parsed.data,
  });
  if (!result.ok) return { status: "refused", reason: result.reason };
  const shop = await getShopById(db, session.user.shopId);
  if (shop) {
    revalidatePath(shopPath(shop.slug, "trips", tripId, "manifest"));
    revalidatePath(shopPath(shop.slug, "trips", tripId));
  }
  return {
    status: "added",
    bookingId: result.bookingId,
    name: parsed.data.fullName,
    owes: result.owes,
    waiverPath: result.waiverPath,
  };
}
