import { DAY_MS } from "@/lib/clock";

/**
 * **Who to ask when a boat could use divers** (fifth-loop ideas, items 43 to
 * 45; H-20261014-one-to-one-invite).
 *
 * A one-to-one invite to a past diver, sent by staff for a named departure, is
 * service mail the shop may send now, on four conditions: one at a time,
 * staff-chosen, for a named date, and never to the same person twice inside
 * {@link INVITE_COOLDOWN_DAYS}. The lists that suggest whom to ask leave out
 * anyone contacted inside the window, and the send refuses them again, so a
 * stale page cannot slip a second invite through.
 */
export const INVITE_COOLDOWN_DAYS = 30;

/** The instant before which a person's last invite no longer holds them back. */
export function inviteCooldownStart(now: Date): Date {
  return new Date(now.getTime() - INVITE_COOLDOWN_DAYS * DAY_MS);
}

/** How many suggested names a list shows before "and N more". */
export const INVITE_SUGGESTIONS_SHOWN = 6;
