/** inbound-email public contract. Internals are imported only within this module. */
export type { ParsedInboundEmail } from "./rules";
export {
  htmlToText,
  MAX_INBOUND_MESSAGE_BYTES,
  parseInboundEmail,
  stripQuotedReply,
} from "./rules";
