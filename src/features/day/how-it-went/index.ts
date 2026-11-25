/**
 * how-it-went — the owner's short account of one departure (glossary, "How
 * it went"): `rules.ts` composes it from recorded facts, `store.ts` reads them,
 * `email.ts` tells the owners once the recap is due.
 */

export {
  HOW_IT_WENT_LOOKBACK_MS,
  type HowItWentEmailSummary,
  howItWentEmailWanted,
  readHowItWentEmailChoice,
  sendDueHowItWentEmails,
  setHowItWentEmailChoice,
} from "./email";
export {
  type HowItWent,
  type HowItWentCount,
  type HowItWentFix,
  type HowItWentFixKind,
  howItWent,
} from "./rules";
export { getHowItWentPage, type HowItWentMeta } from "./store";
