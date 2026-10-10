import type { Metadata } from "next";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { listDivePackages } from "@/db/dive-packages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { MAX_PACKAGE_DIVE_COUNT } from "@/lib/dive-packages";
import { formatMoneyScanned } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { createDivePackageAction, deleteDivePackageAction } from "../../settings/package-actions";
import { divePackageNoticeMessages } from "../../settings/sub-page-notices";

// See the settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Dive packages — DiveDay" };

/**
 * **Ten dives up front** (ADR 20260822-a-package-is-entitlements-not-money):
 * what a shop sells as a block, and what a diver's seat is then drawn from.
 *
 * Its own page rather than a hub row, because the "form" behind that row was a
 * list of packages with a Delete on each and a five-field add form beneath
 * them. Opt-in by presence: a shop that has never defined one sees an empty
 * list and the add form, and nothing anywhere else in the app changes until the
 * first package exists.
 *
 * Tucked under Money's Discounts tab (ADR 20261001-logbook): a package is a
 * price a diver pays up front, beside the codes and deals that lower one. Its
 * way back is its eyebrow. Behind the same payment gate as Discounts,
 * re-checked here rather than inherited — every destination re-checks its own permission
 * server-side, which is what keeps hiding a row a convenience.
 */
export default async function DivePackagesSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { db, session, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManagePaymentSettings,
    // The same refusal Discounts gives: a reader who cannot open the price
    // list is told so on Today, rather than bounced to a page that refuses
    // them for the same reason.
    refusal: { notice: "promos-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const shopPackages = await listDivePackages(db, session.user.shopId);
  const banner = noticeFromParam(notice, divePackageNoticeMessages(t));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("shared.shopNavLinks.promoCodes")}
        eyebrowHref={`/shop/${shopSlug}/promos`}
        title={t("settings.main.divePackages.heading")}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <SectionCard padding="lg">
        {shopPackages.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {shopPackages.map((pkg) => (
              <li
                key={pkg.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-inset border border-border bg-surface p-3"
              >
                <span className="min-w-0">
                  <span className="font-medium">{pkg.name}</span>{" "}
                  <span className="text-sm text-muted">
                    {t("settings.main.divePackages.summary", {
                      dives: pkg.diveCount,
                      price: formatMoneyScanned(pkg.priceCents, shop.currency, locale),
                      scope: t(
                        pkg.scope === "fun_dives"
                          ? "settings.main.divePackages.scopeFunDives"
                          : "settings.main.divePackages.scopeAll",
                      ),
                    })}
                  </span>
                </span>
                {/* Says "Delete", and is soft underneath (ADR
                    20260820-every-delete-is-soft). No sentence explains that
                    the dives somebody already bought survive: reversibility is
                    a promise we keep, not a concept the reader holds — and here
                    the softness is load-bearing rather than conventional,
                    because the entitlements reference this row. */}
                <form action={deleteDivePackageAction}>
                  <input type="hidden" name="packageId" value={pkg.id} />
                  <SubmitButton
                    pendingLabel={t("settings.main.divePackages.deleting")}
                    className={buttonClass({ variant: "danger-ghost", size: "sm" })}
                  >
                    {t("settings.main.divePackages.delete")}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <FieldGrid
          as="form"
          action={createDivePackageAction}
          columns={2}
          className={shopPackages.length > 0 ? "mt-6" : undefined}
        >
          <Field label={t("settings.main.divePackages.nameLabel")}>
            <input name="name" required maxLength={80} className={controlClass} />
          </Field>
          <Field label={t("settings.main.divePackages.diveCountLabel")}>
            <input
              name="diveCount"
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={MAX_PACKAGE_DIVE_COUNT}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <Field label={t("settings.main.divePackages.priceLabel")}>
            <input
              name="priceDollars"
              type="number"
              inputMode="decimal"
              required
              min={1}
              step="0.01"
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <Field
            label={t("settings.main.divePackages.validityLabel")}
            description={t("settings.main.divePackages.validityDescription")}
          >
            <DateField name="validUntil" className="tabular-nums" />
          </Field>
          <Field label={t("settings.main.divePackages.scopeLabel")}>
            <select name="scope" defaultValue="fun_dives" className={controlClass}>
              <option value="all">{t("settings.main.divePackages.scopeAll")}</option>
              <option value="fun_dives">{t("settings.main.divePackages.scopeFunDives")}</option>
            </select>
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("settings.main.divePackages.submitting")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("settings.main.divePackages.submit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </SectionCard>
    </main>
  );
}
