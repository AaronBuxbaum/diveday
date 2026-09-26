import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX, SectionCard } from "@/components/ui/card";
import { controlClassFor, Field } from "@/components/ui/form";
import { getAccountSecurity, getTotpSecret, listAccountSessions } from "@/db/account-security";
import { userAccounts } from "@/db/schema";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { openSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { isStepUpPurpose, type StepUpPurpose, safeStepUpReturnPath } from "@/lib/security-step-up";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { settingsPaneClass } from "../_components/settings-pane";
import {
  beginTotpEnrollmentAction,
  disableTotpAction,
  enableTotpAction,
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
    "too-many-attempts": { tone: "danger", text: t("settings.security.notice.tooManyAttempts") },
    "security-unavailable": { tone: "danger", text: t("settings.security.notice.unavailable") },
    "security-invalid": { tone: "danger", text: t("settings.security.notice.invalid") },
    "step-up-required": {
      tone: "warning",
      text: t("settings.security.notice.stepUpRequired"),
    },
  });
  const isEnabled = Boolean(security?.totpEnabledAt);
  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        // The one settings sub-page whose eyebrow was not also its way up.
        eyebrowHref={shopPath(shopSlug, "settings")}
        title={t("settings.security.title")}
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
                  className={controlClassFor("md")}
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
                    className={controlClassFor("md")}
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
            // Not an inset note: a step a person works inside (the secret, a
            // code field and Enable), so it takes a group's 16px inset.
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
                    className={controlClassFor("md")}
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
              // One line, Revoke at its end: the device line takes the room
              // Revoke leaves and wraps in it, breaking a long unspaced token
              // (an IPv6 address) rather than running under the button. With
              // `flex-wrap` and no basis to give up, a real user agent pushed
              // Revoke onto a second line of its own, the box 12px above the
              // words and 25px below them (K-448).
              <li
                key={item.id}
                className={`flex items-center gap-3 ${INSET_NOTE_BOX} bg-surface-sunken`}
              >
                {/* Each dot glued to the part before it, so a wrapped line
                    never opens on one (the Print register's K-590). */}
                <span className="min-w-0 flex-1 break-words">
                  {item.userAgent ?? t("settings.security.unknownDevice")}
                  {"\u00a0· "}
                  {item.ipAddress ?? t("settings.security.unknownIp")}
                  {"\u00a0· "}
                  {t("settings.security.lastSeen", {
                    date: formatDateTimeTz(item.updatedAt, locale, shop.timezone),
                  })}
                </span>
                <form action={revokeSessionAction.bind(null, shopSlug)} className="shrink-0">
                  <input type="hidden" name="sessionId" value={item.id} />
                  <SubmitButton
                    pendingLabel={t("settings.security.revoking")}
                    className={buttonClass({
                      variant: "ghost",
                      size: "sm",
                      flush: true,
                      // The row's 12px inset leaves the flush fill 4px from
                      // the sunken row's edge; the outset ring would cross it.
                      className: "focus-visible:focus-ring-inset",
                    })}
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
