import { copyForLocale, type LocalizedCopy } from "./localized-copy";

const COPY = {
  schedule: {
    eyebrow: { "en-US": "Trips" },
    title: { "en-US": "Schedule" },
    staffDescription: {
      "en-US":
        "Upcoming trips. Open a departure to work through its roster, readiness, prep list, and manifest.",
    },
    diverDescription: {
      "en-US": "Find your next day on the water, see what to expect, and reserve your spot.",
    },
    noTrips: { "en-US": "No trips on the books yet" },
    noTripsStaff: {
      "en-US": "The board is clear. Schedule your first departure and divers can start booking.",
    },
    noTripsPublic: { "en-US": "Check back soon — or call the shop and we’ll find you a boat." },
  },
  course: {
    hidden: { "en-US": "Hidden — divers cannot see this page." },
    backToEditing: { "en-US": "Back to editing" },
    noCertification: { "en-US": "No certification required" },
  },
} satisfies Record<string, Record<string, LocalizedCopy>>;

export function publicCopy(locale: string) {
  return {
    schedule: Object.fromEntries(
      Object.entries(COPY.schedule).map(([key, value]) => [key, copyForLocale(value, locale)]),
    ) as { [K in keyof typeof COPY.schedule]: string },
    course: Object.fromEntries(
      Object.entries(COPY.course).map(([key, value]) => [key, copyForLocale(value, locale)]),
    ) as { [K in keyof typeof COPY.course]: string },
  };
}
