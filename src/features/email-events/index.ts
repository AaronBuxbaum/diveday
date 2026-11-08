/** email-events public contract. */

export type { SesInboundNotification } from "./inbound";
export { parseSesInboundNotification } from "./inbound";
export type {
  SesBookkeeperOutcome,
  SesBounceReport,
  SesEmailEvent,
  SesEventData,
} from "./rules";
export {
  parseSesEventData,
  sesBookkeeperOutcomesFromData,
  sesBounceReportsFromData,
  sesEmailEventFromData,
  smtpStatusOf,
} from "./rules";
