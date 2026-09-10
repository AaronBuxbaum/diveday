import { diverTranslator } from "@/i18n/messages";
import { moonriseLine, nightSkyLine } from "@/i18n/sky-labels";
import { formatTime } from "@/lib/format";
import type { NightSky } from "@/lib/sky";

/**
 * **What the sky is doing over a night departure** — when the light goes, and
 * how much moon there will be down there.
 *
 * One line, on the two surfaces a diver reads before a night dive: the
 * briefing's "The day" (deciding) and the thread's dock-day rhythm
 * (preparing). It earns its place on both because a night dive is the one kind
 * of departure where the answer changes what a diver packs — a new moon on a
 * 9:00 PM second tank is a torch and a backup; a full moon over sand is enough
 * light to read a gauge by.
 *
 * It informs and gates nothing (`src/lib/sky.ts`), and a null sky renders
 * nothing at all — which is every daylight departure, and every shop that has
 * never set its address.
 */
export function NightSkyLine({
  sky,
  moonriseAt,
  timeZone,
  locale,
  className,
}: {
  /** `nightSkyFor`'s answer; null for a daylight departure. */
  sky: NightSky | null;
  /**
   * When the moon actually comes up (`sunMoonFor`), for the surfaces that have
   * asked the almanac for it.
   *
   * A second sentence rather than a clause inside the first, because roughly
   * one local day a month has no moonrise at all — the moon comes up about
   * fifty minutes later each day and eventually the crossing falls off the end
   * of the day. A sentence can simply be absent; an optional clause is
   * punctuation every locale has to work around. Omitted or null renders the
   * line the thread has always shown.
   */
  moonriseAt?: Date | null;
  /** The shop's own zone — a rendered clock time names the zone it is in. */
  timeZone: string;
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  className?: string;
}) {
  if (!sky) return null;
  const t = diverTranslator(locale);
  return (
    <p className={className ?? "mt-2 text-sm text-muted"}>
      {nightSkyLine(t, sky, {
        sunset: formatTime(sky.sunsetAt, locale, timeZone),
        dusk: sky.civilDuskAt ? formatTime(sky.civilDuskAt, locale, timeZone) : null,
      })}
      {moonriseAt ? ` ${moonriseLine(t, formatTime(moonriseAt, locale, timeZone))}` : null}
    </p>
  );
}
