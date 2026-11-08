/** buddy-links public contract. Internals are imported only within this module. */
export {
  BUDDY_COOKIE,
  BUDDY_COOKIE_MAX_AGE,
  BUDDY_COOKIE_PATH,
  BUDDY_PARAM,
  buddyReferralFromCookie,
  buddyReferralFromSearchParams,
  encodeBuddyCookie,
  isBuddyReferralIdShape,
} from "./rules";
