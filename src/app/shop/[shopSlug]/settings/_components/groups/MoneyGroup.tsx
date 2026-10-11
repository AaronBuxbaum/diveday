import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import { ChoiceRow, controlClass, Field, FieldGrid, PriceField } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { canAcceptPayments, type getShopStripeAccount } from "@/db/stripe-accounts";
import { formatMoneyScanned } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import {
  disconnectAction,
  refreshAction,
  savePassThroughFeeAction,
  saveTaxAction,
} from "../../money-actions";
import { SettingsRow } from "../SettingsRows";
import { featureRow, MONEY_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

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
}: {
  view: SettingsView;
  canPayments: boolean;
  account: Awaited<ReturnType<typeof getShopStripeAccount>>;
  connectConfigured: boolean;
}) {
  const { shop, shopSlug, t, locale, banner, activeSection, notSet } = view;
  const shopCurrency = toShopCurrency(shop.currency);
  const ready = canAcceptPayments(account);
  // The one exception the Online payments row states at rest, if it has one.
  const stripeWarning = !account
    ? t("settings.main.stripe.summaryNotConnected")
    : account.disconnectedAt
      ? t("settings.main.stripe.summaryDisconnected")
      : ready
        ? null
        : t("settings.main.stripe.notReadyBadge");
  const taxValue = t(
    shop.taxEnabled ? "settings.main.tax.enabledValue" : "settings.main.tax.disabledValue",
  );
  const passThroughFee = parsePassThroughFee(shop.passThroughFee);
  const passThroughValue = passThroughFee ? (
    <FactLine
      facts={[
        { value: passThroughFee.name, wraps: true },
        t("settings.main.passThrough.value", {
          price: formatMoneyScanned(passThroughFee.amountCents, shopCurrency, locale),
        }),
      ]}
    />
  ) : (
    notSet
  );
  return (
    <SettingsGroup group={MONEY_GROUP} label={t(MONEY_GROUP.labelKey)}>
      <InsetGroup>
        {canPayments ? (
          <>
            <SettingsRow
              heading={t("settings.main.tax.heading")}
              value={taxValue}
              description={t("settings.main.tax.description")}
              detail={t("settings.main.tax.detail")}
              sectionId="tax"
              activeSection={activeSection}
            >
              <SectionNotice banner={banner} section="tax" active={activeSection} />
              <form action={saveTaxAction} className="mt-4">
                <ChoiceRow
                  name="taxEnabled"
                  type="checkbox"
                  value="on"
                  defaultChecked={shop.taxEnabled}
                  className="text-sm"
                >
                  {t("settings.main.tax.checkboxLabel")}
                </ChoiceRow>
                <SubmitButton
                  pendingLabel={t("settings.main.tax.submitting")}
                  className={buttonClass({ variant: "secondary", className: "mt-3" })}
                >
                  {t("settings.main.tax.submit")}
                </SubmitButton>
              </form>
            </SettingsRow>

            <SettingsRow
              heading={t("settings.main.passThrough.heading")}
              value={passThroughValue}
              description={t("settings.main.passThrough.description")}
              detail={t("settings.main.passThrough.detail")}
              sectionId="passThrough"
              activeSection={activeSection}
            >
              <SectionNotice banner={banner} section="passThrough" active={activeSection} />
              <form action={savePassThroughFeeAction} className="mt-4">
                <FieldGrid columns={2}>
                  <Field label={t("settings.main.passThrough.nameLabel")}>
                    <input
                      name="passThroughName"
                      defaultValue={passThroughFee?.name ?? ""}
                      maxLength={120}
                      className={controlClass}
                      placeholder={t("settings.main.passThrough.namePlaceholder")}
                    />
                  </Field>
                  <PriceField
                    name="passThroughAmount"
                    label={t("settings.main.passThrough.amountLabel")}
                    hint={t("settings.main.passThrough.amountHint")}
                    cents={passThroughFee?.amountCents ?? null}
                    currency={shopCurrency}
                    locale={locale}
                    copy={forgivingCopy(t)}
                  />
                </FieldGrid>
                <p className="mt-3 text-sm text-muted">
                  {t("settings.main.passThrough.clearHint")}
                </p>
                <SubmitButton
                  pendingLabel={t("settings.main.passThrough.submitting")}
                  className={buttonClass({ variant: "secondary", className: "mt-3" })}
                >
                  {t("settings.main.passThrough.submit")}
                </SubmitButton>
              </form>
            </SettingsRow>

            {featureRow(view, "tips")}

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
