import { crewAwayDetailText, openCrewActionText } from "@/i18n/today-labels";
import { type TodayAction, urgencyFor } from "@/lib/today";
import type { TodayRowsContext } from "./today-rows-context";
import { at } from "./today-shared";

/**
 * **Rostered and away** (fourth review, item 12): one `crew_away` row on each
 * departure ahead that somebody on its crew said they are away for, naming
 * them and their days, pointing at the crew editor.
 *
 * Marcus marked himself away for the weekend and stayed rostered on both
 * Sunday sessions; the staffing week said so and nothing else did, so the
 * shop would have found out at the pool. Informs, never gates (ADR
 * 20260902-crew-requests-and-blackouts): nobody is taken off the departure,
 * and the conversation is the shop's to have.
 *
 * Only the queue's own window (`inWindow`, departures still to sail): once a
 * boat has left, who is aboard is the roll call's question, not this row's.
 * A row about one person carries `staffPersonId`, so that person's own Today
 * leads with it under the crew lens.
 */
export function pushCrewAwayRows(actions: TodayAction[], ctx: TodayRowsContext): void {
  const { crewAway } = ctx.wave;
  const { inWindow, shopSlug, timeZone, locale, t, now } = ctx;
  for (const trip of inWindow) {
    const away = crewAway.get(trip.id);
    if (!away || away.length === 0) continue;
    const when = at(trip.startsAt, timeZone, locale);
    actions.push({
      id: `crew-away:${trip.id}`,
      kind: "crew_away",
      urgency: urgencyFor(trip.startsAt, now),
      subject: trip.title,
      context: when,
      departure: { tripId: trip.id, label: `${trip.title} · ${when}` },
      aboutDeparture: true,
      detail: crewAwayDetailText(t, locale, away),
      actionLabel: openCrewActionText(t),
      href: `/shop/${shopSlug}/trips/${trip.id}?view=details#crew`,
      ...(away.length === 1 && away[0] ? { staffPersonId: away[0].personId } : {}),
      dueAt: trip.startsAt,
    });
  }
}
