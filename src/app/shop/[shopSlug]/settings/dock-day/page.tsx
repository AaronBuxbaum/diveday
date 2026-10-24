import type { Metadata } from "next";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoiceRow, FormStatus, StickyFormActions } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import { canPersonManageShopSettings } from "@/db/authz";
import { listSiteBottomTimeOverrides } from "@/db/dive-sites";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DeskPayment } from "@/lib/desk-payment";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import {
  CrewLeadFields,
  DockDayFields,
  TurnaroundFields,
} from "../_components/editors/BoatsSitesEditors";
import { SettingsEditorPage } from "../_components/SettingsEditorPage";
import { dockDayNoticeMessages } from "../sub-page-notices";
import { saveDockDayAction } from "./actions";

/** The four answers, in the order a shop most often has them; "" is "Don't say". */
const DESK_PAYMENT_CHOICES = [
  { code: "card_and_cash", label: "settings.main.deskPayment.card_and_cash" },
  { code: "card", label: "settings.main.deskPayment.card" },
  { code: "cash", label: "settings.main.deskPayment.cash" },
  { code: "", label: "settings.main.deskPayment.none" },
] as const satisfies ReadonlyArray<{ code: DeskPayment | ""; label: string }>;

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Dock-day rhythm — DiveDay" };

/**
 * The six minute amounts the dock day is built from and the beats they produce
 * beneath, with the sites whose own bottom time overrides the shop-wide one;
 * then the crew's lead time, the turnaround and how divers pay at the desk.
 *
 * **One form, one Save** (visual review 2026-10-24, A01; Aaron 2026-10-23):
 * the four sections were four forms with four Saves. They are headed groups of
 * one form now, and the Save rides the bottom edge (`StickyFormActions`, as
 * Features does) with the outcome beside it (`saveDockDayAction`).
 *
 * A row on the settings hub until #1854: a form this long is a page wearing a
 * disclosure, so the hub lists it as a door and this is what the door opens.
 * The action answers here with a plain `?notice=` (`sub-page-notices.ts`).
 */
export default async function DockDaySettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // A site carrying its own `expectedBottomTimeMinutes` overrides the
  // shop-wide figure for any dive that visits it, and the preview is drawn
  // from the shop-wide figure alone. Empty for a shop that has overridden
  // nothing, and then the preview says nothing extra.
  const siteBottomTimeOverrides = await listSiteBottomTimeOverrides(db, shop.id);

  const banner = noticeFromParam(notice, dockDayNoticeMessages(t));

  return (
    <SettingsEditorPage
      shopSlug={shopSlug}
      t={t}
      title={t("settings.main.dockCall.heading")}
      description={t("settings.main.dockCall.description")}
      // The outcome sits beside Save, in the sticky row, not above the form;
      // and no card: the sticky row needs the pane's own edges.
      banner={undefined}
      unframed
    >
      <form action={saveDockDayAction} className="space-y-8">
        <section aria-labelledby="dock-day-divers" className="space-y-3">
          <GroupLabel as="h2" id="dock-day-divers">
            {t("settings.dockDay.groups.divers")}
          </GroupLabel>
          <DockDayFields
            shop={shop}
            shopSlug={shopSlug}
            t={t}
            siteBottomTimeOverrides={siteBottomTimeOverrides}
          />
        </section>
        <section aria-labelledby="dock-day-crew" className="space-y-3">
          <GroupLabel as="h2" id="dock-day-crew">
            {t("settings.dockDay.groups.crew")}
          </GroupLabel>
          <CrewLeadFields shop={shop} t={t} />
        </section>
        <section aria-labelledby="dock-day-turnaround" className="space-y-3">
          <GroupLabel as="h2" id="dock-day-turnaround">
            {t("settings.dockDay.groups.turnaround")}
          </GroupLabel>
          <TurnaroundFields shop={shop} t={t} />
        </section>
        {/* How divers pay at the desk (fifth-loop ideas, item 21): one sentence
            after every "due at the shop", so a visitor brings cash or a card. */}
        <section aria-labelledby="dock-day-desk" className="space-y-3">
          <GroupLabel as="h2" id="dock-day-desk">
            {t("settings.dockDay.groups.desk")}
          </GroupLabel>
          <ChoiceFieldset legend={t("settings.main.deskPayment.legend")} bodyClassName="grid gap-1">
            <p className="text-xs text-muted">{t("settings.main.deskPayment.description")}</p>
            {DESK_PAYMENT_CHOICES.map(({ code, label }) => (
              <ChoiceRow
                key={code || "none"}
                name="deskPayment"
                type="radio"
                value={code}
                defaultChecked={(shop.deskPayment ?? "") === code}
                className="text-sm"
              >
                {t(label)}
              </ChoiceRow>
            ))}
          </ChoiceFieldset>
        </section>
        <StickyFormActions>
          <SubmitButton
            pendingLabel={t("settings.main.dockCall.submitting")}
            className={buttonClass()}
          >
            {t("settings.dockDay.save")}
          </SubmitButton>
          <FormStatus tone={banner?.tone} occurrenceKey={notice}>
            {banner?.text}
          </FormStatus>
        </StickyFormActions>
      </form>
    </SettingsEditorPage>
  );
}
