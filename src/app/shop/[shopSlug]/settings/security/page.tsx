import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import { getAccountSecurity, getTotpSecret, listAccountSessions } from "@/db/account-security";
import { userAccounts } from "@/db/schema";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { openSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { isStepUpPurpose, type StepUpPurpose, safeStepUpReturnPath } from "@/lib/security-step-up";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  beginTotpEnrollmentAction,
  disableTotpAction,
  enableTotpAction,
  revokeAllSessionsAction,
  revokeSessionAction,
  verifyStepUpAction,
} from "./actions";

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
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, session.user.personId))
    .limit(1);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const purpose: StepUpPurpose | null = isStepUpPurpose(query.purpose) ? query.purpose : null;
  const returnTo = safeStepUpReturnPath(shopSlug, query.returnTo);
  if (!account) return null;
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
      if (record.accountId !== account.id || !Array.isArray(record.codes)) return [] as string[];
      return record.codes.filter(
        (code): code is string => typeof code === "string" && /^[A-Z2-7]{10}$/.test(code),
      );
    } catch {
      return [] as string[];
    }
  })();
  const [security, sessions, secret] = await Promise.all([
    getAccountSecurity(db, account.id),
    listAccountSessions(db, account.id),
    getTotpSecret(db, account.id),
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
    "security-unavailable": { tone: "danger", text: t("settings.security.notice.unavailable") },
    "security-invalid": { tone: "danger", text: t("settings.security.notice.invalid") },
    "step-up-required": {
      tone: "warning",
      text: t("settings.security.notice.stepUpRequired"),
    },
  });
  const isEnabled = Boolean(security?.totpEnabledAt);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.security.eyebrow")}
        title={t("settings.security.title")}
        description={t("settings.security.description")}
      />
      {notice ? (
        <div className="mt-6">
          <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
            {notice.text}
          </ShopNotice>
        </div>
      ) : null}
      {purpose && returnTo && isEnabled ? (
        <SectionCard
          className="mt-6"
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
      <div className="mt-8 space-y-6">
        <SectionCard
          title={t("settings.security.twoFactorHeading")}
          description={t("settings.security.twoFactorDescription")}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={isEnabled ? "success" : "warning"}>
              {isEnabled ? t("settings.security.enabled") : t("settings.security.notEnabled")}
            </Badge>
            {!isEnabled ? (
              <form action={beginTotpEnrollmentAction.bind(null, shopSlug)}>
                <SubmitButton
                  pendingLabel={t("settings.security.starting")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.security.start")}
                </SubmitButton>
              </form>
            ) : (
              <form
                action={disableTotpAction.bind(null, shopSlug)}
                className="flex flex-wrap items-end gap-3"
              >
                <Field label={t("settings.security.codeLabel")}>
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
                  pendingLabel={t("settings.security.disabling")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.security.disable")}
                </SubmitButton>
              </form>
            )}
          </div>
          {secret && !isEnabled ? (
            <div className="mt-4 rounded-lg bg-surface-sunken p-4 text-sm">
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
            </div>
          ) : null}
          {recoveryCodes.length > 0 ? (
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
          ) : null}
        </SectionCard>
        <SectionCard
          title={t("settings.security.sessionsHeading")}
          description={t("settings.security.sessionsDescription")}
        >
          <ul className="space-y-2">
            {sessions.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
              >
                <span>
                  {item.userAgent ?? t("settings.security.unknownDevice")} ·{" "}
                  {item.ipAddress ?? t("settings.security.unknownIp")} ·{" "}
                  {t("settings.security.lastSeen", {
                    date: formatDateTimeTz(item.updatedAt, locale, shop.timezone),
                  })}
                </span>
                <form action={revokeSessionAction.bind(null, shopSlug)}>
                  <input type="hidden" name="sessionId" value={item.id} />
                  <SubmitButton
                    pendingLabel={t("settings.security.revoking")}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                  >
                    {t("settings.security.revoke")}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
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
