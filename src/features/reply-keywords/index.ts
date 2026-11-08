/** reply-keywords public contract. Internals are imported only within this module. */

export type { ConfirmationCodeSubject, ReplyKeywordIntent, ReplyKeywordParse } from "./rules";
export {
  CONFIRMATION_CODE_LENGTH,
  CONFIRMATION_WINDOW_MS,
  confirmationCode,
  confirmationCodeMatches,
  KEYWORD_MAX_LENGTH,
  normalizeKeywordBody,
  parseReplyKeyword,
} from "./rules";
export type { HandleReplyKeywordInput, ReplyKeywordOutcome } from "./store";
export { handleInboundReplyKeyword } from "./store";
