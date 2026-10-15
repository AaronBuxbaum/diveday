import type { Metadata } from "next";
import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import { canPersonManageShopSettings } from "@/db/authz";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { AGENCY_CHECKS, type CheckableAgency } from "@/lib/agency-check";
import { agencyVerificationPage } from "@/lib/agency-verification";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { requireShopSurface } from "@/lib/session";
import { CertCheckTry } from "../_components/CertCheckTry";
import { SettingsEditorPage } from "../_components/SettingsEditorPage";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Try the checks — DiveDay" };

/**
 * **Try the checks** (H-105, ADR 20261008-cert-check-extension): the
 * extension's own steps in this browser, against sample pages only, and a
 * report to send back. Owners and managers, as every settings page: it is the
 * shop's setup, not a desk task.
 */
export default async function CertChecksTryPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  // Every agency with a sample page: a lookup behind a member sign-in (PADI)
  // has none, since its filler types only on the agency's own page.
  const agencies = (Object.keys(AGENCY_CHECKS) as CheckableAgency[])
    .filter((agency) => agencyVerificationPage(agency)?.kind !== "member_sign_in")
    .map((agency) => ({ key: agency, name: t(AGENCY_KEYS[agency]) }));

  return (
    <SettingsEditorPage
      shopSlug={shopSlug}
      t={t}
      title={t("settings.certChecks.title")}
      description={t("settings.certChecks.description")}
      banner={undefined}
    >
      <CertCheckTry
        agencies={agencies}
        padiOn={shop.padiChecksEnabled}
        supportEmail={SUPPORT_EMAIL}
        copy={{
          run: t("settings.certChecks.run"),
          running: t("settings.certChecks.running"),
          extension: t("settings.certChecks.extension"),
          samples: t("settings.certChecks.samples"),
          padi: t("settings.certChecks.padi"),
          report: t("settings.certChecks.report"),
          added: t.raw("settings.main.certCheck.added"),
          notAdded: t("settings.main.certCheck.notAdded"),
          outdated: t.raw("settings.main.certCheck.outdated"),
          passed: t("settings.certChecks.passed"),
          failed: t("settings.certChecks.failed"),
          notListed: t("settings.certChecks.notListed"),
          signedIn: t("settings.certChecks.signedIn"),
          signedOut: t("settings.certChecks.signedOut"),
          noTab: t("settings.certChecks.noTab"),
          noAnswer: t("settings.certChecks.noAnswer"),
          noAccess: t("settings.certChecks.noAccess"),
          allowSite: t.raw("settings.certChecks.allowSite"),
          failedNext: t("settings.certChecks.failedNext"),
          padiOff: t("shared.padiChecksOff"),
          reportHint: t("settings.certChecks.reportHint"),
          email: t("settings.main.support.emailCta", { email: SUPPORT_EMAIL }),
          copy: t("settings.certChecks.copy"),
          copied: t("shared.waiverSend.copied"),
          copyFailed: t("shared.waiverSend.copyFailed"),
        }}
      />
    </SettingsEditorPage>
  );
}
