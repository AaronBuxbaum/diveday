/**
 * calendar-sync — staff subscribe to their DiveDay departures from Google,
 * Apple, or Outlook (docs ADR 20260730-calendar-feed-subscriptions).
 *
 * This file is the module's entire public surface: nothing outside
 * `src/features/calendar-sync/` may import its internals, and
 * `pnpm check:architecture` enforces that. See ./README.md for the contract.
 */

export { type FeedLabels, type FeedTrip, feedDocument } from "./feed-document";
export {
  type CalendarFeedContext,
  type CalendarFeedSummary,
  type FeedScope,
  type IssuedFeed,
  issueCalendarFeed,
  listCalendarFeeds,
  revokeCalendarFeeds,
  revokeFeedsForFormerStaff,
  touchCalendarFeed,
  verifyCalendarFeed,
} from "./feed-store";
// FEED_REFRESH_MINUTES stays internal: it is a detail of the document
// feed-document.ts writes, not something a caller needs to know.
export { feedPath, feedSubscribeUrl, tokenFromFeedSegment } from "./feed-token";
export { FEED_FUTURE_DAYS, FEED_PAST_DAYS, listFeedTrips } from "./feed-trips";
