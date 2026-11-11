import { SectionCard } from "@/components/ui/card";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { PasskeySettings } from "./PasskeySettings";

export function PasskeySection({
  locked,
  shopSlug,
  passkeys,
  locale,
  timeZone,
  t,
}: {
  locked: boolean;
  shopSlug: string;
  passkeys: { id: string; name: string; lastUsedAt: Date | null }[];
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  return (
    <SectionCard
      title={t("settings.security.passkeys.heading")}
      description={t("settings.security.passkeys.description")}
    >
      <PasskeySettings
        locked={locked}
        shopSlug={shopSlug}
        passkeys={passkeys.map((key) => ({
          id: key.id,
          name: key.name,
          lastUsed: key.lastUsedAt
            ? t("settings.security.passkeys.lastUsed", {
                date: formatDateTimeTz(key.lastUsedAt, locale, timeZone),
              })
            : t("settings.security.passkeys.neverUsed"),
        }))}
        words={{
          name: t("settings.security.passkeys.name"),
          add: t("settings.security.passkeys.add"),
          adding: t("settings.security.passkeys.adding"),
          save: t("settings.security.passkeys.save"),
          delete: t("settings.security.passkeys.delete"),
          confirmDelete: t("settings.security.passkeys.confirmDelete"),
          cancel: t("settings.security.passkeys.cancel"),
          empty: t("settings.security.passkeys.empty"),
          error: t("settings.security.passkeys.error"),
          saved: t("settings.security.passkeys.saved"),
          unavailable: t("settings.security.passkeys.unavailable"),
        }}
      />
    </SectionCard>
  );
}
