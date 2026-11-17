import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import type { TripSentence } from "./trip-sentence";
import type { WaterPerson, WaterStanding } from "./water-standing";

/**
 * **On the water's sentence**, strictly from what the crew recorded
 * (`waterStanding`): an open missing-diver alert first, then who the latest
 * count recorded not back aboard, then who it has not recorded yet. Never
 * "in the water": a count records aboard or not back aboard, not where a
 * person is. With no count recorded, or on a cancelled trip nobody is
 * recorded missing from, the frame's sentence (`fallback`, from
 * `tripSentence`: the schedule, the crew's word, or the cancellation) stands.
 */
export function waterSentence(
  standing: WaterStanding,
  fallback: TripSentence,
  { locale, timeZone, cancelled }: { locale: string; timeZone: string; cancelled: boolean },
  t: StaffTranslator,
): TripSentence {
  const { latest, notYetBack } = standing;
  const countedBy =
    latest?.by && latest.at
      ? t("trips.clock.water.countedBy", {
          name: latest.by,
          time: formatTime(latest.at, locale, timeZone),
        })
      : null;
  if (standing.alerts > 0) {
    return {
      headline: t("trips.clock.water.alerts", { count: standing.alerts }),
      emphasis: t("trips.clock.water.alertCount", { count: standing.alerts }),
      sub: countedBy,
    };
  }
  const notBack = notYetBack.filter((person) => person.status === "notBack");
  // A cancelled trip says so, unless a count recorded somebody not back aboard.
  if (!latest || (cancelled && notBack.length === 0)) return fallback;
  if (latest.dive === 0) {
    return {
      headline: latest.complete
        ? t("trips.clock.water.dockDone", { count: latest.aboard })
        : t("trips.clock.water.dockPartial", { aboard: latest.aboard, out: latest.out }),
      emphasis: null,
      sub: join(countedBy, fallback.sub),
    };
  }
  const backAboard = t("trips.clock.water.backAboard", { aboard: latest.aboard, out: latest.out });
  if (notBack.length > 0) {
    const dives = new Set(notBack.map((person) => person.afterDive));
    const dive = dives.size === 1 ? [...dives][0] : null;
    return {
      headline:
        dive === null
          ? t("trips.clock.water.notBack", { count: notBack.length })
          : t("trips.clock.water.notBackAfter", { count: notBack.length, dive }),
      emphasis: t("trips.clock.water.people", { count: notBack.length }),
      sub: join(backAboard, countedBy),
    };
  }
  if (notYetBack.length > 0) {
    return {
      headline: t("trips.clock.water.notYetBack", { count: notYetBack.length, dive: latest.dive }),
      emphasis: t("trips.clock.water.people", { count: notYetBack.length }),
      sub: join(backAboard, countedBy),
    };
  }
  return {
    headline: t("trips.clock.water.allBack", { dive: latest.dive }),
    emphasis: null,
    sub: join(backAboard, countedBy),
  };
}

/** One person's status phrase on the "Not yet recorded back" list. */
export function waterPersonStatus(person: WaterPerson, t: StaffTranslator): string {
  switch (person.status) {
    case "missingAlert":
      return t("trips.clock.water.status.missingAlert");
    case "notBack":
      return person.afterDive === null
        ? t("trips.clock.water.status.notBack")
        : t("trips.clock.water.status.notBackAfter", { dive: person.afterDive });
    case "conflict":
      return t("trips.clock.water.status.conflict");
    case "unrecorded":
      return t("trips.clock.water.status.unrecorded");
  }
}

function join(...parts: (string | null)[]): string | null {
  const said = parts.filter((part): part is string => !!part);
  return said.length ? said.join(" · ") : null;
}
