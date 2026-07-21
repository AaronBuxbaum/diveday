/**
 * Shapes for the one-tap waiver send, kept out of the `"use server"` action
 * file on purpose: a `"use server"` module may only export async functions, so
 * every other export there becomes a server-action reference at build time.
 * The client's initial `useActionState` value and its types must be real values
 * a client component can import, which is why they live here.
 */

/** Where the send happened, so the right route is revalidated after it lands. */
export type WaiverSendSurface = "today" | "blockers";

/** A private fallback link staff must hand over when email did not go out. */
export type WaiverFallbackLink = { name: string; token: string };

export type WaiverSendState = {
  status: "idle" | "done";
  /** Divers the email actually reached. */
  sent: string[];
  /** Divers with no email / no delivery configured — link shown to copy. */
  links: WaiverFallbackLink[];
  /** Divers who already have a signed waiver; nothing was reissued. */
  alreadyDone: string[];
  /** Divers whose send failed outright (no current booking/template). */
  errors: string[];
};

export const IDLE_WAIVER_SEND_STATE: WaiverSendState = {
  status: "idle",
  sent: [],
  links: [],
  alreadyDone: [],
  errors: [],
};
