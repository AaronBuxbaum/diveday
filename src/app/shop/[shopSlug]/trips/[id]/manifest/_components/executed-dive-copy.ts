import type { ComponentProps } from "react";
import type { ExecutedDive } from "@/db/schema";
import type { listTripDives } from "@/db/trips";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, depthInUnit } from "@/lib/depth-units";
import { formatTime, formatTimeRange } from "@/lib/format";
import type { ExecutedDiveLabels, ExecutedDiveLog } from "./ExecutedDiveLog";

type ExecutedDiveLogProps = ComponentProps<typeof ExecutedDiveLog>;

/**
 * The one line a collapsed dive shows: "Dive 1 — not recorded yet", or
 * "Dive 1 — Molasses Reef, 18 m, 8:05 – 8:47".
 *
 * Composed here rather than in the component for the reason `diveLabel` is: it
 * needs the translator, the shop's depth unit and the shop's zone, and
 * `ExecutedDiveLog` is a Client Component with none of them.
 *
 * Every part is optional except the site, which always resolves — a saved row
 * with no actual site means staff recorded it as unknown, and that is itself
 * the answer. A part nobody entered is simply absent; the line never invents a
 * dash or a zero to stand in for it.
 */
export function executedDiveSummary({
  diveLabel,
  row,
  locale,
  timeZone,
  depthUnit,
  t,
}: {
  diveLabel: string;
  row?: { executed: ExecutedDive; actualSite: { id: string; name: string } | null };
  locale: string;
  timeZone: string;
  depthUnit: DepthUnit;
  t: StaffTranslator;
}): string {
  if (!row) return t("manifest.executedDive.summaryNotRecorded", { dive: diveLabel });
  const parts: string[] = [row.actualSite?.name ?? t("manifest.executedDive.unknown")];
  const depth = row.executed.maxDepthMeters;
  if (depth != null && !row.executed.notRecorded.includes("depth")) {
    parts.push(
      t("manifest.executedDive.summaryDepth", {
        depth: depthInUnit(depth, depthUnit),
        unit: depthUnit === "feet" ? "ft" : "m",
      }),
    );
  }
  const { enteredAt, exitedAt } = row.executed;
  if (enteredAt && exitedAt) {
    parts.push(formatTimeRange(enteredAt, exitedAt, locale, timeZone));
  } else if (enteredAt) {
    parts.push(formatTime(enteredAt, locale, timeZone));
  }
  return t("manifest.executedDive.summaryRecorded", {
    dive: diveLabel,
    detail: parts.join(", "),
  });
}

/**
 * The dive log's words, resolved here and handed down: `ExecutedDiveLog` is a
 * Client Component (it shows a typed refusal beside the field that caused it),
 * and `staffTranslator` is server-side only.
 */
export function executedDiveLabels(t: StaffTranslator, depthUnit: DepthUnit): ExecutedDiveLabels {
  return {
    heading: t("manifest.executedDive.heading"),
    actualSite: t("manifest.executedDive.actualSite"),
    unknown: t("manifest.executedDive.unknown"),
    maxDepth: t("manifest.executedDive.maxDepth", { unit: depthUnit === "feet" ? "ft" : "m" }),
    enteredAt: t("manifest.executedDive.enteredAt"),
    exitedAt: t("manifest.executedDive.exitedAt"),
    visibility: t("manifest.executedDive.visibility"),
    current: t("manifest.executedDive.current"),
    notRecordedDepth: t("manifest.executedDive.notRecordedDepth"),
    observedSpecies: t("manifest.executedDive.observedSpecies"),
    observedSpeciesHint: t("manifest.executedDive.observedSpeciesHint"),
    observedSpeciesNone: t("manifest.executedDive.observedSpeciesNone"),
    planChangeReason: t("manifest.planChange.reasonLabel"),
    planChangeReasonOptions: {
      current: t("manifest.planChange.reason.current"),
      weather: t("manifest.planChange.reason.weather"),
      visibility: t("manifest.planChange.reason.visibility"),
      crew_call: t("manifest.planChange.reason.crewCall"),
    },
    planChangeNote: t("manifest.planChange.noteLabel"),
    planChangeNoteHint: t("manifest.planChange.noteHint"),
    save: t("manifest.executedDive.save"),
    saved: t("manifest.executedDive.saved"),
    refusals: {
      times_transposed: t("manifest.executedDive.refusal.timesTransposed"),
      depth_out_of_range: t("manifest.executedDive.refusal.depthOutOfRange"),
      dive_number_out_of_range: t("manifest.executedDive.refusal.diveNumberOutOfRange"),
      unknown_site: t("manifest.executedDive.refusal.unknownSite"),
      unknown_trip: t("manifest.executedDive.refusal.unknownTrip"),
      unknown_recorder: t("manifest.executedDive.refusal.unknownRecorder"),
      invalid_time: t("manifest.executedDive.refusal.invalidTime"),
      invalid: t("manifest.executedDive.refusal.invalid"),
      wrong_dive: t("manifest.executedDive.refusal.wrongDive"),
      plan_change_note_without_reason: t(
        "manifest.executedDive.refusal.planChangeNoteWithoutReason",
      ),
      plan_change_note_too_long: t("manifest.executedDive.refusal.planChangeNoteTooLong"),
    },
  };
}

/**
 * The plan as the dive log opens it: each planned dive with its site, its
 * label, and the one line it shows collapsed — "not recorded yet", or what the
 * crew recorded against it.
 */
export function executedDivePlanned({
  plannedDives,
  executedDives,
  locale,
  timeZone,
  depthUnit,
  t,
}: {
  plannedDives: Awaited<ReturnType<typeof listTripDives>>;
  executedDives: ReadonlyArray<{
    executed: ExecutedDive;
    actualSite: { id: string; name: string } | null;
  }>;
  locale: string;
  timeZone: string;
  depthUnit: DepthUnit;
  t: StaffTranslator;
}) {
  return plannedDives.map(({ dive, diveSite }) => ({
    diveNumber: dive.diveNumber,
    diveSite: diveSite ? { id: diveSite.id, name: diveSite.name } : null,
    diveLabel: t("manifest.executedDive.dive", { number: dive.diveNumber }),
    plannedSiteLabel: t("manifest.executedDive.plannedSite", {
      site: diveSite?.name ?? t("manifest.executedDive.unknown"),
    }),
    summaryLine: executedDiveSummary({
      diveLabel: t("manifest.executedDive.dive", { number: dive.diveNumber }),
      row: executedDives.find((entry) => entry.executed.diveNumber === dive.diveNumber),
      locale,
      timeZone,
      depthUnit,
      t,
    }),
  }));
}

/**
 * The dive log's inputs that come from the reads rather than the request: the
 * plan with its collapsed lines, what was recorded, the sites a crew may name,
 * the species pickers, and the words — resolved here because `ExecutedDiveLog`
 * is a Client Component.
 */
export function executedDiveLogView({
  plannedDives,
  executedDives,
  liveDiveSites,
  catalogSpecies,
  speciesBySite,
  locale,
  timeZone,
  depthUnit,
  t,
}: Parameters<typeof executedDivePlanned>[0] & {
  executedDives: Parameters<typeof executedDivePlanned>[0]["executedDives"] &
    ExecutedDiveLogProps["executed"];
  liveDiveSites: ReadonlyArray<{ id: string; name: string }>;
  catalogSpecies: ExecutedDiveLogProps["catalogSpecies"];
  speciesBySite: ExecutedDiveLogProps["speciesBySite"];
}) {
  return {
    planned: executedDivePlanned({ plannedDives, executedDives, locale, timeZone, depthUnit, t }),
    executed: executedDives,
    liveDiveSites: liveDiveSites.map((site) => ({ id: site.id, name: site.name })),
    catalogSpecies,
    speciesBySite,
    labels: executedDiveLabels(t, depthUnit),
    timeZone,
    depthUnit,
  };
}
