/**
 * weekly-digest — the Monday email to owners and staff: last week's numbers,
 * this week's boats and what Today says is overdue.
 *
 * This file is the module's entire public surface: nothing outside
 * `src/features/weekly-digest/` may import its internals, and
 * `pnpm check:architecture` enforces that. See ./README.md for the contract.
 */

export {
  digestSectionsWithLinks,
  previewWeeklyDigest,
  readWeeklyDigestFacts,
  sendDueWeeklyDigests,
  sendWeeklyDigestForShop,
  type WeeklyDigestPassSummary,
  type WeeklyDigestShopSummary,
  weeklyDigestSettingsPath,
} from "./digest";
export type {
  WeeklyDigestRecipient,
  WeeklyDigestShop,
  WeeklyDigestUnsubscribeContext,
} from "./store";
export {
  issueWeeklyDigestUnsubscribeToken,
  listWeeklyDigestRecipients,
  readWeeklyDigestChoice,
  resolveWeeklyDigestUnsubscribeToken,
  setWeeklyDigestChoice,
  staffLogins,
  turnOffWeeklyDigestByToken,
} from "./store";
