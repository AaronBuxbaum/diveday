import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SafetyMonth } from "@/lib/safety-report";
import type { MonthFigure } from "../../reports/_components/MonthFigures";
import { crewSafetyValue } from "./crew-safety-value";
import { SAFETY_LIST_IDS } from "./SafetyLists";

/**
 * **The month is four doors** (visual review A05): the counts that move
 * month to month, each the link to the list behind it. "Boarded at the
 * dock" goes as a tile, but a seat never marked there is still said, as
 * attention under the roll calls it belongs to; a boat with no crew on
 * record keeps its own list below, and a month with no crew on record at all
 * says so in one line. The year keeps every figure: it prints
 * for a broker and has no lists to point at.
 */
export function safetyMonthTiles({
  t,
  safety,
  filed,
  drafts,
  activityHref,
  staffingHref,
  teamHref,
}: {
  t: StaffTranslator;
  safety: SafetyMonth;
  filed: number;
  drafts: number;
  activityHref: string;
  /** The crew schedule, or null when the shop runs without it. */
  staffingHref: string | null;
  teamHref?: string;
}): MonthFigure[] {
  const attention = (detail: string | null) =>
    detail ? { detail, detailTone: "attention" as const } : {};
  return [
    {
      key: "rollCalls",
      label: t("incidents.safety.rollCalls"),
      value: t("incidents.safety.rollCallsValue", {
        closed: safety.rollCallsClosed,
        back: safety.departuresBack,
      }),
      href: `#${SAFETY_LIST_IDS.open}`,
      ...attention(
        safety.unmarkedAtDock > 0
          ? t("incidents.safety.boardedDetail", { count: safety.unmarkedAtDock })
          : null,
      ),
    },
    {
      key: "certOverrides",
      label: t("incidents.safety.certOverrides"),
      value: String(safety.certOverrides),
      href: activityHref,
    },
    // A month with no crew recorded on any departure is a shop that does not
    // roster crew here: the record judged nothing, so it says so in one quiet
    // line and points at where crew are rostered, never "0 of 0" over a list
    // that is not drawn (layer 3 review F3; review F1 on the year).
    safety.noCrewOnRecord
      ? {
          key: "crew",
          label: t("incidents.safety.crew"),
          value: "—",
          detail: t("incidents.safety.noCrewNone"),
          detailTone: "quiet" as const,
          ...(staffingHref
            ? { link: { href: staffingHref, label: t("shared.shopNavLinks.staffing") } }
            : {}),
        }
      : {
          key: "crew",
          label: t("incidents.safety.crew"),
          value: crewSafetyValue(safety, t).value,
          ...(safety.unknownCredentialSailings && teamHref
            ? { link: { href: teamHref, label: t("incidents.safety.currentCrewCredentials") } }
            : {
                href: `#${safety.lapsedSailings.length > 0 || safety.unrecordedCrew.length === 0 ? SAFETY_LIST_IDS.lapsed : SAFETY_LIST_IDS.unrecorded}`,
              }),
          ...attention(
            crewSafetyValue(safety, t).attention ? crewSafetyValue(safety, t).detail : null,
          ),
        },
    {
      key: "incidents",
      label: t("incidents.safety.incidents"),
      value: t("incidents.safety.incidentsValue", {
        filed,
        drafts,
      }),
      href: `#${SAFETY_LIST_IDS.incidents}`,
    },
  ];
}
