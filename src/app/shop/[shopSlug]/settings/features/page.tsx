import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, FormStatus, StickyFormActions } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import { assistDarkReasonFor } from "@/db/assists";
import {
  canPersonManagePaymentSettings,
  canPersonManageShopSettings,
  canPersonManageStaffAccounts,
} from "@/db/authz";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { shopOffers } from "@/lib/shop-features";
import { type NoticeMessages, noticeFromParam } from "@/lib/staff-notices";
import { settingsPaneClass } from "../_components/settings-pane";
import { saveFeaturesAction } from "./actions";
import {
  darkWhileOnKey,
  FEATURE_GROUPS,
  FEATURE_ROWS,
  type FeatureRow,
  type FeatureRowGate,
  isOptionalFeature,
  REPLY_NOTES_ROW,
} from "./feature-rows";
import { ReplyNotesForm } from "./ReplyNotesForm";
import { ROWS_FIELD, switchField } from "./save-plan";

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
          className="text-sm"
        >
          <span className="block font-medium">{t("boats.shoreDivingLabel")}</span>
          <span className="block text-xs text-muted">{t("boats.shoreDivingDescription")}</span>
        </ChoiceRow>
        <ChoiceRow
          name="hasPoolDiving"
          type="checkbox"
          defaultChecked={shop.hasPoolDiving}
          className="text-sm"
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
          description: t("settings.main.tax.description"),
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
    <ChoiceRow
      name={switchField(row.id)}
      type="checkbox"
      defaultChecked={isOn(shop, row)}
      className="text-sm"
    >
      <span className="block font-medium">{words.label}</span>
      <span className="block text-xs text-muted">{words.description}</span>
    </ChoiceRow>
  );
}

/**
 * **Features** — every on/off switch a shop owns, in one list (issue #2814).
 * Nine switches were drawn in seven places; each is a row here, under a small
 * group heading, with its own gate (`feature-rows.ts`), a sentence and a switch, and a row that has value
 * settings of its own links to them once it is on. Off hides the feature and
 * deletes nothing it wrote (`shop-features.ts`).
 *
 * **One form, one Save** (Aaron 2026-10-23): a staffer flips what they want
 * and saves once. Each drawn row posts its id in `rows`, so the save writes
 * those rows and leaves every row this reader was not shown as it was. The
 * list is taller than a screen, so Save rides the bottom edge
 * (`StickyFormActions`) with the outcome beside it. The notes for AI, drawn
 * under the AI row while assists are lit, save with the same Save.
 */
export default async function FeaturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
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
  // Never the reason the page fails: a read that throws shows no line and no notes box.
  const dark = await assistDarkReasonFor(db, shop.id).catch(() => "unread" as const);
  const darkKey = dark === "unread" ? null : darkWhileOnKey(dark);
  const base = `/shop/${session.user.shopSlug}`;

  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`${base}/settings`}
        title={t("settings.features.title")}
      />
      <form action={saveFeaturesAction} className="space-y-8">
        {FEATURE_GROUPS.map((group) => {
          const rows = FEATURE_ROWS.filter((row) => row.group === group && gates.has(row.gate));
          if (rows.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`features-${group}`} className="space-y-3">
              <GroupLabel as="h2" id={`features-${group}`}>
                {t(`settings.features.groups.${group}`)}
              </GroupLabel>
              {/* Plain rows on hairlines, no card (visual review 2026-10-24,
                  A24): a switch, its label and one line of what it turns on. */}
              <ul className="divide-y divide-border border-y border-border">
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <li id={row.id} className="scroll-mt-8 space-y-2 py-3">
                      <input type="hidden" name={ROWS_FIELD} value={row.id} />
                      {switches(shop, row, t)}
                      {row.id === "claudeSuggestions" && darkKey && isOn(shop, row) ? (
                        <p className="text-xs text-warning">{t(darkKey)}</p>
                      ) : null}
                      {row.link && linkShown(shop, row) ? (
                        <Link
                          href={`${base}${row.link.path}`}
                          className="inline-block text-sm font-medium text-primary hover:underline"
                        >
                          {t(row.link.labelKey)}
                        </Link>
                      ) : null}
                    </li>
                    {row.id === "claudeSuggestions" && dark === null ? (
                      <li id={REPLY_NOTES_ROW} className="scroll-mt-8 space-y-3 py-3">
                        <ReplyNotesForm notes={shop.replyNotes} t={t} />
                      </li>
                    ) : null}
                  </Fragment>
                ))}
              </ul>
            </section>
          );
        })}
        <StickyFormActions>
          <SubmitButton pendingLabel={t("settings.main.features.saving")} className={buttonClass()}>
            {t("settings.main.features.save")}
          </SubmitButton>
          <FormStatus tone={banner?.tone} occurrenceKey={notice}>
            {banner?.text}
          </FormStatus>
        </StickyFormActions>
      </form>
    </main>
  );
}
