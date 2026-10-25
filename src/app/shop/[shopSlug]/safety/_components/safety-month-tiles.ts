import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SafetyMonth } from "@/lib/safety-report";
import type { MonthFigure } from "../../reports/_components/MonthFigures";
import { SAFETY_LIST_IDS } from "./SafetyLists";

/**
 * **The month is four doors** (visual review A05): the counts that move
 * month to month, each the link to the list behind it. "Boarded at the
 * dock" goes as a tile, but a seat never marked there is still said, as
 * attention under the roll calls it belongs to; a boat with no crew on
 * record keeps its own list below. The year keeps every figure: it prints
 * for a broker and has no lists to point at.
 */
export function safetyMonthTiles({
  t,
  safety,
  filed,
  drafts,
  activityHref,
}: {
  t: StaffTranslator;
  safety: SafetyMonth;
  filed: number;
  drafts: number;
  activityHref: string;
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
    {
      key: "crew",
      label: t("incidents.safety.crew"),
      value:
        safety.crewSailings > 0 && safety.checkedSailings === 0
          ? t("staffing.credentials.noneOnFile")
          : t("incidents.safety.crewValue", {
              lapsed: safety.lapsedSailings.length,
              sailings: safety.checkedSailings,
            }),
      href: `#${safety.lapsedSailings.length > 0 || safety.unrecordedCrew.length === 0 ? SAFETY_LIST_IDS.lapsed : SAFETY_LIST_IDS.unrecorded}`,
      ...attention(
        safety.unrecordedSailings > 0
          ? t("incidents.safety.crewDetailUnrecorded", {
              unrecorded: safety.unrecordedSailings,
              sailings: safety.crewSailings,
            })
          : null,
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
