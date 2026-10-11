/**
 * Gear: what every gear module shares — the live-rows filters for units and
 * reservations, the holder of a reservation, and the drift checks between the
 * lib unions and the pg enums. Imported by the `gear-*` siblings only.
 */
import { and, isNull, sql } from "drizzle-orm";
import {
  GEAR_KIND_ORDER,
  GEAR_SERVICE_KINDS,
  type GearItemKind,
  type GearServiceKind,
} from "@/lib/gear";
import { bookings, gearItemKind, gearItems, gearReservations, gearServiceKind } from "./schema";

// The lib unions and the pg enums must never drift: both directions are
// compile errors here — a value added to one side without the other fails
// the build, not a migration at 2am.
gearItemKind.enumValues satisfies readonly GearItemKind[];
GEAR_KIND_ORDER satisfies readonly (typeof gearItemKind.enumValues)[number][];
gearServiceKind.enumValues satisfies readonly GearServiceKind[];
GEAR_SERVICE_KINDS satisfies readonly (typeof gearServiceKind.enumValues)[number][];

export function optional(value: string | undefined) {
  return value?.trim() || null;
}

/**
 * The register's own live-rows filter (ADR 20260820-every-delete-is-soft).
 * Every read that means "the fleet" carries it; the three that deliberately do
 * not are the deleted-units list this page offers Restore from, one unit's own
 * record (`getGearItemDetail`, which reports the state instead of hiding the
 * row), and the export bundle, where a shop takes everything it owns,
 * tombstones included.
 */
export const liveGearItem = () => isNull(gearItems.deletedAt);

/**
 * **A hold still standing**: neither home (`returned_at`) nor let go
 * (`released_at`, issue #2258). Releasing stamps the row instead of deleting
 * it (ADR 20260820-every-delete-is-soft), so every read and write that means
 * "the open reservations" carries this, exactly the WHERE of the
 * `gear_reservations_no_overlap` exclusion constraint. A reader of returned
 * rows (`returned_at is not null`) already skips a released one, which the
 * `gear_reservations_release_never_left` check keeps unreturned.
 */
export const openGearReservation = () =>
  and(isNull(gearReservations.returnedAt), isNull(gearReservations.releasedAt));

/**
 * Who holds a reservation, as one person id for either holder shape (the
 * `gear_reservations_one_holder` check): the booking's diver for a seat, the
 * row's own `person_id` for a counter rental. A reader that answers "what's
 * out, who has it" joins `people` on this, with `bookings` left-joined, so a
 * counter rental is never invisible. Trip-scoped reads stay booking-only.
 */
export const reservationHolder = () =>
  sql<string>`coalesce(${bookings.personId}, ${gearReservations.personId})`;
