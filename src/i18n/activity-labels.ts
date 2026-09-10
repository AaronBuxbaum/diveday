import { activityParams, isActivityCode } from "@/lib/activity";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * **The trail, put into words.**
 *
 * `activity_events` rows hold a code and the names the sentence needs
 * (`src/lib/activity.ts`); this is the one place those become a sentence a
 * staffer reads. Before issue #1655 the sentence was built in `src/db` and
 * printed verbatim, so the shop's whole history read English whichever language
 * the staffer had chosen — on a surface a Spanish-speaking shop reads all day.
 *
 * Server-side only, like everything over the staff bundle: the three surfaces
 * that show a trail are Server Components and hand `ActivityLog` the finished
 * strings (see `src/i18n/staff-messages.ts` on why the bundle never crosses to
 * the client).
 */
export function activityLine(t: StaffTranslator, row: { code: string; params: unknown }): string {
  // **A code this build does not know still renders a sentence.** The column is
  // text rather than an enum so a new code costs no migration, which means a
  // row written by a newer build can be read by an older one for the seconds a
  // deploy takes. One honest line beats a raw code on screen, and beats a throw
  // taking down a diver record over one row of history.
  if (!isActivityCode(row.code)) return t("activity.unknown");
  const key = `activity.line.${row.code}` as StaffMessageKey;
  // The ICU placeholders are the parameter names in `ActivityParamShapes`, and
  // `check:locale` holds both bundles to the same set. A name missing from the
  // payload renders as an empty span in the sentence rather than throwing: a
  // gap in one line of history, bounded to that line.
  return t(key, activityParams(row.params));
}
