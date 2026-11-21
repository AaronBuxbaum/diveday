import { getDb } from "@/db/client";
import { cronRoute } from "@/features/platform/cron-route";
import { sentry } from "@/features/platform/sentry-server";
import {
  DIETARY_RETENTION_CRONTAB,
  drainExpiredClaudeCallContent,
  drainExpiredDietaryNotes,
} from "@/features/records/retention";
import { errorClassToken } from "@/lib/error-token";
import { log } from "@/lib/log";

/** 45 seconds of batch admission leaves room for an in-flight batch and reporting. */
export const maxDuration = 60;

/**
 * Daily privacy sweep, independent of the weekly table prune's budget and
 * backlog: food notes past their window, and Claude call content past its 30
 * days (ADR 20261023-claude-call-content). The response keeps the food-note
 * summary's shape and adds `claudeCallContent`.
 */
export const GET = cronRoute({
  id: "dietary-retention",
  crontab: DIETARY_RETENTION_CRONTAB,
  checkinMargin: 240,
  maxRuntime: 5,
  run: async () => {
    try {
      const db = await getDb();
      const claude = await drainExpiredClaudeCallContent(db);
      if (claude.failed) {
        log("cron_claude_content_retention.prune_failed", "error", { deleted: claude.deleted });
        await sentry.captureMessage("claude call content retention failed", { level: "error" });
      }
      if (claude.capped) {
        log("cron_claude_content_retention.prune_capped", "warn", { deleted: claude.deleted });
      }
      const summary = await drainExpiredDietaryNotes(db);
      if (summary.failed) {
        log("cron_dietary_retention.clear_failed", "error", { cleared: summary.cleared });
        await sentry.captureMessage("dietary retention failed", { level: "error" });
      }
      if (summary.capped) {
        log("cron_dietary_retention.clear_capped", "warn", { cleared: summary.cleared });
      }
      return { ...summary, claudeCallContent: claude };
    } catch (error) {
      // Even a connection error can quote credentials or query parameters, so
      // the helper reports a new error that carries only the class, never the
      // original message or cause.
      throw new Error(`dietary_retention_${errorClassToken(error)}`);
    }
  },
  // A cap or a statement failure both flag the monitor; the body still answers.
  healthy: (result) =>
    !(
      result.failed ||
      result.capped ||
      result.claudeCallContent.failed ||
      result.claudeCallContent.capped
    ),
});
