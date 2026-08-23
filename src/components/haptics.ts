"use client";

/**
 * **The one door to the phone's vibration motor, and the one place that says
 * which phones have one.**
 *
 * `navigator.vibrate` is **not implemented in Safari on iOS, at any version.**
 * So DiveDay's whole haptic layer — the tick when a roll-call tap lands, the
 * triple buzz when one is refused, the pattern as the head count crosses each
 * quarter — is an **Android-only channel**. Both call sites feature-detected
 * correctly and silently did nothing, which is the right code and reads as
 * complete: there was no bug to find, only an absence on a device nobody
 * tested on, and nothing in the repository said so (issue #817).
 *
 * What carries the same job on an iPhone is what carries it for a crew member
 * who has turned haptics off, or who is wearing gloves: the screen. The
 * roll-call row changes state and colour under the thumb that pressed it, a
 * refusal renders `role="alert"` text beside the control, and the completion
 * is `SubSurfaceRipple`. **That is why a refusal must never be carried by the
 * buzz alone** — it is the one haptic with a safety-adjacent job and the one
 * with a silent platform hole. There is no sound anywhere in the app.
 *
 * The preference is per *device*, not per person: a shop's spare deck phone is
 * shared, and this is a property of the phone in a wet pocket rather than of
 * whoever is holding it. `prefers-reduced-motion` deliberately does not reach
 * vibration (it is about animation), so the app's motion kill-switch cannot do
 * this job — see docs/design/accessibility-tradeoffs.md.
 */

export const HAPTICS_STORAGE_KEY = "diveday-haptics";

/** Fired on this tab when the preference changes, so a live control can follow it. */
export const HAPTICS_CHANGE_EVENT = "diveday:haptics-change";

/** Whether this device *can* buzz. False on every iPhone. */
export function hapticsAvailable(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

/**
 * Whether this device *wants* to. Defaults on — a 10 ms tick on a wet deck is
 * the point of the feature — and only an explicit "off" turns it off, so a
 * browser that refuses storage keeps the default rather than losing the
 * channel.
 */
export function hapticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HAPTICS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HAPTICS_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // A device that refuses storage still gets the vibration it has now; the
    // choice simply does not survive the tab.
  }
  window.dispatchEvent(new CustomEvent(HAPTICS_CHANGE_EVENT, { detail: { enabled } }));
}

/**
 * Buzz, if this device can and wants to. Never throws: a haptic is decoration,
 * and a security policy that refuses one must not take a roll-call tap with it.
 */
export function vibrate(pattern: number | number[]): void {
  if (!hapticsAvailable() || !hapticsEnabled()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Refused by policy or by the platform. Nothing here is worth telling
    // anybody: the screen already said what happened.
  }
}
