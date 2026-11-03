import Link from "next/link";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { threadWaiverAwaitsPhysician } from "@/db/waivers";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * **What your doctor needs**, back on the thread (issue #2743). A release
 * signed as the Sign step and referred to a physician has its receipt on this
 * link (`/ready/<token>/waiver`), where the physician instructions and the
 * doctor's page are. Drawn only while the Sign step reads `medical_review`,
 * and only when the seat's own release is the one waiting: a hold on a release
 * signed elsewhere has no receipt here to open.
 */
export async function PhysicianDoor({
  token,
  className,
  t,
}: {
  token: string;
  className: string;
  t: DiverTranslator;
}) {
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) return null;
  const waiting = await threadWaiverAwaitsPhysician(db, {
    shopId: capability.shopId,
    bookingId: capability.bookingId,
  });
  if (!waiting) return null;
  return (
    <Link href={`/ready/${token}/waiver`} prefetch={false} className={className}>
      {t("ready.doctorNeeds")}
    </Link>
  );
}
