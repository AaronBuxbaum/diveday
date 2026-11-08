"use server";

import QRCode from "qrcode";
import { issueCounterCourseForms } from "@/features/course-counter-qr";
import { requireShopSurface } from "@/features/session";
import { courseFormsLinkPath } from "@/lib/booking-capabilities";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { uuidParam } from "@/lib/uuid";

/** One forms-only capability, encoded locally; the raw URL never becomes UI copy. */
export async function issueCourseFormQrAction(
  shopSlug: string,
  tripId: string,
  bookingId: string,
): Promise<{ ok: true; qr: string } | { ok: false }> {
  const { db, shop } = await requireShopSurface(shopSlug);
  const origin = publicAppUrl();
  if (!origin || !uuidParam(tripId) || !uuidParam(bookingId)) return { ok: false };
  const issued = await issueCounterCourseForms(db, { shopId: shop.id, tripId, bookingId });
  if (!issued) return { ok: false };
  const url = new URL(courseFormsLinkPath(issued.token), `${origin}/`).toString();
  return { ok: true, qr: await QRCode.toDataURL(url, { margin: 4, width: 256 }) };
}
