"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CARD_KINDS, setCardProcessed } from "@/db/agency-processing";
import { getDb } from "@/db/client";
import { ladderInviteRefusal } from "@/db/course-ladder";
import { deliverSeatOffer } from "@/db/interest-offers";
import { createInvitationUnderCooldown } from "@/db/invite-suggestions";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const inviteSchema = z.object({ personId: z.uuid(), tripId: z.uuid() });

/**
 * **Invite one diver from the course ladder to the next course's session**
 * (fifth-loop ideas, item 45; H-20261014-one-to-one-invite): one at a time, staff-chosen, for a named
 * session. The posted ids are re-checked rather than trusted (security review
 * N3, dive-domain review F3): the trip must be a live session of a course,
 * the person must not hold its card already or be under its minimum age, and,
 * under the cooldown's lock, the session must still be public, scheduled,
 * with a seat and open to this diver, and nobody may have had an invite in
 * the last 30 days. The same cold invitation a departure's "Invite" sends, so
 * it carries the courtesy unsubscribe and skips a diver who turned optional
 * mail off.
 */
export async function inviteToCourseSessionAction(shopSlug: string, formData: FormData) {
  const { session, shop } = await requireShopSurface(shopSlug);
  const back = shopPath(shopSlug, "courses");
  const parsed = inviteSchema.safeParse({
    personId: formData.get("personId"),
    tripId: formData.get("tripId"),
  });
  if (!parsed.success) redirect(noticeUrl(back, "invite-failed"));
  const { personId, tripId } = parsed.data;
  const shopId = session.user.shopId;
  const db = await getDb();
  const refusal = await ladderInviteRefusal(db, {
    shopId,
    personId,
    tripId,
    timeZone: shop.timezone,
  });
  if (refusal) redirect(noticeUrl(back, "invite-unavailable"));
  const outcome = await createInvitationUnderCooldown(db, {
    shopId,
    tripId,
    personId,
    createdByPersonId: session.user.personId,
    now: nowDate(),
  });
  if (outcome.status === "cooldown") redirect(noticeUrl(back, "invite-cooldown"));
  if (outcome.status === "unavailable") redirect(noticeUrl(back, "invite-unavailable"));
  const delivery =
    outcome.status === "created"
      ? await deliverSeatOffer(db, {
          shopId,
          shopSlug,
          tripId,
          interestId: outcome.interestId,
          initiatedBy: "shop",
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

const processedSchema = z.object({ certificationId: z.uuid(), kind: z.enum(CARD_KINDS) });

/**
 * **"Processed" on the course page's list of cards to process** (fifth-loop
 * ideas, item 46): the same stamp as the session roster's tick. Scoped to this
 * shop's own issued cards by the writer.
 */
export async function markCardProcessedFromCoursesAction(shopSlug: string, formData: FormData) {
  const { session } = await requireShopSurface(shopSlug);
  const back = shopPath(shopSlug, "courses");
  const parsed = processedSchema.safeParse({
    certificationId: formData.get("certificationId"),
    kind: formData.get("cardKind"),
  });
  if (!parsed.success) redirect(back);
  const db = await getDb();
  await setCardProcessed(db, {
    shopId: session.user.shopId,
    kind: parsed.data.kind,
    certificationId: parsed.data.certificationId,
    actorPersonId: session.user.personId,
    processed: true,
    now: nowDate(),
  });
  revalidatePath(back);
  redirect(back);
}
