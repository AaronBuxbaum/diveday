import { z } from "zod";
import { getDb } from "@/db/client";
import { pendingHeldSend } from "@/db/held-sends";
import { heldRescheduleIsPlaceOnly } from "@/db/trip-rescheduled";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowMs } from "@/lib/clock";
import { RescheduleHold, type RescheduleNoticeSnapshot } from "./RescheduleHold";
import { rescheduleHoldCopy } from "./reschedule-hold-copy";

/**
 * The reschedule notice a move just held (ux review 2026-10-11, item 1), read
 * back from the `?held=` the move redirected with. Only a hold that is still
 * this shop's, still a reschedule notice and, on a trip page, for this trip
 * populates the initial client snapshot. A fresh absent/foreign hold renders
 * nothing; the same mounted identity survives Undo's row-absent refresh.
 */
export type RescheduleNoticeProps = {
  shopId: string;
  heldId: string | undefined;
  tell: string | undefined;
  /** On a trip page, the trip the hold must be for. */
  tripId?: string;
  t: StaffTranslator;
};

/** Read the one pending row that can authorize a visible reschedule action. */
export async function resolveRescheduleNoticeSnapshot({
  shopId,
  heldId,
  tell,
  tripId,
  t,
}: RescheduleNoticeProps): Promise<RescheduleNoticeSnapshot | null> {
  const id = z.uuid().safeParse(heldId);
  const count = z.coerce.number().int().min(1).max(500).safeParse(tell);
  if (!id.success || !count.success) return null;
  const db = await getDb();
  const row = await pendingHeldSend(db, shopId, id.data);
  if (row?.payload.kind === "trip_rescheduled" && (!tripId || row.payload.tripId === tripId)) {
    const placeOnly = await heldRescheduleIsPlaceOnly(db, shopId, row.payload);
    return {
      ticket: {
        id: row.id,
        runAt: row.runAt.getTime(),
        holdMs: Math.max(0, row.runAt.getTime() - nowMs()),
      },
      tripId: row.payload.tripId,
      copy: rescheduleHoldCopy(t, placeOnly),
    };
  }
  return null;
}

export async function RescheduleNotice(props: RescheduleNoticeProps) {
  const initialNotice = await resolveRescheduleNoticeSnapshot(props);
  return (
    <RescheduleHold
      key={JSON.stringify([props.shopId, props.heldId, props.tripId ?? null])}
      initialNotice={initialNotice}
    />
  );
}
