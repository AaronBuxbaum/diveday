import type { DiverTranslator } from "@/i18n/messages";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";

/** The recipient's localized greeting in plain text and HTML text-node form. */
export function notificationGreeting(
  t: DiverTranslator,
  name: string | null | undefined,
): { text: string; html: string } {
  const firstName = firstNameOf(name, t("notifications.common.genericName"));
  return {
    text: t("notifications.common.greeting", { firstName }),
    html: t("notifications.common.greeting", { firstName: escapeHtml(firstName) }),
  };
}
