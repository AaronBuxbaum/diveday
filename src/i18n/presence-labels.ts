import type { PresenceState } from "@/lib/presence";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * **One word per presence state** (issue #2704). The desk's pill, the
 * manifest's pill and the roster's pill all said "Checked in" through three
 * keys of their own; a surface that draws a person on a departure now picks a
 * state from here instead of spelling the word. Presence is read through this
 * map and never written through it: the desk and the rail keep separate
 * controls (ADR 20260907).
 *
 * A state gets its entry with the first surface that moves onto it.
 */
export const PRESENCE_LABEL_KEYS = {
  arrived: "shared.presence.arrived",
} as const satisfies Partial<Record<PresenceState, StaffMessageKey>>;

/** The word a presence state goes by in the staff bundle's language. */
export function presenceText(t: StaffTranslator, state: keyof typeof PRESENCE_LABEL_KEYS): string {
  return t(PRESENCE_LABEL_KEYS[state]);
}
