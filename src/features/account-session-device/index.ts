/** account-session-device public contract. Internals are imported only within this module. */
export type { SessionBrowser, SessionDeviceLabel, SessionOs } from "./rules";
export { isCurrentAccountSession, sessionDeviceLabel, sessionUserAgentDetails } from "./rules";
