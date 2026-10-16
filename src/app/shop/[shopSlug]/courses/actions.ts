"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { invitedWithinCooldown } from "@/db/invite-suggestions";
import {
  createDirectTripInvitation,
  deliverTripInvitation,
  listTripInvitations,
} from "@/db/trip-invitations";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const inviteSchema = z.object({ personId: z.uuid(), tripId: z.uuid() });

/**
 * **Invite one diver from the course ladder to the next course's session**
 * (fifth-loop ideas, item 45; H-130): one at a time, staff-chosen, for a named
 * session, and refused for anyone contacted with an invite inside the 30-day
 * cooldown. The same cold invitation a departure's "Invite" sends, so it
 * carries the courtesy unsubscribe and skips a diver who turned optional mail
 * off.
 */
export async function inviteToCourseSessionAction(shopSlug: string, formData: FormData) {
  const { session } = await requireShopSurface(shopSlug);
  const back = shopPath(shopSlug, "courses");
  const parsed = inviteSchema.safeParse({
    personId: formData.get("personId"),
    tripId: formData.get("tripId"),
  });
  if (!parsed.success) redirect(noticeUrl(back, "invite-failed"));
  const { personId, tripId } = parsed.data;
  const shopId = session.user.shopId;
  const db = await getDb();
  if (await invitedWithinCooldown(db, shopId, personId, nowDate())) {
    redirect(noticeUrl(back, "invite-cooldown"));
  }
  const created = await createDirectTripInvitation(db, {
    shopId,
    tripId,
    personId,
    createdByPersonId: session.user.personId,
  });
  const invitation = created
    ? (await listTripInvitations(db, shopId, tripId)).find(
        ({ invitation }) => invitation.source === "direct" && invitation.personId === personId,
      )
    : undefined;
  const delivery = invitation
    ? await deliverTripInvitation(db, {
        shopId,
        shopSlug,
        tripId,
        invitationId: invitation.invitation.id,
      })
    : null;
  revalidatePath(back);
  redirect(
    noticeUrl(
      back,
      delivery === "sent"
        ? "invite-sent"
        : delivery === "opted_out"
          ? "invite-opted-out"
          : "invite-failed",
    ),
  );
}
