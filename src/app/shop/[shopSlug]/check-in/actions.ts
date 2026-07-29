"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkInBooking } from "@/db/check-in";
import { getDb } from "@/db/client";
import { requireStaffSession } from "@/lib/session";

export async function checkInAction(shopSlug: string, formData: FormData) {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = `/shop/${shopSlug}/check-in`;
  if (!bookingId) redirect(`${back}?notice=invalid`);

  const outcome = await checkInBooking(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    recordedByPersonId: session.user.personId,
  });
  revalidatePath(back);
  if (outcome.ok) {
    redirect(`${back}?notice=${outcome.duplicate ? "already_checked_in" : "checked_in"}`);
  }
  redirect(`${back}?notice=${outcome.reason}`);
}
