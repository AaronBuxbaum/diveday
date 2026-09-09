/**
 * What the kiosk's one action answers with, and every word it renders.
 *
 * Kept out of the `"use server"` module beside it — such a module may only
 * export async functions — and out of the client component, which must not
 * reach into `src/i18n` for a bundle (the diver bundle would then ship to the
 * page in full). Words are resolved on the server and cross as data, the same
 * shape `InquiryFormState` uses.
 *
 * **Two outcomes reach the screen and no more.** `ready` names the one diver
 * the answer is about; `desk` says nothing at all. Everything else the server
 * can distinguish — nobody by that name, several people by that name, a
 * cancelled seat, a blocker on the booking — collapses into `desk`, because the
 * tablet is operated by whoever walks up to it and a refusal that varied would
 * answer questions about a stranger's booking to anyone willing to type.
 */
export type KioskResult =
  | { status: "idle" }
  | {
      status: "ready";
      /** "You're set, Adaeze." — the one diver this answer is about. */
      heading: string;
      /** The departure, then where to meet. Already formatted in the shop's zone. */
      lines: string[];
    }
  | { status: "desk"; heading: string; body: string };

export const IDLE_KIOSK_RESULT: KioskResult = { status: "idle" };

/** Every word the console renders, resolved on the server and handed down. */
export type KioskCopy = {
  title: string;
  prompt: string;
  submit: string;
  submitting: string;
};
