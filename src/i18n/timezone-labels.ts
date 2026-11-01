import { cachedFormatter } from "@/lib/intl-cache";

/**
 * Standalone localized timezone label. Uses the short zone name for the
 * supplied instant (which determines seasonal names); callers pass an instant
 * within the displayed range. Falls back to the IANA name if unavailable.
 */
export function timeZoneLabel(at: Date, locale: string, timeZone: string): string {
  const parts = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    hour: "numeric",
    timeZoneName: "short",
    timeZone,
  }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}
