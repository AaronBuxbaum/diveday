/**
 * how-it-went — the owner's short account of one departure (glossary, "How
 * it went"): `rules.ts` composes it from recorded facts, `store.ts` reads them.
 */
export {
  type HowItWent,
  type HowItWentCount,
  type HowItWentFix,
  type HowItWentFixKind,
  howItWent,
} from "./rules";
export { getHowItWentPage, type HowItWentMeta } from "./store";
