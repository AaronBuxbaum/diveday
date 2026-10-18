import type { Metadata } from "next";
import Link from "next/link";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoiceRow, FieldActions, FieldGrid } from "@/components/ui/form";
import {
  canPersonManagePaymentSettings,
  canPersonManageShopSettings,
  canPersonManageStaffAccounts,
} from "@/db/authz";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { shopOffers } from "@/lib/shop-features";
import { type NoticeMessages, noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { settingsPaneClass } from "../_components/settings-pane";
import { saveFeatureAction } from "./actions";
import {
  FEATURE_ROWS,
  type FeatureRow,
  type FeatureRowGate,
  isOptionalFeature,
} from "./feature-rows";

export const instant = true;

export const metadata: Metadata = { title: "Features — DiveDay" };

function noticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "feature-saved": { tone: "success", text: t("settings.main.features.saved") },
    "diving-options-none": { tone: "danger", text: t("boats.divingOptionsNone") },
  };
}

type Shop = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

/** Whether the row's switch (or, for diving, its first) is on. */
function isOn(shop: Shop, row: FeatureRow): boolean {
  if (isOptionalFeature(row.id)) return shopOffers(shop, row.id);
  if (row.id === "tax") return shop.taxEnabled;
  if (row.id === "crewSchedule") return shop.crewScheduleEnabled;
  return shop.hasBoatDiving || shop.hasShoreDiving || shop.hasPoolDiving;
}

/** Whether the row's value settings are worth a link: the feature is in use. */
function linkShown(shop: Shop, row: FeatureRow): boolean {
  return row.id === "divingOptions" ? shop.hasBoatDiving : isOn(shop, row);
}

/**
 * The switch or switches of one row: the sentence is the checkbox's own label.
 * A function rather than a component, so the page's tests read the inputs in
 * its element tree unrendered.
 */
function switches(shop: Shop, row: FeatureRow, t: StaffTranslator) {
  if (row.id === "divingOptions") {
    return (
      <>
        <ChoiceRow
          name="hasBoatDiving"
          type="checkbox"
          defaultChecked={shop.hasBoatDiving}
          className="text-sm"
        >
          <span className="block font-medium">{t("boats.boatDivingLabel")}</span>
          <span className="block text-xs text-muted">{t("boats.boatDivingDescription")}</span>
        </ChoiceRow>
        <ChoiceRow
          name="hasShoreDiving"
          type="checkbox"
          defaultChecked={shop.hasShoreDiving}
          className="mt-2 text-sm"
        >
          <span className="block font-medium">{t("boats.shoreDivingLabel")}</span>
          <span className="block text-xs text-muted">{t("boats.shoreDivingDescription")}</span>
        </ChoiceRow>
        <ChoiceRow
          name="hasPoolDiving"
          type="checkbox"
          defaultChecked={shop.hasPoolDiving}
          className="mt-2 text-sm"
        >
          <span className="block font-medium">{t("boats.poolDivingLabel")}</span>
          <span className="block text-xs text-muted">{t("boats.poolDivingDescription")}</span>
        </ChoiceRow>
      </>
    );
  }
  const words =
    row.id === "tax"
      ? {
          label: t("settings.main.tax.checkboxLabel"),
          description: `${t("settings.main.tax.description")} ${t("settings.main.tax.detail")}`,
        }
      : row.id === "crewSchedule"
        ? {
            label: t("settings.main.crewSchedule.label"),
            description: t("settings.main.crewSchedule.description"),
          }
        : {
            label: t(`settings.main.features.${row.id}.label`),
            description: t(`settings.main.features.${row.id}.description`),
          };
  return (
    <ChoiceRow name="enabled" type="checkbox" defaultChecked={isOn(shop, row)} className="text-sm">
      <span className="block font-medium">{words.label}</span>
      <span className="block text-xs text-muted">{words.description}</span>
    </ChoiceRow>
  );
}

/**
 * **Features** — every on/off switch a shop owns, in one list (issue #2814).
 * Nine switches were drawn in seven places; each is a row here with its own
 * gate (`feature-rows.ts`), a sentence and a switch, and a row that has value
 * settings of its own links to them once it is on. Off hides the feature and
 * deletes nothing it wrote (`shop-features.ts`).
 */
export default async function FeaturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; saved?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice, saved } = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const gates = new Set<FeatureRowGate>(["settings"]);
  if (await canPersonManagePaymentSettings(db, session.user.shopId, session.user.personId)) {
    gates.add("payments");
  }
  if (await canPersonManageStaffAccounts(db, session.user.shopId, session.user.personId)) {
    gates.add("team");
  }
  const banner = noticeFromParam(notice, noticeMessages(t));
  const base = `/shop/${session.user.shopSlug}`;

  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice", "saved"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`${base}/settings`}
        title={t("settings.features.title")}
      />
      <SectionCard padding="none">
        <ul className="divide-y divide-border">
          {FEATURE_ROWS.filter((row) => gates.has(row.gate)).map((row) => (
            <li key={row.id} id={row.id} className="scroll-mt-8 p-5 sm:p-6">
              <FieldGrid as="form" action={saveFeatureAction} columns={1}>
                <input type="hidden" name="row" value={row.id} />
                <h2 className="text-sm font-semibold">{t(row.headingKey)}</h2>
                {switches(shop, row, t)}
                {banner && saved === row.id ? (
                  <ShopNotice tone={banner.tone} role={noticeRole(banner.tone)}>
                    {banner.text}
                  </ShopNotice>
                ) : null}
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("settings.main.features.saving")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("settings.main.features.save")}
                  </SubmitButton>
                  {row.link && linkShown(shop, row) ? (
                    <Link
                      href={`${base}${row.link.path}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {t(row.link.labelKey)}
                    </Link>
                  ) : null}
                </FieldActions>
              </FieldGrid>
            </li>
          ))}
        </ul>
      </SectionCard>
    </main>
  );
}
