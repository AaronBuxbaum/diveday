// i18n-exempt-file: shared text layout for the terminal email/SMS renderers
// (src/lib/notifications/email.ts, src/db/reminders.ts) — resolves its own
// words via diverTranslator rather than handing back a code (docs ADR
// 20260731-notification-locale).
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { depthText, temperatureText } from "@/i18n/unit-labels";
import type { DepthUnit } from "@/lib/depth-units";
import type { TemperatureUnit } from "@/lib/temperature-units";

/**
 * The night-before brief, shared by both channels (`src/lib/notifications/email.ts`
 * and `src/db/reminders.ts`'s SMS composer). The evening-before reminder
 * (`trip_reminder_24h`) is the single cheapest cancellation-prevention tool a
 * shop has: most day-of no-shows are anxiety plus logistics confusion, not lost
 * interest. These helpers turn what the shop already knows — the crew's read on
 * conditions, the packing list, the dock-call time — into a warm, plain-language
 * brief. The DB layer (`src/db/reminders.ts`) gathers the inputs; this file lays
 * them out into text, in the recipient shop's locale (docs ADR
 * 20260731-notification-locale — this and `email.ts` are the terminal renderer
 * for their content, so unlike most of `src/lib` they resolve their own words
 * rather than handing back a code for `src/app` to translate).
 */

/**
 * The units the recipient's shop reads measurements in. The brief is stored
 * metric like everything else, but a Florida shop's diver was still being told
 * "water around 27°C" the night before a dive its own trip page describes as
 * 81°F — the one place a shop's units were still being ignored after the trip
 * page, recap, and packing tip stopped ignoring them.
 */
export type BriefUnits = { temperature: TemperatureUnit; depth: DepthUnit };

/** The crew's published read on a trip's conditions; every field is optional. */
export type BriefConditions = {
  waterTemperatureC: number | null;
  visibilityMeters: number | null;
  /** Free-text surface read, e.g. "calm" or "0.5 m waves from NE" — shop-authored, never translated. */
  surfaceConditions: string | null;
  /** The crew's own one-line summary, if they wrote one — shop-authored, never translated. */
  conditionsSummary: string | null;
};

/** End a crew sentence with a full stop so it reads cleanly before the stats clause. */
function ensureStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * One friendly, plain-language conditions line for the brief, or null when the
 * crew has published nothing. Built only from what the crew has said about this
 * trip — the cron path never fetches an external forecast per booking. The
 * crew's summary leads (it's the human read); the measured stats follow as a
 * short "expect …" clause, joined through `Intl.ListFormat` so the conjunction
 * is correct for the recipient's locale, so a nervous diver gets both the feel
 * and the numbers.
 *
 * Both figures are written in the shop's own units through the same two
 * helpers the trip page and recap use (`src/i18n/unit-labels.ts`), so the
 * brief and the page a diver opens from it can never disagree about whether
 * the water is 27°C or 81°F.
 */
export function forecastText(
  t: DiverTranslator,
  locale: DiverLocale,
  conditions: BriefConditions,
  units: BriefUnits,
): string | null {
  const measured: string[] = [];
  if (conditions.waterTemperatureC !== null) {
    measured.push(
      t("notifications.brief.waterTemp", {
        value: temperatureText(t, conditions.waterTemperatureC, units.temperature),
      }),
    );
  }
  if (conditions.visibilityMeters !== null) {
    measured.push(
      t("notifications.brief.visibility", {
        value: depthText(t, conditions.visibilityMeters, units.depth),
      }),
    );
  }
  const surface = conditions.surfaceConditions?.trim();
  if (surface) measured.push(surface);

  const summary = conditions.conditionsSummary?.trim();
  const stats = measured.length
    ? t("notifications.brief.expect", {
        list: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(measured),
      })
    : "";

  if (summary && stats) return `${ensureStop(summary)} ${stats}`;
  if (summary) return ensureStop(summary);
  return stats || null;
}

/**
 * The reassurance a first-timer needs and a seasoned diver doesn't. A diver
 * whose only certification is fresh is boarding a boat for the first time; the
 * same brief in a softer voice converts that anxiety into confidence. Returns
 * the extra "what happens on the boat" line, or null for an experienced diver.
 */
export function firstTimerReassuranceText(
  t: DiverTranslator,
  isFirstTimer: boolean,
): string | null {
  return isFirstTimer ? t("notifications.brief.firstTimer") : null;
}
