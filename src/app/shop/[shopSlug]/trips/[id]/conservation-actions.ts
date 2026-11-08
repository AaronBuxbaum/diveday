"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type ConservationResult, recordTripConservation } from "@/features/conservation";
import { requireStaffSession } from "@/features/session";
import { shopPath } from "@/lib/staff-notices";

export type ConservationActionResult = ConservationResult & {
  targetId?: string;
  undo?: { id: string; revision: number };
};

export async function recordConservationAction(
  tripId: string,
  _previous: ConservationActionResult | null,
  form: FormData,
): Promise<ConservationActionResult> {
  const session = await requireStaffSession();
  const id = form.get("id");
  const operation = form.get("operation") ?? "record";
  const revision = form.get("revision");
  if (
    !z.uuid().safeParse(tripId).success ||
    (id && !z.uuid().safeParse(id).success) ||
    (operation !== "record" && operation !== "delete" && operation !== "restore") ||
    (id && !z.coerce.number().int().positive().safeParse(revision).success)
  )
    return { ok: false, reason: "invalid", targetId: typeof id === "string" ? id : undefined };
  const result = await recordTripConservation(await getDb(), {
    shopId: session.user.shopId,
    personId: session.user.personId,
    tripId,
    operation,
    id: typeof id === "string" ? id : undefined,
    revision: id ? Number(revision) : undefined,
    fact: Object.fromEntries(
      ["kind", "quantity", "location", "note"].map((key) => [key, form.get(key)]),
    ),
  });
  if (result.ok) {
    revalidatePath(shopPath(session.user.shopSlug, "trips", tripId));
    revalidatePath("/ready/[token]", "page");
    revalidatePath("/recap/[token]", "page");
  }
  return {
    ...result,
    targetId: typeof id === "string" ? id : undefined,
    ...(result.ok && operation === "delete" && typeof id === "string"
      ? { undo: { id, revision: Number(revision) + 1 } }
      : {}),
  };
}
