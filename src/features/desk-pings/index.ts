/** desk-pings public contract. Internals are imported only within this module. */
export type { DeskPingOutcome, StaffLogin } from "./store";
export {
  countWaitingSince,
  pingDeskAfterHours,
  pingDeskAfterHoursSafely,
  readAfterHoursPingChoice,
  sendTrailingDeskPings,
  setAfterHoursPingChoice,
  setShopDeskHours,
  staffLogins,
} from "./store";
