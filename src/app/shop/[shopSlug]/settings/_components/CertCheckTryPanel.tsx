import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { AGENCY_CHECKS, type CheckableAgency } from "@/lib/agency-check";
import { agencyVerificationPage } from "@/lib/agency-verification";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { CertCheckTry } from "./CertCheckTry";

/**
 * **Try the checks** (H-105, ADR 20261008-cert-check-extension), as the
 * disclosure inside the Card checks row (#2817): the extension's own steps in
 * this browser, against sample pages only, and a report to send back. It was a
 * page of its own; it is a part of the row that says whether the extension is
 * here. The words are resolved here, on the server, because `CertCheckTry` is a
 * Client Component that takes its copy as props.
 */
export function CertCheckTryPanel({ t, padiOn }: { t: StaffTranslator; padiOn: boolean }) {
  // Every agency with a sample page: a lookup behind a member sign-in (PADI)
  // has none, since its filler types only on the agency's own page.
  const agencies = (Object.keys(AGENCY_CHECKS) as CheckableAgency[])
    .filter((agency) => agencyVerificationPage(agency)?.kind !== "member_sign_in")
    .map((agency) => ({ key: agency, name: t(AGENCY_KEYS[agency]) }));
  return (
    <CertCheckTry
      agencies={agencies}
      padiOn={padiOn}
      supportEmail={SUPPORT_EMAIL}
      copy={{
        run: t("settings.certChecks.run"),
        running: t("settings.certChecks.running"),
        extension: t("settings.certChecks.extension"),
        samples: t("settings.certChecks.samples"),
        padi: t("settings.certChecks.padi"),
        report: t("settings.certChecks.report"),
        viewReport: t("settings.certChecks.viewReport"),
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
  );
}
