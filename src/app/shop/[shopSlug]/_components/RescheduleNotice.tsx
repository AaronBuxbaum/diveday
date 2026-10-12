import { z } from "zod";
import { getDb } from "@/db/client";
import { pendingHeldSend } from "@/db/held-sends";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowMs } from "@/lib/clock";
import { RescheduleHold } from "./RescheduleHold";
import { rescheduleHoldCopy } from "./reschedule-hold-copy";

/**
 * The reschedule notice a move just held (ux review 2026-10-11, item 1), read
 * back from the `?held=` the move redirected with. Only a hold that is still
 * this shop's, still a reschedule notice and, on a trip page, for this trip
 * draws anything: an id from somebody else's link, or one that already left,
 * renders nothing.
 */
export async function RescheduleNotice({
  shopId,
  heldId,
  tell,
  tripId,
  t,
}: {
  shopId: string;
  heldId: string | undefined;
  tell: string | undefined;
  /** On a trip page, the trip the hold must be for. */
  tripId?: string;
  t: StaffTranslator;
}) {
  const id = z.uuid().safeParse(heldId);
  const count = z.coerce.number().int().min(1).max(500).safeParse(tell);
  if (!id.success || !count.success) return null;
  const row = await pendingHeldSend(await getDb(), shopId, id.data);
  if (row?.payload.kind !== "trip_rescheduled") return null;
  if (tripId && row.payload.tripId !== tripId) return null;
  return (
    <RescheduleHold
      ticket={{
        id: row.id,
        runAt: row.runAt.getTime(),
        holdMs: Math.max(0, row.runAt.getTime() - nowMs()),
      }}
      tripId={row.payload.tripId}
      previousStartsAt={row.payload.previousStartsAt}
      meetingPointMoved={row.payload.meetingPointMoved}
      copy={rescheduleHoldCopy(t, count.data)}
    />
  );
}
