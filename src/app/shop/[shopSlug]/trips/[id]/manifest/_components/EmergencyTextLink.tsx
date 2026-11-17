import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type EmergencyTextFacts, emergencyTextBody, emergencyTextHref } from "./emergency-text";

/**
 * "Draft a text" under an emergency contact on the person sheet (issue #4256):
 * opens the phone's message app with the draft, and a person sends it. Draws
 * nothing for a number with no digits. Screen only.
 */
export function EmergencyTextLink({
  facts,
  personName,
  phone,
  t,
}: {
  facts: EmergencyTextFacts;
  personName: string;
  phone: string;
  t: StaffTranslator;
}) {
  const href = emergencyTextHref(phone, emergencyTextBody(t, facts, personName));
  if (!href) return null;
  return (
    <a
      href={href}
      className={buttonClass({ variant: "link", flush: true, className: "mt-1 min-h-11" })}
    >
      {t("manifest.emergencyText.label")}
    </a>
  );
}
