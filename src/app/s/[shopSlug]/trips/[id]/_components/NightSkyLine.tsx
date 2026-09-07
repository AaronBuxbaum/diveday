import { diverTranslator } from "@/i18n/messages";
import { nightSkyLine } from "@/i18n/sky-labels";
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
  timeZone,
  locale,
  className,
}: {
  /** `nightSkyFor`'s answer; null for a daylight departure. */
  sky: NightSky | null;
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
    </p>
  );
}
