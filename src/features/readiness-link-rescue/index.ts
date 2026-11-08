/** readiness-link-rescue public contract. Internals are imported only within this module. */
export type { ReadinessLinkRescue, ReadinessRescuePlan } from "./store";
export {
  emailFreshReadinessLink,
  planReadinessLinkRescue,
  RESCUE_RESEND_COOLDOWN_MS,
  sendPlannedReadinessLink,
} from "./store";
