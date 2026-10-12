"use server";

import { z } from "zod";
import type { HeldTicket } from "@/components/SendHold";
import { getDb } from "@/db/client";
import {
  checkDepartureNote,
  type DepartureNoteRefusal,
  departureNoteAudience,
} from "@/db/departure-notes";
import { holdSend } from "@/db/held-sends";
import { nowMs } from "@/lib/clock";
import { requireStaffSession } from "@/lib/session";

/**
 * The trip page's "Note to everyone" (batch 4, J4): the hold half of a held
 * send. Undo and release are the shared `undoHeldSendAction` /
 * `releaseHeldSendAction`, and the send re-runs every check below when the
 * hold drains. The shop comes off the session, never the form; the trip id is
 * bound by the page.
 */

export type HoldDepartureNoteResult =
  | { ok: true; ticket: HeldTicket }
  | { ok: false; reason: DepartureNoteRefusal | "no_recipients" | "invalid" };

export async function holdDepartureNoteAction(
  tripId: string,
  formData: FormData,
): Promise<HoldDepartureNoteResult> {
  const session = await requireStaffSession();
  if (!z.uuid().safeParse(tripId).success) return { ok: false, reason: "invalid" };
  const body = String(formData.get("body") ?? "");
  const db = await getDb();
  const shopId = session.user.shopId;
  const check = await checkDepartureNote(db, { shopId, tripId, body, countHeld: true });
  if (!check.ok) return { ok: false, reason: check.reason };
  if ((await departureNoteAudience(db, shopId, tripId)) === 0) {
    return { ok: false, reason: "no_recipients" };
  }
  const held = await holdSend(db, {
    shopId,
    payload: { kind: "departure_note", tripId, body: check.body },
    actorPersonId: session.user.personId,
  });
  return {
    ok: true,
    ticket: {
      id: held.id,
      runAt: held.runAt.getTime(),
      holdMs: Math.max(0, held.runAt.getTime() - nowMs()),
    },
  };
}
