import type { StaffTranslator } from "@/i18n/staff-messages";
import { isStaff, type Role } from "@/lib/authz";
import { HomeScreenInstall } from "./HomeScreenInstall";

/** The manifest is open to all staff. Keep this convenience below every first operational task. */
export function HomeScreenInstallSlot({
  roles,
  t,
}: {
  roles: readonly Role[];
  t: StaffTranslator;
}) {
  if (!isStaff(roles)) return null;
  return (
    <HomeScreenInstall
      copy={{
        body: t("shopHome.install.body"),
        install: t("shopHome.install.action"),
        dismiss: t("shopHome.install.dismiss"),
        safari: t("shopHome.install.safari"),
        otherIos: t("shopHome.install.otherIos"),
        chrome: t("shopHome.install.chrome"),
        promptFailed: t("shopHome.install.promptFailed"),
      }}
    />
  );
}
