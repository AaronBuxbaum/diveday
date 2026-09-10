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
  // `check:locale` holds both bundles to the same set. `ActivityEntry` is a
  // discriminated union, so a writer that omits a name is a compile error at
  // the call site — which is where this is stopped, not here.
  //
  // If one reaches this anyway, `translatorOnError` decides what happens and
  // this module does not second-guess it: outside production it **throws**, so
  // a dev server, a unit test and an e2e run all fail on the row rather than
  // rendering something that merely looks fine; in production it renders the
  // fallback — the English pattern, placeholder and all — and counts the
  // failure. Catching here would buy a tidier line at the price of the loud
  // half, which is the trade `src/i18n/on-error.ts` was written to refuse.
  return t(key, activityParams(row.params));
}
