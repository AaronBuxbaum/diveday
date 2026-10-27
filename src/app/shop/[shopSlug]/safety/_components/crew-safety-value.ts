import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SafetyMonth } from "@/lib/safety-report";

/** Unknown historical records do not count as clean or as proof of no card. */
export function crewSafetyValue(safety: SafetyMonth, t: StaffTranslator) {
  const unknown = safety.unknownCredentialSailings;
  const value =
    safety.crewSailings > 0 && safety.checkedSailings === 0
      ? unknown > 0
        ? t("incidents.safety.crewHistoryUnavailable", { count: unknown })
        : t("staffing.credentials.noneOnFile")
      : t("incidents.safety.crewValue", {
          lapsed: safety.lapsedSailings.length,
          sailings: safety.checkedSailings,
        });
  const detail = [
    unknown > 0 ? t("incidents.safety.crewHistoryUnavailable", { count: unknown }) : null,
    safety.unrecordedSailings > 0
      ? t("incidents.safety.crewDetailUnrecorded", {
          unrecorded: safety.unrecordedSailings,
          sailings: safety.crewSailings,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    value,
    detail: detail || t("incidents.safety.crewDetail", { sailings: safety.crewSailings }),
    attention: Boolean(unknown || safety.unrecordedSailings || safety.lapsedSailings.length),
  };
}
