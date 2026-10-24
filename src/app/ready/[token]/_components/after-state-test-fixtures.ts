import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import type { AfterStateProps } from "./AfterState";

/** Keys, echoed with their params — the words are the bundle's problem, not this test's. */
export const t = ((key: DiverMessageKey, params?: Record<string, unknown>) =>
  params ? `${key}(${Object.values(params).join(",")})` : key) as unknown as DiverTranslator;

export const noop = () => {};

export function props(overrides: Partial<AfterStateProps> = {}): AfterStateProps {
  return {
    t,
    locale: DEFAULT_DIVER_LOCALE,
    shop: {
      name: "Blue Mantis Divers",
      slug: "blue-mantis",
      depthUnit: "meters",
      temperatureUnit: "celsius",
      reviewUrl: null,
      brandColor: null,
      brandDisplayFont: null,
    },
    siteMark: "reef",
    trip: {
      title: "Two-Tank — French Reef",
      waterTemperatureC: 27,
      visibilityMeters: 24,
      surfaceConditions: "Calm",
      boatName: "Mantis II",
      crew: ["Keiko Tanaka", "Sal Moretti"],
    },
    when: "Sat, Aug 29",
    diverName: "Yara Halabi",
    // A site is its name here and nothing else — see "what the record may
    // claim" below for why, and for the type assertion that now holds it.
    sites: [{ name: "French Reef" }],
    course: null,
    shoutout: null,
    photos: [],
    maxPhotos: 12,
    photosOn: true,
    visitCount: 3,
    currency: "usd",
    canTip: false,
    tip: null,
    tipPresets: [10, 20, 40],
    canReview: true,
    ownReview: null,
    ownPulse: null,
    params: {},
    nextDeparture: null,
    postcard: {
      shopName: "Blue Mantis Divers",
      heading: "recap.logbookHeading",
      diveDayLine: "recap.diveDayNumber(3)",
      facts: [{ label: "recap.diverLabel", value: "Yara Halabi" }],
      privateLine: null,
      recordedBy: "recap.recordedBy(Blue Mantis Divers)",
    },
    nextDive: null,
    nextDiveWorded: null,
    // Both of these are required, and both were silently absent until the
    // cast below came off: spreading a `Partial` past `as AfterStateProps`
    // let a missing prop compile, so the component was under test with
    // `undefined` where the routes always pass a value.
    diveRecord: null,
    flySafe: null,
    fieldGuide: [],
    observedSpecies: [],
    canShareWithBoat: true,
    actions: {
      submitReview: noop,
      uploadPhoto: noop,
      unsharePhoto: noop,
      startTip: noop,
      submitPulse: noop,
    },
    ...overrides,
  };
}
