import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import { getAccountSecurity, getTotpSecret, listAccountSessions } from "@/db/account-security";
import { getAccountIdForPerson } from "@/db/user-accounts";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  isCurrentAccountSession,
  sessionDeviceLabel,
  sessionUserAgentDetails,
} from "@/lib/account-session-device";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz, formatRelativeDay } from "@/lib/format";
import { openSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { isStepUpPurpose, type StepUpPurpose, safeStepUpReturnPath } from "@/lib/security-step-up";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS, staffDestination } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { settingsPaneClass } from "../_components/settings-pane";
import { AccountSessionsList } from "./_components/AccountSessionsList";
import {
  beginTotpEnrollmentAction,
  disableTotpAction,
  enableTotpAction,
  refreshRecoveryCodesAction,
  revokeAllSessionsAction,
  revokeSessionAction,
  verifyStepUpAction,
} from "./actions";

// This page reads live account security state, but the settings segment's
// loading boundary still provides the static shell while those reads resolve.
export const instant = true;

/**
 * Static, like every other page under `/shop/**` (issue 1569).
 *
 * This was the tree's one staff `generateMetadata`, and it resolved the shop
 * **by the URL slug** to negotiate a locale for the title — a read of a tenant
 * row before anyone had shown the reader owns it. The body below is gated
 * properly by `requireShopSurface`, so nothing of that shop rendered; what
 * leaked was its configured language, in a `<title>`, to anyone who could
 * guess a slug. Small, and not a reason to keep the only exception in the
 * subtree.
 *
 * The English title is what the other forty-six staff pages do — route
 * metadata is a browser tab and a bookmark, not a surface, so the locale it
 * cost a tenant read to negotiate was never worth the negotiation.
 */
export const metadata: Metadata = { title: "Account security — DiveDay" };

export default async function SecurityPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; purpose?: string; returnTo?: string }>;
}) {
  const { shopSlug } = await params;
  const query = await searchParams;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const accountId = await getAccountIdForPerson(db, session.user.personId);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const purpose: StepUpPurpose | null = isStepUpPurpose(query.purpose) ? query.purpose : null;
  const returnTo = safeStepUpReturnPath(shopSlug, query.returnTo);
  if (!accountId) return null;
  const recoveryCodes = await (async () => {
    const value = (await cookies()).get("diveday_totp_recovery_codes")?.value;
    const key = secretKeyFromEnvironment();
    if (!value || key.status !== "ok") return [] as string[];
    const opened = openSecret(value, key.key);
    if (!opened) return [] as string[];
    try {
      const parsed: unknown = JSON.parse(opened);
      if (!parsed || typeof parsed !== "object") return [] as string[];
      const record = parsed as { accountId?: unknown; codes?: unknown };
      if (record.accountId !== accountId || !Array.isArray(record.codes)) return [] as string[];
      return record.codes.filter(
        (code): code is string => typeof code === "string" && /^[A-Z2-7]{10}$/.test(code),
      );
    } catch {
      return [] as string[];
    }
  })();
  const [security, sessions, secret] = await Promise.all([
    getAccountSecurity(db, accountId),
    listAccountSessions(db, accountId),
    getTotpSecret(db, accountId),
  ]);
  const notice = noticeFromParam<{ tone: NoticeTone; text: string }>(query.notice, {
    "enrollment-started": {
      tone: "success",
      text: t("settings.security.notice.enrollmentStarted"),
    },
    "two-factor-enabled": { tone: "success", text: t("settings.security.notice.enabled") },
    "two-factor-disabled": { tone: "success", text: t("settings.security.notice.disabled") },
    "session-revoked": { tone: "success", text: t("settings.security.notice.sessionRevoked") },
    "code-invalid": { tone: "danger", text: t("settings.security.notice.codeInvalid") },
    "too-many-attempts": { tone: "danger", text: t("settings.security.notice.tooManyAttempts") },
    "security-unavailable": { tone: "danger", text: t("settings.security.notice.unavailable") },
    "security-invalid": { tone: "danger", text: t("settings.security.notice.invalid") },
    "step-up-required": {
      tone: "warning",
      text: t("settings.security.notice.stepUpRequired"),
    },
  });
  const isEnabled = Boolean(security?.totpEnabledAt);
  const now = nowDate();
  const sessionRows = sessions.map((item) => {
    const device = sessionDeviceLabel(item.userAgent);
    const deviceLabel =
      device.browser || device.os
        ? [
            device.browser ? t(`settings.security.browser.${device.browser}`) : null,
            device.os ? t(`settings.security.os.${device.os}`) : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : t("settings.security.unknownDevice");
    return {
      id: item.id,
      deviceLabel,
      isCurrent: isCurrentAccountSession(session.user.sessionId, item.id),
      lastSeenAt: item.updatedAt,
      lastSeen: t("settings.security.lastSeen", {
        date: formatDateTimeTz(item.updatedAt, locale, shop.timezone),
      }),
      userAgent: sessionUserAgentDetails(item.userAgent),
      ipAddress: item.ipAddress,
    };
  });
  const recoveryCodesPanel =
    recoveryCodes.length > 0 ? (
      <div className="mt-5 rounded-lg border border-border bg-surface-sunken p-4 text-sm">
        <p className="font-medium">{t("settings.security.recoveryHeading")}</p>
        <p className="mt-1 text-muted">{t("settings.security.recoveryDescription")}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {recoveryCodes.map((code) => (
            <code
              key={code}
              className="rounded bg-background px-2 py-1 text-center font-mono"
            >
              {code}
            </code>
          ))}
        </div>
        <p className="mt-3 text-muted">{t("settings.security.recoveryWarning")}</p>
      </div>
    ) : null;
  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        // The one settings sub-page whose eyebrow was not also its way up.
        eyebrowHref={shopPath(shopSlug, "settings")}
        title={t("settings.security.title")}
        // **The account's other two pages** (visual review 2026-10-24, A42):
        // the identity menu's one "Account settings" row lands here, so the
        // reader's calendar feed and email are a tap away from it.
        meta={
          <nav aria-label={t("settings.security.title")} className="flex flex-wrap gap-x-4">
            {(["calendarFeed", "emailSettings"] as const).map((id) => (
              <Link
                key={id}
                href={`${shopPath(shopSlug)}${staffDestination(id).suffix}`}
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {t(STAFF_DESTINATION_LABEL_KEYS[id])}
              </Link>
            ))}
          </nav>
        }
      />
      {notice ? <StaffNoticeBanner tone={notice.tone}>{notice.text}</StaffNoticeBanner> : null}
      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any card
          (docs/design/forms-and-controls.md). The cards stood 24px apart,
          and the step-up card and the notice hung `mt-6` of their own (K-521). */}
      <div className="space-y-10">
        {purpose && returnTo && isEnabled ? (
          <SectionCard
            title={t("settings.security.stepUpHeading")}
            description={t("settings.security.stepUpDescription")}
          >
            <form
              action={verifyStepUpAction.bind(null, shopSlug)}
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="purpose" value={purpose} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Field
                label={t("settings.security.stepUpCodeLabel")}
                hint={t("settings.security.stepUpCodeHint")}
              >
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9A-Za-z-]{6,32}"
                  maxLength={32}
                  required
                  className={controlClass}
                />
              </Field>
              <SubmitButton
                pendingLabel={t("settings.security.stepUpVerifying")}
                className={buttonClass()}
              >
                {t("settings.security.stepUpVerify")}
              </SubmitButton>
            </form>
          </SectionCard>
        ) : null}
        <SectionCard
          title={t("settings.security.twoFactorHeading")}
          description={t("settings.security.twoFactorDescription")}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={isEnabled ? "success" : "warning"}>
              {isEnabled ? t("settings.security.enabled") : t("settings.security.notEnabled")}
            </Badge>
            {!isEnabled ? (
              <details open={Boolean(secret)} className="basis-full sm:basis-auto">
                <summary
                  className={buttonClass({
                    variant: "secondary",
                    className: "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
                  })}
                >
                  {t("settings.security.setupDisclosure")}
                </summary>
                {!secret ? (
                  <form
                    action={beginTotpEnrollmentAction.bind(null, shopSlug)}
                    className="mt-3"
                  >
                    <SubmitButton
                      pendingLabel={t("settings.security.starting")}
                      className={buttonClass({ variant: "secondary" })}
                    >
                      {t("settings.security.start")}
                    </SubmitButton>
                  </form>
                ) : (
                  <div className="mt-3 rounded-lg bg-surface-sunken p-4 text-sm">
                    <p>{t("settings.security.secretLabel")}</p>
                    <code className="mt-1 block break-all font-mono">{secret}</code>
                    <form
                      action={enableTotpAction.bind(null, shopSlug)}
                      className="mt-4 flex flex-wrap items-end gap-3"
                    >
                      <Field label={t("settings.security.codeLabel")}>
                        <input
                          name="code"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          required
                          className={controlClass}
                        />
                      </Field>
                      <SubmitButton
                        pendingLabel={t("settings.security.enabling")}
                        className={buttonClass()}
                      >
                        {t("settings.security.enable")}
                      </SubmitButton>
                    </form>
                    {recoveryCodesPanel}
                  </div>
                )}
              </details>
            ) : (
              <form
                action={disableTotpAction.bind(null, shopSlug)}
                className="flex basis-full flex-wrap items-end gap-3"
              >
                <Field label={t("settings.security.verifiedCodeLabel")}>
                  <input
                    name="code"
                    autoComplete="one-time-code"
                    pattern="[0-9A-Za-z-]{6,32}"
                    maxLength={32}
                    required
                    className={controlClass}
                  />
                </Field>
                <SubmitButton
                  formAction={refreshRecoveryCodesAction.bind(null, shopSlug)}
                  pendingLabel={t("settings.security.refreshingRecoveryCodes")}
                  className={buttonClass()}
                >
                  {t("settings.security.refreshRecoveryCodes")}
                </SubmitButton>
                <SubmitButton
                  pendingLabel={t("settings.security.disabling")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.security.disable")}
                </SubmitButton>
              </form>
            )}
          </div>
          {isEnabled ? recoveryCodesPanel : null}
        </SectionCard>
        <SectionCard
          title={t("settings.security.sessionsHeading")}
          description={t("settings.security.sessionsDescription")}
        >
          <AccountSessionsList
            rows={sessionRows}
            shopSlug={shopSlug}
            revokeAction={revokeSessionAction}
            labels={{
              thisDevice: t("settings.security.sessions.thisDevice"),
              includesThisDevice: t("settings.security.sessions.includesThisDevice"),
              browserLine: (browser) => t("settings.security.browserLine", { browser }),
              networkLine: (network) => t("settings.security.networkLine", { network }),
              unknownDevice: t("settings.security.unknownDevice"),
              unknownIp: t("settings.security.unknownIp"),
              revoke: t("settings.security.revoke"),
              revoking: t("settings.security.revoking"),
              group: (count, lastSeenAt) =>
                t("settings.security.sessions.group", {
                  count,
                  when: formatRelativeDay(lastSeenAt, now, locale, shop.timezone),
                }),
              showSessions: t("settings.security.sessions.showSessions"),
              showAll: t("settings.security.sessions.showAll"),
            }}
          />
          {/* Once, under the list, secondary. It signs out every session,
              this one included, and its words say so. */}
          <form action={revokeAllSessionsAction.bind(null, shopSlug)} className="mt-4">
            <SubmitButton
              pendingLabel={t("settings.security.revokingAll")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("settings.security.revokeAll")}
            </SubmitButton>
          </form>
        </SectionCard>
      </div>
    </main>
  );
}
