import { copyForLocale, type LocalizedCopy } from "./localized-copy";

const COPY = {
  waiverReceived: { "en-US": "Waiver received" },
  waiverDone: { "en-US": "That’s the paperwork done ✓" },
  readinessTitle: { "en-US": "Your trip readiness" },
  recapEyebrow: { "en-US": "That’s a wrap" },
  recapHeading: { "en-US": "Nice diving" },
} satisfies Record<string, LocalizedCopy>;

export function capabilityCopy(locale: string) {
  return Object.fromEntries(
    Object.entries(COPY).map(([key, value]) => [key, copyForLocale(value, locale)]),
  ) as { [K in keyof typeof COPY]: string };
}
