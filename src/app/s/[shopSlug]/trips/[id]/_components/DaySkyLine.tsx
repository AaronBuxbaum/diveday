import { diverTranslator } from "@/i18n/messages";
import { daySkyLine } from "@/i18n/sky-labels";
import { formatTime } from "@/lib/format";

/**
 * **When the light arrives and when it goes**, over a daylight departure.
 *
 * The daytime twin of `NightSkyLine`, on the one surface that wants it: the
 * departure page's "The day". A 7:00 AM two-tank in December meets in the dark
 * and a 7:00 AM two-tank in June does not, and that is a fact about the day a
 * diver is deciding on — it changes what they wear on the dock and how much
 * light the second tank has left.
 *
 * It informs and gates nothing, and it renders nothing at all when either end
 * of the day is missing: no coordinates, a polar summer, a polar winter. A
 * fabricated sunrise would be worse than silence, and a half-sentence would be
 * worse than both.
 */
export function DaySkyLine({
  sunriseAt,
  sunsetAt,
  timeZone,
  locale,
  className,
}: {
  sunriseAt: Date | null;
  sunsetAt: Date | null;
  /** The shop's own zone — a rendered clock time names the zone it is in. */
  timeZone: string;
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  className?: string;
}) {
  if (!sunriseAt || !sunsetAt) return null;
  const t = diverTranslator(locale);
  return (
    <p className={className ?? "mt-2 text-sm text-muted"}>
      {daySkyLine(t, {
        sunrise: formatTime(sunriseAt, locale, timeZone),
        sunset: formatTime(sunsetAt, locale, timeZone),
      })}
    </p>
  );
}
