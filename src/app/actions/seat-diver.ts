"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { type SeatDiverPerson, seatDiver } from "@/db/seat-diver";
import { revalidateAndRedirect } from "@/lib/navigation";
import { blankableDiverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { requireStaffSession } from "@/lib/session";
import type { TripAdmissionRefusal } from "@/lib/trip-admission";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import {
  SEAT_SURFACES,
  type SeatLanding,
  type SeatSurface,
  type SeatSurfaceId,
} from "./seat-diver-surfaces";

/**
 * The two staff seat-a-diver submissions — pick a returning diver, or type a
 * new one — as one implementation each, shared by every door.
 *
 * Shared rather than per-page because they were already the same code four
 * times over and had drifted apart in the copying (see `src/db/seat-diver.ts`).
 * `src/app/actions/` is exactly the home AGENTS.md reserves for an action used
 * across pages. What a door still chooses is its `SeatSurfaceId`, bound
 * server-side; everything that follows from it is table-driven
 * (`./seat-diver-surfaces.ts`).
 *
 * Both read `tripId` from the form, so a trip-first surface (the counter
 * walk-in, the global door) and a trip-already-known one (the Guests tab,
 * a diver's record) submit the same shape.
 */

const existingDiverSchema = z.object({ tripId: z.uuid(), personId: z.uuid() });

/**
 * Email optional here and required by refinement per surface, rather than two
 * schemas: `""` is what an untouched optional input actually submits, and the
 * required surfaces need that to read as "missing", not as an invalid address.
 */
const newDiverSchema = z.object({
  tripId: z.uuid(),
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: diverNameSchema,
  email: blankableDiverEmailSchema.optional(),
  phone: diverPhoneSchema.optional(),
});

function surfaceFor(surfaceId: SeatSurfaceId): SeatSurface {
  // The id arrives as an encrypted bound argument, so it cannot be forged from
  // the client — checked anyway, because a bad lookup here would build a
  // redirect path out of `undefined`.
  if (!Object.hasOwn(SEAT_SURFACES, surfaceId)) throw new Error("unknown seat surface");
  return SEAT_SURFACES[surfaceId];
}

/** Appends a `?notice=` (or `&notice=`) without clobbering a path's own query. */
function withNotice(path: string, notice: string, bookingId?: string): string {
  const separator = path.includes("?") ? "&" : "?";
  const suffix = bookingId ? `&bid=${bookingId}` : "";
  return `${path}${separator}notice=${notice}${suffix}`;
}

/**
 * Land back on the door that submitted, saying why nothing happened.
 *
 * Revalidated even though a refused seating wrote nothing: a refusal means the
 * door was working from stale facts — `trip_full` is precisely "the seats you
 * were shown are gone" — so the page it lands back on must be re-read rather
 * than served from the cache that misled the staffer.
 *
 * A refusal must also land on a URL that differs from the current one by more
 * than an appended query param; see `SEAT_SURFACES["new-booking"]` for what
 * happens when it doesn't. Revalidating does not rescue that case — the trip
 * moving into the path is what does.
 */
function refuse(
  surface: SeatSurface,
  landing: SeatLanding,
  notice: string,
  /**
   * The `trip_prerequisite` refusal's structured detail, flattened into the one
   * `gate=` param. Codes only, and only on a staff URL — the banner turns it
   * into the sentence that says *which* requirement failed and what the diver
   * holds, instead of the one static line that used to point every refusal at
   * the certifications form.
   *
   * **Signed, and bound to the landing route's own id**
   * (`signTripAdmissionGate`). Unsigned, the param was an instruction anyone
   * could write: a hand-made link rendered a specific, fabricated refusal, and
   * the specific ones are exactly what send a staffer to the certifications
   * form (security review finding).
   */
  gate?: TripAdmissionRefusal,
): never {
  const back = surface.refusedPath(landing);
  const scope = gate ? surface.gateScope(landing) : null;
  const detail =
    gate && scope ? `&gate=${encodeURIComponent(signTripAdmissionGate(gate, scope))}` : "";
  return revalidateAndRedirect(back, `${withNotice(back, notice)}${detail}`);
}

/** Everything after "who and which trip" — identical for every door. */
async function seat(
  surface: SeatSurface,
  landing: SeatLanding,
  diver: SeatDiverPerson,
  actor: { shopId: string; personId: string },
): Promise<void> {
  const result = await seatDiver(await getDb(), {
    shopId: actor.shopId,
    tripId: landing.tripId,
    actorPersonId: actor.personId,
    diver,
    entry: surface.entry,
    refusals: surface.refusals,
  });
  if (!result.ok) refuse(surface, landing, surface.refusalNotice[result.reason], result.refusal);
  const settled: SeatLanding = { ...landing, personId: result.personId };
  const path = surface.seatedPath(settled);
  // The seat happened either way; what differs is whether the staffer can walk
  // away. A waiver that was issued but never mailed — no address on file, no
  // provider, a bounced test recipient — leaves work at the desk, so the notice
  // says so instead of letting "Added…" imply an email is on its way while the
  // diver's readiness waits for a signature nobody asked for. The link itself
  // stays off the URL and on the diver's row (`seatedWaiverUndeliveredNotice`).
  const notice =
    result.waiver === "not_delivered" || result.waiver === "failed"
      ? surface.seatedWaiverUndeliveredNotice
      : surface.seatedNotice;
  revalidateAndRedirect(
    path,
    withNotice(path, notice, surface.carriesBookingId ? result.bookingId : undefined),
  );
}

/**
 * Seat a diver already on file — the "enter once, reuse everywhere" path. No
 * name or email is re-typed: the existing person row carries their certs,
 * waivers, rental fit, and history straight onto the trip.
 */
export async function seatExistingDiverAction(
  surfaceId: SeatSurfaceId,
  shopSlug: string,
  formData: FormData,
) {
  const surface = surfaceFor(surfaceId);
  const session = await requireStaffSession();
  const parsed = existingDiverSchema.safeParse({
    tripId: formData.get("tripId"),
    personId: formData.get("personId"),
  });
  // A landing built from the raw fields: the staffer must get back to the page
  // they submitted from even when what they submitted was unusable.
  const landing: SeatLanding = {
    shopSlug,
    tripId: parsed.success ? parsed.data.tripId : String(formData.get("tripId") ?? ""),
    personId: parsed.success ? parsed.data.personId : String(formData.get("personId") ?? ""),
  };
  if (!parsed.success) refuse(surface, landing, surface.invalidNotice);
  await seat(
    surface,
    landing,
    { personId: parsed.data.personId },
    { shopId: session.user.shopId, personId: session.user.personId },
  );
}

/**
 * Seat a diver typed in by hand — a genuine first-timer, or someone tracked in
 * another system. Whether an email is required is the surface's call: the
 * counter can add a diver on a name alone and collect the rest later.
 */
export async function seatNewDiverAction(
  surfaceId: SeatSurfaceId,
  shopSlug: string,
  formData: FormData,
) {
  const surface = surfaceFor(surfaceId);
  const session = await requireStaffSession();
  const parsed = newDiverSchema.safeParse({
    tripId: formData.get("tripId"),
    fullName: formData.get("fullName"),
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
  });
  const email = parsed.success ? parsed.data.email || undefined : undefined;
  const landing: SeatLanding = {
    shopSlug,
    tripId: parsed.success ? parsed.data.tripId : String(formData.get("tripId") ?? ""),
    personId: "",
  };
  if (!parsed.success || (surface.email === "required" && !email)) {
    refuse(surface, landing, surface.invalidNotice);
  }
  await seat(
    surface,
    landing,
    { fullName: parsed.data.fullName, email, phone: parsed.data.phone },
    { shopId: session.user.shopId, personId: session.user.personId },
  );
}
