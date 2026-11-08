import { diverTranslator } from "@/i18n/messages";

// i18n-exempt-file: the terminal renderer for the post-trip recap text, on the
// same footing as `./desk-notes.ts`. `src/features/recap/store.ts` decides who gets it.

/** "Thanks for diving with us — your dive recap:" and the diver's own link. */
export function recapText(locale: string, input: { shopName: string; recapUrl: string }): string {
  return diverTranslator(locale)("notifications.sms.recap", input);
}
