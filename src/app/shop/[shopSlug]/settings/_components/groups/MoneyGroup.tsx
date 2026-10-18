import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { InsetGroup } from "@/components/ui/ledger";
import { canAcceptPayments, type getShopStripeAccount } from "@/db/stripe-accounts";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { disconnectAction, refreshAction } from "../../money-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { MONEY_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";
import { passThroughRow } from "./money-rows";

function StatusRow({
  label,
  ok,
  yesLabel,
  notYetLabel,
}: {
  label: string;
  ok: boolean;
  yesLabel: string;
  notYetLabel: string;
}) {
  // Badges mark the exceptional state (principle 9): the settled "Yes" reads
  // as quiet muted text, so a warning pill in this list means something the
  // moment it appears.
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{label}</span>
      {ok ? (
        <span className="text-muted">{yesLabel}</span>
      ) : (
        <Badge tone="warning">{notYetLabel}</Badge>
      )}
    </li>
  );
}

/** The Money group: tax, a pass-through fee, tips and the Stripe connection. */
export function MoneyGroup({
  view,
  canPayments,
  account,
  connectConfigured,
  canViewBilling,
}: {
  view: SettingsView;
  canPayments: boolean;
  account: Awaited<ReturnType<typeof getShopStripeAccount>>;
  connectConfigured: boolean;
  canViewBilling: boolean;
}) {
  const { shopSlug, t, banner, activeSection } = view;
  const ready = canAcceptPayments(account);
  // The one exception the Online payments row states at rest, if it has one.
  const stripeWarning = !account
    ? t("settings.main.stripe.summaryNotConnected")
    : account.disconnectedAt
      ? t("settings.main.stripe.summaryDisconnected")
      : ready
        ? null
        : t("settings.main.stripe.notReadyBadge");
  return (
    <SettingsGroup group={MONEY_GROUP} label={t(MONEY_GROUP.labelKey)}>
      <InsetGroup>
        {canPayments ? (
          <>
            {passThroughRow(view)}

            {/* The one row that opens itself: an unconnected or half-onboarded
              Stripe account is the difference between taking bookings online
              and not, so the moment it needs a person it surfaces — and once
              it is quietly working it folds away like everything else. */}
            <SettingsRow
              heading={t("settings.main.stripe.rowHeading")}
              value={
                stripeWarning ? (
                  <Badge tone="warning">{stripeWarning}</Badge>
                ) : account ? (
                  t("settings.main.stripe.accountEnding", {
                    last6: account.stripeAccountId.slice(-6),
                  })
                ) : null
              }
              // A warning pill keeps to the heading's line on a phone; the
              // account number is a sentence and stacks like any other value.
              valuePlacement={stripeWarning ? "inline" : "stack"}
              sectionId="stripe"
              activeSection={activeSection}
            >
              <SectionNotice banner={banner} section="stripe" active={activeSection} />
              {!account ? (
                connectConfigured ? (
                  // A plain <a>, not <Link>: this route 302s to Stripe's
                  // OAuth authorize URL, and Next's client-side navigation
                  // would follow that redirect via fetch — a cross-origin
                  // request Stripe's CORS policy rejects. A full
                  // navigation handles the redirect natively.
                  <a
                    href={`/shop/${shopSlug}/settings/connect`}
                    className={buttonClass({ className: "mt-4" })}
                  >
                    {t("settings.main.stripe.connect")}
                  </a>
                ) : (
                  <div className="mt-4">
                    <ShopNotice tone="warning" role="status">
                      {t("settings.main.stripe.notConfiguredWarning", { email: SUPPORT_EMAIL })}
                    </ShopNotice>
                  </div>
                )
              ) : (
                <div className="mt-3">
                  <p className="text-sm text-muted">
                    {t("settings.main.stripe.accountEnding", {
                      last6: account.stripeAccountId.slice(-6),
                    })}
                  </p>
                  <ul className="mt-4 divide-y divide-border">
                    <StatusRow
                      label={t("settings.main.stripe.chargesEnabled")}
                      ok={account.chargesEnabled}
                      yesLabel={t("settings.main.stripe.statusYes")}
                      notYetLabel={t("settings.main.stripe.statusNotYet")}
                    />
                    <StatusRow
                      label={t("settings.main.stripe.payoutsEnabled")}
                      ok={account.payoutsEnabled}
                      yesLabel={t("settings.main.stripe.statusYes")}
                      notYetLabel={t("settings.main.stripe.statusNotYet")}
                    />
                    <StatusRow
                      label={t("settings.main.stripe.onboardingSubmitted")}
                      ok={account.detailsSubmitted}
                      yesLabel={t("settings.main.stripe.statusYes")}
                      notYetLabel={t("settings.main.stripe.statusNotYet")}
                    />
                  </ul>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    {account.disconnectedAt ? (
                      connectConfigured ? (
                        // A plain <a>, not <Link>: this route 302s to
                        // Stripe's OAuth authorize URL, and Next's
                        // client-side navigation would follow that
                        // redirect via fetch — a cross-origin request
                        // Stripe's CORS policy rejects. A full navigation
                        // handles the redirect natively.
                        <a href={`/shop/${shopSlug}/settings/connect`} className={buttonClass()}>
                          {t("settings.main.stripe.reconnect")}
                        </a> // i18n-exempt: JSX ternary punctuation below, not copy — scanner false positive.
                      ) : null
                    ) : (
                      <>
                        <form action={refreshAction}>
                          <SubmitButton
                            pendingLabel={t("settings.main.stripe.refreshing")}
                            className={buttonClass({
                              variant: "secondary",
                            })}
                          >
                            {t("settings.main.stripe.refresh")}
                          </SubmitButton>
                        </form>
                        <form action={disconnectAction}>
                          <SubmitButton
                            pendingLabel={t("settings.main.stripe.disconnecting")}
                            className={buttonClass({ variant: "danger" })}
                          >
                            {t("settings.main.stripe.disconnect")}
                          </SubmitButton>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              )}
            </SettingsRow>
          </>
        ) : null}

        {/* What DiveDay itself costs: the trial, a free term, the card on
          file. Its own page, owner only (ADR 20261007-subscription-billing).
          Purely informational: nothing locks when a trial or a payment lapses.
          It sat in an Account group beside a staffer's own password; it is the
          shop's subscription, so it lives with the shop's money. */}
        {canViewBilling ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/billing`}
            heading={t("billing.title")}
          />
        ) : null}
      </InsetGroup>

      {canPayments ? null : (
        <div className="mt-6">
          <ShopNotice tone="neutral" role="status">
            {t("settings.main.paymentsGate.notice")}
          </ShopNotice>
        </div>
      )}
    </SettingsGroup>
  );
}
