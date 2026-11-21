import type { SafetyMonth } from "@/features/safety/safety-report";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** Unknown historical records do not count as clean or as proof of no card. */
export function crewSafetyValue(safety: SafetyMonth, t: StaffTranslator) {
  const unknown = safety.unknownCredentialSailings;
  const people = safety.crewCredentialStates;
  const value =
    people.length === 0
      ? "—"
      : safety.crewSailings === unknown
        ? t("incidents.safety.crewHistoryUnavailableValue")
        : t("incidents.safety.crewValue", {
            credentialed: people.filter((person) => person.credentialed).length,
            crew: people.length,
          });
  const detail = [
    unknown > 0 ? t("incidents.safety.crewHistoryUnavailable", { count: unknown }) : null,
    safety.unrecordedSailings > 0
      ? t("incidents.safety.crewDetailUnrecorded", {
          unrecorded: safety.unrecordedSailings,
          sailings: safety.crewSailings - unknown,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    value,
    detail,
    attention: Boolean(unknown || safety.unrecordedSailings || safety.lapsedSailings.length),
  };
}
