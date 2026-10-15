import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { shopCrewTarget } from "@/lib/crew-schedule";
import type { TodayAction } from "@/lib/today";
import { sharedInHorizonReadiness } from "./blockers";
import type { AppDb } from "./client";
import { getTodayWork } from "./today";

/**
 * **What Today's Needs you lists for one departure** (fourth review, item 36).
 *
 * The trip's own band used to count a subset of Today's rows for the boat (the
 * boat's work: sizes, nitrox, contacts, orders) and said "3 things to sort"
 * one tap from a Today listing seven for the same boat: the waiver, the help
 * request, the seats to fill and the say-hello cue were Today's alone. The band
 * now reads Today's own rows, filtered to this departure, so its "Needs you · N"
 * is Today's number by construction rather than by a second derivation that a
 * test then has to keep honest.
 *
 * Read through the readiness pass the staff shell's badge already runs in the
 * same render (`sharedInHorizonReadiness`), with the reader's own roles, so the
 * lens that filters their Today filters this list too. Ops alerts are left
 * out: none of them is about a departure.
 *
 * The trip page starts it beside its own reads and skips it on Details, which
 * shows no band.
 *
 * `null` when the departure is outside Today's window: Today says nothing
 * about that boat, and the band falls back to the boat's work alone
 * (`boatWorkItems`), which a packer and an invoice need however far out it is.
 */
export async function getDepartureNeeds(
  db: AppDb,
  shop: {
    id: string;
    slug: string;
    timezone: string;
    crewScheduleEnabled: boolean;
    diversPerDivemaster: number;
  },
  tripId: string,
  input: {
    now: Date;
    t: StaffTranslator;
    locale: string;
    /** The reader: their roles pick the lens, as on their own Today. */
    session: { user: { roles: readonly Role[] } };
  },
): Promise<TodayAction[] | null> {
  const evidence = await sharedInHorizonReadiness(db, shop.id, input.now);
  if (!evidence.trips.some((trip) => trip.id === tripId)) return null;
  const work = await getTodayWork(
    db,
    shop.id,
    shop.slug,
    shop.timezone,
    input.now,
    undefined,
    input.t,
    input.locale,
    false,
    evidence,
    shopCrewTarget(shop),
    input.session.user.roles,
  );
  return work.actions.filter((action) => action.departure?.tripId === tripId);
}
