import { activityParams, isActivityCode } from "@/lib/activity";
import type { CatchUpGroup, CatchUpKind } from "@/lib/catch-up";
import { cachedListFormat } from "@/lib/intl-cache";
import type {
  ReviewModerationLineCode,
  ShopActivityKind,
  ShopActivitySource,
  TripChangeLineCode,
} from "@/lib/shop-activity";
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

const REVIEW_LINE_KEYS: Record<ReviewModerationLineCode, StaffMessageKey> = {
  published: "activity.review.published",
  hidden: "activity.review.hidden",
};

const TRIP_CHANGE_LINE_KEYS: Record<TripChangeLineCode, StaffMessageKey> = {
  meeting_point: "activity.tripChange.meeting_point",
  conditions: "activity.tripChange.conditions",
  site_change: "activity.tripChange.site_change",
};

/**
 * **A line of the shop's activity log** (`src/db/shop-activity.ts`), in words.
 *
 * An `activity_events` line is the trail's own sentence, exactly as the
 * departure and the diver record read it. The other two trails store a code
 * and an author id; their sentence takes the author's name as the people row
 * holds it today, so an erased staffer reads as the erasure wrote them.
 */
export function shopActivityLineText(
  t: StaffTranslator,
  line: { source: ShopActivitySource; code: string; params: unknown; actorName: string | null },
): string {
  if (line.source === "activity") return activityLine(t, line);
  const actor = line.actorName ?? t("activity.log.someone");
  if (line.source === "review") {
    const key = REVIEW_LINE_KEYS[line.code as ReviewModerationLineCode];
    return key ? t(key, { actor }) : t("activity.unknown");
  }
  const key = TRIP_CHANGE_LINE_KEYS[line.code as TripChangeLineCode];
  return key ? t(key, { actor }) : t("activity.unknown");
}

/** The kind filter's words, keyed by the kind so a seventh cannot arrive unworded. */
export const SHOP_ACTIVITY_KIND_KEYS: Record<ShopActivityKind, StaffMessageKey> = {
  seats: "activity.log.kind.seats",
  departures: "activity.log.kind.departures",
  money: "activity.log.kind.money",
  safety: "activity.log.kind.safety",
  records: "activity.log.kind.records",
  reviews: "activity.log.kind.reviews",
};

/**
 * The catch-up strip's words (issues #1202 and #1187, delight report D42):
 * one key per sentence a desk line feeds (`src/lib/catch-up.ts`), in the
 * `manifest` namespace the strip renders in.
 */
const CATCH_UP_KEYS = {
  arrival: "manifest.catchUp.arrival",
  running_late: "manifest.catchUp.runningLate",
  seat_taken: "manifest.catchUp.seatTaken",
  seat_released: "manifest.catchUp.seatReleased",
  seat_turned_away: "manifest.catchUp.seatTurnedAway",
  now_diving: "manifest.catchUp.nowDiving",
  now_snorkeling: "manifest.catchUp.nowSnorkeling",
  now_riding: "manifest.catchUp.nowRiding",
  balance_owed: "manifest.catchUp.balanceOwed",
  gear_changed: "manifest.catchUp.gearChanged",
  pickup_set: "manifest.catchUp.pickupSet",
  help_request: "manifest.catchUp.helpRequest",
  meeting_point: "manifest.catchUp.meetingPoint",
  plan_changed: "manifest.catchUp.planChanged",
} as const satisfies Record<CatchUpKind, StaffMessageKey>;

/**
 * **The catch-up strip, put into words**: one sentence per group, in the
 * order `groupCatchUp` put them.
 *
 * The two trip-wide kinds take no names and say the fact plainly; every other
 * kind interpolates its names through `Intl.ListFormat` in the reader's own
 * locale — never a hand-rolled `", "`, which puts an English "and" into a
 * Spanish sentence.
 *
 * A group whose names all resolved to null — every diver on it erased — is
 * dropped rather than rendered as an empty list. That is the honest outcome of
 * joining the name live: an erasure takes the line with it.
 */
export function catchUpSentences(
  t: StaffTranslator,
  locale: string,
  groups: readonly CatchUpGroup[],
): string[] {
  const list = cachedListFormat(locale, { type: "conjunction" });
  return groups.flatMap((group) => {
    if (group.kind === "meeting_point" || group.kind === "plan_changed") {
      return [t(CATCH_UP_KEYS[group.kind])];
    }
    if (group.names.length === 0) return [];
    return [
      t(CATCH_UP_KEYS[group.kind], { count: group.names.length, names: list.format(group.names) }),
    ];
  });
}
